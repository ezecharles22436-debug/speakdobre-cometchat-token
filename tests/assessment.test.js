const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/assessment");

function request(overrides = {}) {
  return {
    method: "POST",
    headers: {
      origin: "https://www.speakdobre.com",
      "content-type": "application/json"
    },
    body: {
      submissionId: "123e4567-e89b-42d3-a456-426614174000",
      name: "Тестова Людина",
      email: "TEST@example.com",
      phone: "+380 67 000 00 00",
      englishLevel: "B1 (Середній)",
      goal: "Розмовна англійська",
      availability: "Вечір",
      privacyConsent: true,
      website: "",
      ...overrides
    }
  };
}

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; }
  };
}

test("normalizes and validates a complete assessment", () => {
  const result = handler._test.validateSubmission(request().body);
  assert.equal(result.email, "test@example.com");
  assert.equal(result.name, "Тестова Людина");
});

test("rejects missing consent and invalid enumerations", () => {
  assert.throws(() => handler._test.validateSubmission(request({ privacyConsent: false }).body), /Privacy consent/);
  assert.throws(() => handler._test.validateSubmission(request({ englishLevel: "admin" }).body), /English level/);
  assert.throws(() => handler._test.validateSubmission(request({ availability: "Ніколи" }).body), /availability/);
});

test("rejects invalid contact fields", () => {
  assert.throws(() => handler._test.validateSubmission(request({ email: "not-an-email" }).body), /email/);
  assert.throws(() => handler._test.validateSubmission(request({ phone: "<script>" }).body), /phone/);
});

test("rejects untrusted origins before delivery", async () => {
  const req = request();
  req.headers.origin = "https://attacker.example";
  const res = response();
  await handler(req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "ORIGIN_NOT_ALLOWED");
});

test("rejects non-JSON requests", async () => {
  const req = request();
  req.headers["content-type"] = "application/x-www-form-urlencoded";
  const res = response();
  await handler(req, res);
  assert.equal(res.statusCode, 415);
});

test("honeypot submissions are accepted without external delivery", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error("fetch must not run"); };
  try {
    const res = response();
    await handler(request({ website: "https://spam.example" }), res);
    assert.equal(res.statusCode, 202);
    assert.deepEqual(res.body, { ok: true });
  } finally {
    global.fetch = originalFetch;
  }
});

test("forwards only normalized fields and returns the stable submission ID", async () => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.ZAPIER_ASSESSMENT_WEBHOOK_URL;
  process.env.ZAPIER_ASSESSMENT_WEBHOOK_URL = "https://hooks.example.test/assessment";
  let delivered;
  global.fetch = async (_url, options) => {
    delivered = JSON.parse(options.body);
    return { ok: true };
  };
  try {
    const res = response();
    await handler(request(), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.submissionId, request().body.submissionId);
    assert.equal(delivered.email, "test@example.com");
    assert.equal(delivered.privacyConsent, true);
    assert.equal(delivered.consentVersion, "privacy-policy-2026-08");
  } finally {
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.ZAPIER_ASSESSMENT_WEBHOOK_URL;
    else process.env.ZAPIER_ASSESSMENT_WEBHOOK_URL = originalUrl;
  }
});
