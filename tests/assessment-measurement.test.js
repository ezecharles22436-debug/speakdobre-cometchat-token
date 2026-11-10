const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { createHandler, createAssessmentDeliveryStore } = require("../api/assessment");
const { normalizeMeasurement, hasTechnicalName } = require("../api/_assessment-measurement");
const { createFakeAssessmentDatabase } = require("./fake-assessment-database");

const submissionId = "123e4567-e89b-42d3-a456-426614174000";
const receivedAt = Date.parse("2026-11-11T10:00:00.000Z");
const shortId = "sd_enq_8b7a5f011aa05444af317ee87aa56f49";
const origin = "https://www.speakdobre.com";
const shortBody = {
  formVersion: "teaching_short_v1", submissionId, name: "Олена",
  contactMethod: "email", contactValue: "student@example.test", consentAccepted: true, website: ""
};
const legacyBody = {
  submissionId, name: "Олена", email: "student@example.test", phone: "",
  englishLevel: "B1 (Середній)", goal: "Practice", availability: "Вечір",
  privacyConsent: true, website: ""
};
const touches = {
  schemaVersion: 1, testMode: false,
  firstTouch: {
    utm_source: "ig", utm_medium: "paid_social", utm_campaign: "speakdobre_lessons_ua",
    campaign_id: "120249175874320417", adset_id: "120249175874350417", ad_id: "120249175874340417",
    creative_id: "987654321012345678", fbclid: "opaque_Fb.123-abc",
    landingPath: "/english-lessons-ad", referrerHost: "l.instagram.com", capturedAt: "2026-11-11T09:15:00.000Z"
  },
  lastTouch: {
    utm_source: "tiktok", utm_medium: "paid_social", utm_campaign: "speakdobre_lessons_ua",
    campaign_id: "1881010071683361", adgroup_id: "1881010098223778", ad_id: "1881010451895394",
    ttclid: "opaque_Tt-456", landingPath: "/english-lessons-ad", capturedAt: "2026-11-11T09:45:00.000Z"
  }
};

function fixture({ db = createFakeAssessmentDatabase(), deliver, now = () => receivedAt } = {}) {
  const calls = [];
  const send = deliver || (async payload => { calls.push(structuredClone(payload)); });
  const handler = createHandler({
    deliver: send,
    deliveryStore: createAssessmentDeliveryStore({ db, now, namespace: "test_assessment_short_delivery_v1" }),
    measurementDeliveryStore: createAssessmentDeliveryStore({
      db, now, namespace: "test_assessment_measurement_delivery_v1", formVersionKey: "legacy_assessment_measurement_v1"
    }),
    origins: new Set([origin]), now, logError() {}
  });
  async function submit(body = shortBody, request = {}) {
    const response = {
      statusCode: 200, headers: {}, body: null,
      setHeader(key, value) { this.headers[key] = value; },
      status(status) { this.statusCode = status; return this; },
      json(value) { this.body = value; }, end() {}
    };
    await handler({ method: "POST", headers: { origin, "content-type": "application/json" }, body: structuredClone(body), ...request }, response);
    return response;
  }
  return { submit, calls, db };
}

function acknowledgement(testMode = false, enquiryId = shortId) {
  return { ok: true, accepted: true, submissionId, enquiryId, test: testMode, leadEligible: !testMode, measurementVersion: 1 };
}

