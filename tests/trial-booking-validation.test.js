const test = require("node:test");
const assert = require("node:assert/strict");
const {
  generateAvailableSlots,
  collectionName,
  publicBooking,
  validateBookingInput,
  zonedParts
} = require("../api/_trial-booking-shared");

const NOW = new Date("2026-09-12T00:00:00.000Z");

function valid(overrides = {}) {
  return {
    action: "schedule",
    startAt: "2026-09-12T03:00:00.000Z",
    meetingMethod: "google-meet",
    contactChannel: "telegram",
    contactValue: "@test_student",
    ...overrides
  };
}

test.beforeEach(() => {
  delete process.env.TRIAL_BOOKING_MIN_NOTICE_MINUTES;
  delete process.env.TRIAL_BOOKING_DATA_NAMESPACE;
});

test("isolates preview Firestore collections with a validated namespace", () => {
  process.env.TRIAL_BOOKING_DATA_NAMESPACE = "preview_trial_booking";
  assert.equal(collectionName("trialBookings"), "preview_trial_booking_trialBookings");
  process.env.TRIAL_BOOKING_DATA_NAMESPACE = "../unsafe";
  assert.throws(() => collectionName("trialBookings"), /Invalid TRIAL_BOOKING_DATA_NAMESPACE/);
});

test("accepts a 30-minute slot during the Kyiv booking window", () => {
  const result = validateBookingInput(valid(), NOW);
  assert.equal(result.startAt.toISOString(), "2026-09-12T03:00:00.000Z");
  assert.equal(result.meetingMethod, "google-meet");
});

test("accepts the final 00:30 Kyiv slot and rejects 01:00", () => {
  assert.doesNotThrow(() => validateBookingInput(valid({ startAt: "2026-09-12T21:30:00.000Z" }), NOW));
  assert.throws(
    () => validateBookingInput(valid({ startAt: "2026-09-12T22:00:00.000Z" }), NOW),
    error => error.code === "OUTSIDE_DAILY_HOURS"
  );
});

test("enforces minimum notice, 14-day cutoff and exact half-hour slots", () => {
  assert.throws(
    () => validateBookingInput(valid({ startAt: "2026-09-12T01:00:00.000Z" }), NOW),
    error => error.code === "MIN_NOTICE"
  );
  assert.throws(
    () => validateBookingInput(valid({ startAt: "2026-09-27T03:00:00.000Z" }), NOW),
    error => error.code === "OUTSIDE_BOOKING_WINDOW"
  );
  assert.throws(
    () => validateBookingInput(valid({ startAt: "2026-09-12T03:15:00.000Z" }), NOW),
    error => error.code === "INVALID_SLOT"
  );
});

test("requires enumerated meeting and contact methods", () => {
  assert.throws(() => validateBookingInput(valid({ meetingMethod: "javascript:" }), NOW), error => error.code === "INVALID_MEETING_METHOD");
  assert.throws(() => validateBookingInput(valid({ contactChannel: "carrier-pigeon" }), NOW), error => error.code === "INVALID_CONTACT_CHANNEL");
  assert.throws(() => validateBookingInput(valid({ contactValue: "" }), NOW), error => error.code === "CONTACT_VALUE_REQUIRED");
  assert.doesNotThrow(() => validateBookingInput(valid({ contactChannel: "email", contactValue: "" }), NOW));
});

test("generates only server-approved Kyiv slots for the rolling window", () => {
  const slots = generateAvailableSlots(NOW);
  assert.ok(slots.length > 500);
  assert.equal(slots[0].date, "2026-09-12");
  assert.equal(slots[0].time, "06:00");
  for (const slot of slots) {
    const parts = zonedParts(new Date(slot.startAt), "Europe/Kyiv");
    assert.ok(parts.hour === 0 || parts.hour >= 6);
    assert.ok(parts.minute === 0 || parts.minute === 30);
  }
});

test("slot generation remains unique across Kyiv daylight-saving changes", () => {
  const slots = generateAvailableSlots(new Date("2026-10-24T00:00:00.000Z"));
  assert.equal(new Set(slots.map(slot => slot.startAt)).size, slots.length);
  for (const slot of slots) {
    const parts = zonedParts(new Date(slot.startAt), "Europe/Kyiv");
    assert.ok(parts.hour === 0 || parts.hour >= 6);
    assert.ok(parts.minute === 0 || parts.minute === 30);
  }
});

test("normalizes contact values and caps their stored length", () => {
  const result = validateBookingInput(valid({ contactValue: `  @student\u0000${"x".repeat(250)}  ` }), NOW);
  assert.equal(result.contactValue.includes("\u0000"), false);
  assert.equal(result.contactValue.length, 180);
});

test("public booking responses do not expose account or assessment identifiers", () => {
  const exposed = publicBooking({
    bookingId: "book-1",
    memberId: "mem-secret",
    assessmentSubmissionId: "assessment-secret",
    studentEmail: "student@example.com",
    startAt: "2026-09-12T03:00:00.000Z",
    endAt: "2026-09-12T03:30:00.000Z",
    meetingMethod: "zoom",
    contactChannel: "email",
    contactValue: "",
    status: "scheduled"
  });
  assert.equal(exposed.bookingId, "book-1");
  assert.equal(exposed.memberId, undefined);
  assert.equal(exposed.assessmentSubmissionId, undefined);
  assert.equal(exposed.studentEmail, undefined);
});
