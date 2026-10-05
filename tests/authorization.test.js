const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/cometchat-token");

test.beforeEach(() => {
  process.env.MEMBERSTACK_ALLOWED_PLAN_IDS = "pln_practice-chat";
  process.env.MEMBERSTACK_ALLOWED_PLAN_NAMES = "Practice Chat";
});

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; }
  };
}

test("client-editable custom fields alone never grant chat access", () => {
  const access = handler._test.getPracticeChatAccess({
    customFields: {
      practiceChatStatus: "active",
      practiceChatLastPaymentStatus: "success",
      plan: "premium"
    },
    planConnections: []
  });
  assert.deepEqual(access, { allowed: false, type: "expired", trialEnd: null });
});

test("an active allowlisted server-managed plan grants access", () => {
  const access = handler._test.getPracticeChatAccess({
    customFields: {},
    planConnections: [{ active: true, planId: "pln_practice-chat" }]
  });
  assert.equal(access.allowed, true);
  assert.equal(access.type, "paid");
});

test("inactive plans do not grant access", () => {
  const access = handler._test.getPracticeChatAccess({
    customFields: { practiceChatStatus: "active" },
    planConnections: [{ active: false, planId: "pln_practice-chat" }]
  });
  assert.equal(access.allowed, false);
});

test("an eligible returning member is reactivated before a fresh token is issued", async () => {
  process.env.MEMBERSTACK_SECRET_KEY = "memberstack-secret";
  process.env.COMETCHAT_APP_ID = "app-test";
  process.env.COMETCHAT_REGION = "eu";
  process.env.COMETCHAT_API_KEY = "rest-key";
  process.env.ALLOWED_ORIGINS = "https://www.speakdobre.com";
  process.env.SPEAKDOBRE_CHAT_ROOMS = "[]";

  const requests = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith("/members/verify-token")) {
      return new Response(JSON.stringify({ data: { id: "mem_returning" } }), { status: 200 });
    }
    if (String(url).endsWith("/members/mem_returning")) {
      return new Response(JSON.stringify({
        data: {
          id: "mem_returning",
          auth: { email: "returning@example.test" },
          customFields: {},
          planConnections: [{ active: true, planId: "pln_practice-chat" }]
        }
      }), { status: 200 });
    }
    if (String(url).endsWith("/users/mem_returning") && options.method === "GET") {
      return new Response(JSON.stringify({ data: { uid: "mem_returning" } }), { status: 200 });
    }
    if (String(url).endsWith("/users") && options.method === "PUT") {
      return new Response(JSON.stringify({ data: { nonDeactivatedUids: ["mem_returning"] } }), { status: 200 });
    }
    if (String(url).endsWith("/users/mem_returning/auth_tokens") && options.method === "POST") {
      return new Response(JSON.stringify({ data: { authToken: "fresh-token" } }), { status: 200 });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const req = {
      method: "POST",
      headers: {
        origin: "https://www.speakdobre.com",
        authorization: "Bearer member-session"
      }
    };
    const res = response();
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.token, "fresh-token");
    const reactivationIndex = requests.findIndex(request => request.url.endsWith("/users") && request.options.method === "PUT");
    const tokenIndex = requests.findIndex(request => request.url.endsWith("/auth_tokens") && request.options.method === "POST");
    assert.ok(reactivationIndex >= 0);
    assert.ok(tokenIndex > reactivationIndex);
    assert.deepEqual(JSON.parse(requests[reactivationIndex].options.body), { uidsToActivate: ["mem_returning"] });
  } finally {
    global.fetch = originalFetch;
  }
});