test("accepted real enquiry shares one server ID with durable safe metadata and mapped staff label", async () => {
  const check = fixture();
  const response = await check.submit({ ...shortBody, measurement: touches });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, acknowledgement());
  assert.equal(check.calls.length, 1);
  const payload = check.calls[0];
  assert.equal(payload.enquiryId, response.body.enquiryId);
  assert.equal(payload.source, "speakdobre-home");
  assert.equal(payload.acquisitionChannel, "paid_landing");
  assert.equal(payload.contactValue, shortBody.contactValue);
  assert.deepEqual(payload.measurement.firstTouch, touches.firstTouch);
  assert.deepEqual(payload.measurement.lastTouch, touches.lastTouch);
  assert.match(payload.referralSourceLabel, new RegExp(shortId));
  assert.match(payload.referralSourceLabel, /Перший перехід:.*campaign_id=120249175874320417/);
  assert.match(payload.referralSourceLabel, /Останній перехід:.*adgroup_id=1881010098223778/);
  assert.match(payload.referralSourceLabel, /referrerHost=l.instagram.com/);
  assert.match(payload.referralSourceLabel, /landingPath=\/english-lessons-ad/);
  assert.match(payload.referralSourceLabel, /рекламний перехід не підтверджено/);
  assert.doesNotMatch(payload.referralSourceLabel, /opaque_Fb|opaque_Tt|student@example/);
  const record = [...check.db.documents.values()][0];
  assert.equal(record.state, "accepted");
  assert.equal(record.createdAt, "2026-11-11T10:00:00.000Z");
  assert.equal(record.measurement.enquiryId, shortId);
  const stored = JSON.stringify(record);
  for (const privateValue of [shortBody.name, shortBody.contactValue, submissionId, "Practice"]) {
    assert.equal(stored.includes(privateValue), false);
  }
});

test("staff text shows sanitized host/path and explicitly marks missing ad identity per touch", async () => {
  const check = fixture();
  const measurement = {
    schemaVersion: 1,
    firstTouch: { referrerHost: "l.instagram.com", landingPath: "/english-lessons-ad", capturedAt: "2026-11-11T09:15:00.000Z" },
    lastTouch: { utm_source: "tiktok", landingPath: "/english-lessons-ad", capturedAt: "2026-11-11T09:45:00.000Z" }
  };
  assert.equal((await check.submit({ ...shortBody, measurement })).statusCode, 200);
  const label = check.calls[0].referralSourceLabel;
  assert.match(label, /Перший перехід: referrerHost=l.instagram.com · landingPath=\/english-lessons-ad/);
  assert.match(label, /Останній перехід: utm_source=tiktok · landingPath=\/english-lessons-ad/);
  assert.equal(label.match(/числовий ad_id не передано/g).length, 2);
  assert.equal(check.calls[0].measurement.firstTouch.ad_id, undefined);
  assert.equal(check.calls[0].measurement.lastTouch.ad_id, undefined);
});

test("staff text marks unavailable ad identity when no measurement was captured", async () => {
  const check = fixture();
  await check.submit(shortBody);
  assert.match(check.calls[0].referralSourceLabel, /Числовий ad_id не передано; точне оголошення не визначено\./);
  assert.equal(check.calls[0].measurement.firstTouch, undefined);
  assert.equal(check.calls[0].measurement.lastTouch, undefined);
});

test("new measured requests replay across cold handlers without another notification or changing source", async () => {
  const db = createFakeAssessmentDatabase();
  const first = fixture({ db });
  const body = { ...shortBody, measurement: touches };
  const accepted = await first.submit(body);
  const second = fixture({ db, now: () => receivedAt + 24 * 60 * 60 * 1000 });
  const repeated = await second.submit(body);
  assert.deepEqual(repeated.body, accepted.body);
  assert.equal(second.calls.length, 0);
  const record = [...db.documents.values()][0];
  assert.equal(record.createdAt, "2026-11-11T10:00:00.000Z");
  assert.deepEqual(record.measurement.firstTouch, touches.firstTouch);
});

test("the same request ID with changed normalized measurement is a conflict", async () => {
  const check = fixture();
  const body = { ...shortBody, measurement: touches };
  await check.submit(body);
  const changed = structuredClone(body);
  changed.measurement.lastTouch.ad_id = "999";
  const response = await check.submit(changed);
  assert.equal(response.statusCode, 409);
  assert.equal(response.body.code, "SUBMISSION_ID_REUSED");
  assert.equal(response.body.accepted, undefined);
  assert.equal(check.calls.length, 1);
});

