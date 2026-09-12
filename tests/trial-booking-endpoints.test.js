const test = require("node:test");
const assert = require("node:assert/strict");
const bookingHandler = require("../api/trial-booking");
const reminderHandler = require("../api/trial-booking-reminders");

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

test("booking endpoint fails closed while the feature is disabled", async () => {
  const previous = process.env.TRIAL_BOOKING_ENABLED;
  delete process.env.TRIAL_BOOKING_ENABLED;
  try {
    const res = response();
    await bookingHandler({ method: "GET", headers: { origin: "https://www.speakdobre.com" } }, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, "FEATURE_DISABLED");
  } finally {
    if (previous === undefined) delete process.env.TRIAL_BOOKING_ENABLED;
    else process.env.TRIAL_BOOKING_ENABLED = previous;
  }
});

test("reminder endpoint requires a timing-safe cron secret", async () => {
  const previousEnabled = process.env.TRIAL_BOOKING_ENABLED;
  const previousSecret = process.env.CRON_SECRET;
  process.env.TRIAL_BOOKING_ENABLED = "true";
  process.env.CRON_SECRET = "test-secret";
  try {
    const res = response();
    await reminderHandler({ method: "GET", headers: {} }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, "AUTH_REQUIRED");
  } finally {
    if (previousEnabled === undefined) delete process.env.TRIAL_BOOKING_ENABLED;
    else process.env.TRIAL_BOOKING_ENABLED = previousEnabled;
    if (previousSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousSecret;
  }
});

test("booking endpoint rejects unsupported methods", async () => {
  const previous = process.env.TRIAL_BOOKING_ENABLED;
  process.env.TRIAL_BOOKING_ENABLED = "true";
  try {
    const res = response();
    await bookingHandler({ method: "DELETE", headers: {} }, res);
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.Allow, "GET, POST, OPTIONS");
  } finally {
    if (previous === undefined) delete process.env.TRIAL_BOOKING_ENABLED;
    else process.env.TRIAL_BOOKING_ENABLED = previous;
  }
});

