const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/cometchat-token");

test.beforeEach(() => {
  process.env.MEMBERSTACK_ALLOWED_PLAN_IDS = "pln_practice-chat";
  process.env.MEMBERSTACK_ALLOWED_PLAN_NAMES = "Practice Chat";
});

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