test("measurement property order and ignored unknown fields do not change a retry fingerprint", async () => {
  const check = fixture();
  const first = await check.submit({ ...shortBody, measurement: touches });
  const reordered = {
    lastTouch: Object.fromEntries(Object.entries(touches.lastTouch).reverse()),
    unknown: "ignored", firstTouch: Object.fromEntries(Object.entries(touches.firstTouch).reverse()),
    testMode: false, schemaVersion: 1
  };
  const second = await check.submit({ ...shortBody, measurement: reordered });
  assert.deepEqual(second.body, first.body);
  assert.equal(check.calls.length, 1);
});

test("unchanged old accepted fingerprints without stored metadata remain valid cold retries", async () => {
  const db = createFakeAssessmentDatabase();
  // Frozen from the independently executed pinned Nov7 handler (assessment SHA6d051...).
  // This fixture does not obtain its expected hash from the implementation under test.
  const deployedV1Hash = "c8d50f24bf6a97d3f7fa93e98d45d512c4e016134044bd610db6ebe65b4ab1ae";
  const documentId = createHash("sha256").update(`teaching_short_v1:${submissionId}`).digest("hex");
  await db.createDocument("test_assessment_short_delivery_v1", documentId, {
    schemaVersion: 1, requestHash: deployedV1Hash, operationToken: "frozen-nov7-owner",
    state: "accepted", createdAt: "2026-11-11T10:00:00.000Z", updatedAt: "2026-11-11T10:00:00.000Z",
    acceptedAt: "2026-11-11T10:00:00.000Z", leaseUntil: null, reason: ""
  });
  const cold = fixture({ db });
  assert.deepEqual((await cold.submit(shortBody)).body, acknowledgement());
  assert.equal(cold.calls.length, 0);
  assert.equal([...db.documents.values()][0].requestHash, deployedV1Hash);
  assert.equal([...db.documents.values()][0].measurement, undefined);
});

test("an old accepted technical-name request becomes explicitly excluded without replay", async () => {
  const db = createFakeAssessmentDatabase();
  const body = { ...shortBody, name: "TECHNICAL TEST - SOURCE CHECK" };
  const first = fixture({ db });
  const response = await first.submit(body);
  delete [...db.documents.values()][0].measurement;
  const cold = fixture({ db });
  const replay = await cold.submit(body);
  assert.equal(response.statusCode, 202);
  assert.equal(replay.statusCode, 202);
  assert.deepEqual(replay.body, acknowledgement(true));
  assert.equal(cold.calls.length, 0);
});

test("all documented declarations return accepted-test 202 and are visible in existing staff filters", async () => {
  const declarations = [
    { name: "TECHNICAL TEST - NOT A STUDENT" },
    { name: "technical   test - source check" },
    { measurement: { schemaVersion: 1, testMode: true } },
    { measurement: { schemaVersion: 1, firstTouch: { utm_source: "technical_test" } } },
    { measurement: { schemaVersion: 1, lastTouch: { utm_medium: "internal_test" } } }
  ];
  for (const declaration of declarations) {
    const check = fixture();
    const response = await check.submit({ ...shortBody, ...declaration });
    assert.equal(response.statusCode, 202);
    assert.deepEqual(response.body, acknowledgement(true));
    assert.equal(check.calls.length, 1);
    assert.equal(check.calls[0].technicalTest, true);
    assert.equal(check.calls[0].measurement.classification, "declared_technical_test");
    assert.equal(hasTechnicalName(check.calls[0].name), true);
    assert.match(check.calls[0].referralSourceLabel, /TECHNICAL TEST/);
    assert.equal([...check.db.documents.values()][0].state, "accepted");
    // Existing 200-only accepted-event interceptors fail this gate even while cached.
    assert.equal(response.statusCode === 200, false);
  }
});

test("technical declarations cannot bypass invalid contact, name or consent", async () => {
  for (const invalid of [{ contactValue: "invalid" }, { consentAccepted: false }, { name: "<script>" }]) {
    const check = fixture();
    const response = await check.submit({ ...shortBody, ...invalid, measurement: { schemaVersion: 1, testMode: true } });
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.accepted, undefined);
    assert.equal(response.body.enquiryId, undefined);
    assert.equal(check.calls.length, 0);
    assert.equal(check.db.documents.size, 0);
  }
});

