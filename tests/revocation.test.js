const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/revoke-cometchat-access");

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    }
  };
}

test.beforeEach(() => {
  process.env.COMETCHAT_APP_ID = "app-test";
  process.env.COMETCHAT_REGION = "eu";
  process.env.COMETCHAT_API_KEY = "rest-key";
  process.env.COMETCHAT_LIFECYCLE_SECRET = "lifecycle-secret-123";
});

test("rejects unauthenticated lifecycle calls before contacting CometChat", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error("fetch must not run"); };
  try {
    const res = response();
    await handler({ method: "POST", headers: {}, body: { uid: "mem_valid" } }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, "Unauthorized.");
  } finally {
    global.fetch = originalFetch;
  }
});

test("rejects arbitrary or malformed user IDs", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error("fetch must not run"); };
  try {
    for (const uid of ["user_123", "../mem_other", "mem_bad/value", ""]) {
      const res = response();
      await handler({
        method: "POST",
        headers: { authorization: "Bearer lifecycle-secret-123" },
        body: { uid }
      }, res);
      assert.equal(res.statusCode, 400);
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test("flushes all tokens and deactivates the exact Memberstack-backed user", async () => {
  const requests = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return new Response(JSON.stringify({ data: { success: true } }), { status: 200 });
  };
  try {
    const res = response();
    await handler({
      method: "POST",
      headers: { authorization: "Bearer lifecycle-secret-123" },
      body: { uid: "mem_verified_123" }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, uid: "mem_verified_123", status: "deactivated" });
    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, "https://app-test.api-eu.cometchat.io/v3/users/mem_verified_123/auth_tokens");
    assert.equal(requests[0].options.method, "DELETE");
    assert.equal(requests[1].url, "https://app-test.api-eu.cometchat.io/v3/users");
    assert.equal(requests[1].options.method, "DELETE");
    assert.deepEqual(JSON.parse(requests[1].options.body), { uidsToDeactivate: ["mem_verified_123"] });
    assert.equal(requests.every(request => request.options.headers.apiKey === "rest-key"), true);
  } finally {
    global.fetch = originalFetch;
  }
});

test("missing users are treated as already revoked", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response("{}", { status: 404 });
  try {
    const res = response();
    await handler({
      method: "POST",
      headers: { authorization: "Bearer lifecycle-secret-123" },
      body: { uid: "mem_missing" }
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, "deactivated");
  } finally {
    global.fetch = originalFetch;
  }
});

test("constant-time comparison rejects same-length incorrect secrets", () => {
  assert.equal(handler._test.secretsMatch("lifecycle-secret-124", "lifecycle-secret-123"), false);
  assert.equal(handler._test.secretsMatch("lifecycle-secret-123", "lifecycle-secret-123"), true);
});