test("a honeypot remains an unaccepted 202 with no ID, delivery or claim", async () => {
  const check = fixture();
  const response = await check.submit({ ...shortBody, website: "bot", measurement: { schemaVersion: 1, testMode: true } });
  assert.equal(response.statusCode, 202);
  assert.deepEqual(response.body, { ok: true });
  assert.equal(check.calls.length, 0);
  assert.equal(check.db.documents.size, 0);
});

test("unsupported flags and lookalike names do not become declared technical tests", async () => {
  for (const body of [
    { name: "TECHNICAL TESTER" }, { name: "TECHNICAL TESTÉ" },
    { test: true, testMode: true }, { measurement: { schemaVersion: 1, testMode: "true" } },
    { measurement: { schemaVersion: 2, testMode: true } }, { measurement: [] }
  ]) {
    const check = fixture();
    const response = await check.submit({ ...shortBody, ...body }, { url: "/api/assessment?sd_test=1&technical_test=1" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, acknowledgement());
    assert.equal(check.calls[0].name, body.name || shortBody.name);
  }
  assert.equal(hasTechnicalName("TECHNICAL TEST\u0301"), false);
  assert.equal(hasTechnicalName("TECHNICAL_TEST - legacy source"), true);
  assert.equal(hasTechnicalName("technical—test — legacy source"), true);
});

test("campaign IDs retain their exact digits and numeric inputs or unresolved macros are omitted", () => {
  const metadata = normalizeMeasurement({ schemaVersion: 1, firstTouch: {
    campaign_id: "120249175874320417", ad_id: "{{ad.id}}", adset_id: 120249175874350417,
    adgroup_id: "1e16", creative_id: "000123", fbclid: "opaque_123-abc", gclid: "a".repeat(257)
  } });
  assert.deepEqual(metadata.firstTouch, { campaign_id: "120249175874320417", creative_id: "000123", fbclid: "opaque_123-abc" });
});

test("metadata strips URLs, contact-like values, control characters, inherited and unknown fields", () => {
  const firstTouch = Object.assign(Object.create({ utm_campaign: "inherited", ad_id: "999" }), {
    utm_source: " tiktok ", utm_medium: "paid_social\n", utm_content: "=SUM(1)", utm_term: "person@example.test",
    fbclid: "https://example.test", ttclid: "person@example.test", campaign_id: "1\n",
    landingPath: "/english-lessons-ad?email=person", referrerHost: "https://www.google.com/private",
    capturedAt: "2026-02-30T10:00:00.000Z", email: "person@example.test", name: "Private", answers: "Private"
  });
  assert.deepEqual(normalizeMeasurement({ schemaVersion: 1, firstTouch }).firstTouch, { utm_source: "tiktok", utm_medium: "paid_social" });
});

test("only safe pathname, hostname and strict ISO timestamp are retained", () => {
  const normalized = normalizeMeasurement({ schemaVersion: 1, firstTouch: {
    landingPath: "/english-lessons-ad", referrerHost: "L.Instagram.COM", capturedAt: "2026-11-11T09:15:00.000Z"
  } });
  assert.deepEqual(normalized.firstTouch, { landingPath: "/english-lessons-ad", referrerHost: "l.instagram.com", capturedAt: "2026-11-11T09:15:00.000Z" });
  for (const landingPath of ["//elsewhere.test", "/../private", "/path#name", "/path?phone=123", "https://example.test/"]) {
    assert.equal(normalizeMeasurement({ schemaVersion: 1, firstTouch: { landingPath } }).firstTouch, undefined);
  }
});

test("parallel measured requests invoke delivery once and the winner remains retryable", async () => {
  let release;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  const db = createFakeAssessmentDatabase();
  let deliveries = 0;
  const first = fixture({ db, deliver: async () => { deliveries += 1; started(); await pending; } });
  const second = fixture({ db, deliver: async () => { deliveries += 1; } });
  const body = { ...shortBody, measurement: touches };
  const winner = first.submit(body);
  await ready;
  const loser = await second.submit(body);
  assert.equal(loser.statusCode, 503);
  assert.equal(loser.body.accepted, undefined);
  release();
  assert.equal((await winner).statusCode, 200);
  assert.deepEqual((await second.submit(body)).body, acknowledgement());
  assert.equal(deliveries, 1);
});

test("a technical delivery timeout is unaccepted and never automatically replayed", async () => {
  const db = createFakeAssessmentDatabase();
  let deliveries = 0;
  const first = fixture({ db, deliver: async () => { deliveries += 1; throw new Error("Simulated timeout"); } });
  const body = { ...shortBody, measurement: { schemaVersion: 1, testMode: true } };
  const failure = await first.submit(body);
  assert.equal(failure.statusCode, 503);
  assert.equal(failure.body.code, "DELIVERY_RECONCILIATION_REQUIRED");
  assert.equal(failure.body.enquiryId, undefined);
  const cold = fixture({ db, deliver: async () => { deliveries += 1; } });
  assert.equal((await cold.submit(body)).statusCode, 503);
  assert.equal(deliveries, 1);
  assert.equal([...db.documents.values()][0].measurement.test, true);
});

test("legacy opt-in measurement uses its separate durable namespace and preserves validation/payload", async () => {
  const db = createFakeAssessmentDatabase();
  const check = fixture({ db });
  const body = { ...legacyBody, measurement: touches };
  const first = await check.submit(body);
  assert.equal(first.statusCode, 200);
  assert.match(first.body.enquiryId, /^sd_enq_[0-9a-f]{32}$/);
  assert.notEqual(first.body.enquiryId, shortId);
  assert.equal(check.calls[0].englishLevel, legacyBody.englishLevel);
  assert.equal(check.calls[0].availability, legacyBody.availability);
  assert.equal(check.calls[0].source, "speakdobre-home");
  assert.equal(check.calls[0].formVersion, undefined);
  assert.equal(check.calls[0].acquisitionChannel, undefined);
  assert.equal([...db.documents.keys()][0].startsWith("test_assessment_measurement_delivery_v1/"), true);
  const cold = fixture({ db });
  assert.deepEqual((await cold.submit(body)).body, first.body);
  assert.equal(cold.calls.length, 0);
  const invalid = await fixture().submit({ ...body, englishLevel: "" });
  assert.equal(invalid.statusCode, 400);
});

test("old legacy requests retain their direct delivery path without creating database claims", async () => {
  const check = fixture();
  assert.equal((await check.submit(legacyBody)).statusCode, 200);
  assert.equal(check.calls.length, 1);
  assert.equal(check.db.documents.size, 0);
  assert.equal(check.calls[0].measurement.classification, "ordinary_enquiry");
});

test("old legacy technical names are labelled and acknowledged as excluded tests without Firebase", async () => {
  const check = fixture();
  const response = await check.submit({ ...legacyBody, name: "TECHNICAL_TEST - legacy" });
  assert.equal(response.statusCode, 202);
  assert.equal(response.body.accepted, true);
  assert.equal(response.body.leadEligible, false);
  assert.equal(check.db.documents.size, 0);
  assert.equal(check.calls.length, 1);
});

test("a failed durable acceptance exposes no accepted test ID and retains reconciliation metadata", async () => {
  const db = createFakeAssessmentDatabase({ beforePatch({ fields }) {
    if (fields.state === "accepted") throw new Error("Simulated unavailable store");
  } });
  const check = fixture({ db });
  const response = await check.submit({ ...shortBody, measurement: { schemaVersion: 1, testMode: true } });
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.enquiryId, undefined);
  const record = [...db.documents.values()][0];
  assert.equal(record.state, "reconcile");
  assert.equal(record.measurement.test, true);
  assert.equal(check.calls.length, 1);
});

test("measured legacy production creates only its declared namespace and Preview refuses production storage", () => {
  const previous = process.env.VERCEL_ENV;
  try {
    process.env.VERCEL_ENV = "preview";
    assert.throws(() => createAssessmentDeliveryStore({ namespace: "assessment_measurement_delivery_v1" }), /Preview/);
    assert.doesNotThrow(() => createAssessmentDeliveryStore({ namespace: "preview_assessment_measurement_delivery_v1" }));
  } finally {
    if (previous === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previous;
  }
});
