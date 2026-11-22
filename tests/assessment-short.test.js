const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { createHandler, createAssessmentDeliveryStore } = require("../api/assessment");
const { createFakeAssessmentDatabase } = require("./fake-assessment-database");

const submissionId = "123e4567-e89b-42d3-a456-426614174000";
const origin = "https://www.speakdobre.com";
const acknowledgement = {
  ok: true, accepted: true, submissionId,
  enquiryId: "sd_enq_8b7a5f011aa05444af317ee87aa56f49",
  test: false, leadEligible: true, measurementVersion: 1
};

function fixture(deliver, now, db = createFakeAssessmentDatabase()) {
  const handler = createHandler({
    deliver,
    now,
    deliveryStore: createAssessmentDeliveryStore({ db, now, namespace: "test_assessment_short_delivery_v1" }),
    origins: new Set([origin]),
    logError() {}
  });
  return async (overrides = {}, req = {}) => {
    const result = {
      statusCode: 200,
      headers: {},
      body: null,
      setHeader(name, value) { this.headers[name] = value; },
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; },
      end() {}
    };
    await handler({
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: {
        formVersion: "teaching_short_v1",
        submissionId,
        name: "Олена",
        contactMethod: "email",
        contactValue: " TEST@example.com ",
        consentAccepted: true,
        website: "",
        ...overrides
      },
      ...req
    }, result);
    return result;
  };
}

test("delivers a short email enquiry through the same event with matching ID after durable acknowledgement", async () => {
  let payload;
  const submit = fixture(async value => { payload = value; }, () => Date.parse("2026-11-07T09:00:00Z"));
  const result = await submit({ attribution: { utm_source: "instagram", utm_medium: "paid_social", utm_campaign: "speakdobre_lessons_ua_20261103" } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.headers["Cache-Control"], "no-store");
  assert.equal(result.headers["Access-Control-Allow-Origin"], origin);
  assert.deepEqual(result.body, acknowledgement);
  assert.match(payload.deliveryReference, /^[a-f0-9]{64}$/);
  const { deliveryReference, enquiryId, technicalTest, leadEligible, measurementVersion, measurement, ...deliveredPayload } = payload;
  assert.equal(enquiryId, acknowledgement.enquiryId);
  assert.equal(technicalTest, false);
  assert.equal(leadEligible, true);
  assert.equal(measurementVersion, 1);
  assert.equal(measurement.enquiryId, enquiryId);
  assert.deepEqual(deliveredPayload, {
    event: "assessment-request",
    submissionId,
    name: "Олена",
    email: "test@example.com",
    phone: "",
    contactMethod: "email",
    contactValue: "test@example.com",
    contactLabel: "Електронна пошта",
    contactSummary: "Електронна пошта: test@example.com",
    contactSchemaVersion: 2,
    referralSource: "",
    referralSourceLabel: `Не запитували. Форма: рекламна сторінка уроків. UTM source=instagram · medium=paid_social · campaign=speakdobre_lessons_ua_20261103. Це позначки посилання, рекламний перехід не перевірено. Заявка: ${acknowledgement.enquiryId}. Звичайна заявка. Числовий ad_id не передано; точне оголошення не визначено.`,
    currentCountry: "",
    currentCity: "",
    locationSummary: "Не вказано",
    locationSchemaVersion: 0,
    englishLevel: "",
    goal: "",
    availability: "",
    privacyConsent: true,
    consentVersion: "assessment-teaching-short-2026-11",
    source: "speakdobre-home",
    acquisitionChannel: "paid_landing",
    formVersion: "teaching_short_v1",
    attribution: {
      utm_source: "instagram",
      utm_medium: "paid_social",
      utm_campaign: "speakdobre_lessons_ua_20261103"
    },
    submittedAt: "2026-11-07T09:00:00.000Z"
  });
});

test("normalizes each supported messenger with only the chosen contact", async () => {
  for (const [contactMethod, contactValue, normalized] of [
    ["telegram", "student_name", "@student_name"],
    ["telegram", "+380 (67) 000-00-00", "+380670000000"],
    ["whatsapp", "+380 (67) 000-00-00", "+380670000000"],
    ["viber", "+380 (67) 000-00-00", "+380670000000"]
  ]) {
    const submit = fixture(async payload => {
      assert.equal(payload.contactMethod, contactMethod);
      assert.equal(payload.contactValue, normalized);
      assert.equal(payload.email, "");
      assert.equal(payload.phone, normalized.startsWith("+") ? normalized : "");
    });
    assert.equal((await submit({ contactMethod, contactValue })).statusCode, 200);
  }
});

test("retains only bounded, safe campaign tags and ignores unrelated fields", async () => {
  const submit = fixture(async payload => {
    assert.deepEqual(payload.attribution, { utm_source: "youtube", utm_content: "p01-intro + A" });
    assert.equal(payload.url, undefined);
    assert.equal(payload.clickId, undefined);
    assert.equal(payload.referralSource, "");
    assert.equal(payload.referralSourceLabel, `Не запитували. Форма: рекламна сторінка уроків. UTM source=youtube · content=p01-intro + A. Це позначки посилання, рекламний перехід не перевірено. Заявка: ${acknowledgement.enquiryId}. Звичайна заявка. Числовий ad_id не передано; точне оголошення не визначено.`);
  });
  const attribution = JSON.parse('{"utm_source":" youtube ","utm_medium":"@student","utm_campaign":"=SUM(1)","utm_content":"p01-intro + A","utm_term":"https://example.test","gclid":"secret","__proto__":{"utm_term":"bad"}}');
  const result = await submit({ attribution, url: "https://example.test", clickId: "secret", referralSource: "instagram" });
  assert.equal(result.statusCode, 200);
});

test("the outgoing staff label keeps a byte-compatible durable request hash", async () => {
  const db = createFakeAssessmentDatabase();
  let outgoing;
  const deliver = async payload => { outgoing = payload; };
  const submit = fixture(deliver, undefined, db);
  assert.equal((await submit()).statusCode, 200);
  assert.equal(outgoing.referralSource, "");
  assert.equal(outgoing.referralSourceLabel, `Не запитували. Форма: рекламна сторінка уроків. Позначок UTM немає. Заявка: ${acknowledgement.enquiryId}. Звичайна заявка. Числовий ad_id не передано; точне оголошення не визначено.`);
  const { deliveryReference, submittedAt, enquiryId, technicalTest, leadEligible, measurementVersion, measurement, ...previousClaimPayload } = outgoing;
  previousClaimPayload.referralSourceLabel = "Не вказано";
  const previousHash = createHash("sha256").update(JSON.stringify(previousClaimPayload)).digest("hex");
  const record = [...db.documents.values()][0];
  assert.equal(record.requestHash, previousHash);
  assert.equal(record.schemaVersion, 1);
  let replayDeliveries = 0;
  const coldReplay = fixture(async () => { replayDeliveries += 1; }, undefined, db);
  assert.deepEqual((await coldReplay()).body, acknowledgement);
  assert.equal(replayDeliveries, 0);
});

test("short validation rejects invalid input before attempted delivery", async () => {
  let deliveries = 0;
  const submit = fixture(async () => { deliveries += 1; });
  for (const [body, code] of [
    [{ consentAccepted: false }, "CONSENT_REQUIRED"],
    [{ consentAccepted: "true" }, "CONSENT_REQUIRED"],
    [{ acquisitionChannel: "website_assessment" }, "INVALID_ACQUISITION_CHANNEL"],
    [{ name: "=SUM" }, "INVALID_NAME"],
    [{ name: "" }, "INVALID_NAME"],
    [{ contactMethod: "__proto__" }, "INVALID_CONTACT"],
    [{ contactValue: "not-an-email" }, "INVALID_CONTACT"],
    [{ contactValue: "<name@example.com>" }, "INVALID_CONTACT"],
    [{ contactMethod: "whatsapp", contactValue: "0671234567" }, "INVALID_CONTACT"],
    [{ contactMethod: "telegram", contactValue: "https://t.me/handle" }, "INVALID_CONTACT"],
    [{ contactMethod: "viber", contactValue: "+38067\n0000000" }, "INVALID_CONTACT"],
    [{ submissionId: "invalid" }, "INVALID_SUBMISSION_ID"]
  ]) {
    const result = await submit(body);
    assert.equal(result.statusCode, 400);
    assert.equal(result.body.code, code);
  }
  assert.equal(deliveries, 0);
});

test("supports a one-character name and an email longer than 80 characters", async () => {
  const address = "a".repeat(60) + "@" + "b".repeat(45) + ".example";
  const submit = fixture(async payload => {
    assert.equal(payload.name, "李");
    assert.equal(payload.email, address);
  });
  assert.equal((await submit({ name: "李", contactValue: address })).statusCode, 200);
});

test("short honeypot requests return only 202 without a delivery or an accepted ID", async () => {
  let deliveries = 0;
  const submit = fixture(async () => { deliveries += 1; });
  const result = await submit({ website: "https://spam.example" });
  assert.equal(result.statusCode, 202);
  assert.deepEqual(result.body, { ok: true });
  assert.equal(deliveries, 0);
});

test("overlapping attempts return pending until matching retry reads the accepted durable claim", async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let deliveries = 0;
  const submit = fixture(async () => { deliveries += 1; await pending; });
  const first = submit();
  await new Promise(resolve => setImmediate(resolve));
  const second = await submit();
  const conflict = await submit({ contactValue: "another@example.com" });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.body.code, "SUBMISSION_ID_REUSED");
  assert.equal(deliveries, 1);
  release();
  const initial = await first;
  assert.deepEqual(initial.body, acknowledgement);
  assert.equal(second.statusCode, 503);
  assert.equal(second.body.code, "DELIVERY_RECONCILIATION_REQUIRED");
  assert.deepEqual((await submit()).body, initial.body);
  assert.equal((await submit({ name: "Ірина" })).statusCode, 409);
  assert.equal(deliveries, 1);
});

test("an ambiguous failed delivery emits no accepted ID and never automatically replays", async () => {
  let deliveries = 0;
  const submit = fixture(async () => {
    deliveries += 1;
    if (deliveries === 1) throw new Error("Simulated webhook failure");
  });
  const failed = await submit();
  assert.equal(failed.statusCode, 503);
  assert.equal(failed.body.code, "DELIVERY_RECONCILIATION_REQUIRED");
  assert.equal(failed.body.ok, undefined);
  assert.equal(failed.body.submissionId, undefined);
  assert.equal((await submit()).body.code, "DELIVERY_RECONCILIATION_REQUIRED");
  assert.equal(deliveries, 1);
});

test("short submission guards reject other origins and form content types", async () => {
  let deliveries = 0;
  const submit = fixture(async () => { deliveries += 1; });
  assert.equal((await submit({}, { headers: { origin: "https://unknown.example", "content-type": "application/json" } })).statusCode, 403);
  assert.equal((await submit({}, { headers: { origin, "content-type": "text/plain" } })).statusCode, 415);
  assert.equal(deliveries, 0);
});

test("legacy enquiries still reject missing required fields and ignore short-form metadata", async () => {
  let payload;
  const submit = fixture(async value => { payload = value; });
  const legacy = {
    formVersion: undefined,
    email: "student@example.com",
    contactMethod: undefined,
    contactValue: undefined,
    englishLevel: "B1 (Середній)",
    availability: "Вечір",
    privacyConsent: true,
    attribution: { utm_source: "youtube" }
  };
  const invalid = await submit({ ...legacy, availability: "" });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.code, "INVALID_AVAILABILITY");
  assert.equal((await submit(legacy)).statusCode, 200);
  assert.equal(payload.formVersion, undefined);
  assert.equal(payload.acquisitionChannel, undefined);
  assert.equal(payload.attribution, undefined);
  assert.equal(payload.consentVersion, "privacy-policy-2026-08");
  assert.equal(payload.englishLevel, "B1 (Середній)");
});

test("channel identifies the funnel independently of campaign tags or claims from a legacy caller", async () => {
  const calls = [];
  const submit = fixture(async payload => { calls.push(payload); });
  assert.equal((await submit({ acquisitionChannel: "paid_landing", attribution: {} })).statusCode, 200);
  assert.equal(calls[0].acquisitionChannel, "paid_landing");
  assert.deepEqual(calls[0].attribution, {});
  const legacy = {
    formVersion: undefined,
    acquisitionChannel: "paid_landing",
    email: "student@example.com",
    contactMethod: undefined,
    contactValue: undefined,
    englishLevel: "B1 (Середній)",
    availability: "Вечір",
    privacyConsent: true
  };
  assert.equal((await submit(legacy)).statusCode, 200);
  assert.equal(calls[1].acquisitionChannel, undefined);
});

test("independent cold handlers share one durable accepted result", async () => {
  const db = createFakeAssessmentDatabase();
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let deliveries = 0;
  const deliver = async () => { deliveries += 1; await pending; };
  const firstProcess = fixture(deliver, undefined, db);
  const secondProcess = fixture(deliver, undefined, db);
  const first = firstProcess();
  await new Promise(resolve => setImmediate(resolve));
  const concurrent = await secondProcess();
  assert.equal(concurrent.statusCode, 503);
  assert.equal(concurrent.body.code, "DELIVERY_RECONCILIATION_REQUIRED");
  assert.equal(deliveries, 1);
  release();
  assert.equal((await first).statusCode, 200);
  const thirdProcess = fixture(deliver, undefined, db);
  assert.deepEqual((await thirdProcess()).body, acknowledgement);
  assert.equal((await thirdProcess({ name: "Ірина" })).statusCode, 409);
  assert.equal(deliveries, 1);
  const metadata = JSON.stringify([...db.documents.values()]);
  assert.equal(metadata.includes("Олена"), false);
  assert.equal(metadata.includes("test@example.com"), false);
  assert.equal(metadata.includes(submissionId), false);
});

test("a lost claim-create response cannot send until a stale unsent claim is reclaimed", async () => {
  let fail = true;
  let timestamp = 100000;
  const db = createFakeAssessmentDatabase({
    afterCreate() {
      if (fail) { fail = false; throw new Error("Lost database response after commit"); }
    }
  });
  let deliveries = 0;
  const submit = fixture(async () => { deliveries += 1; }, () => timestamp, db);
  assert.equal((await submit()).body.code, "DELIVERY_RECONCILIATION_REQUIRED");
  assert.equal((await submit()).statusCode, 503);
  assert.equal(deliveries, 0);
  timestamp += 61000;
  assert.equal((await submit()).statusCode, 200);
  assert.equal(deliveries, 1);
});

test("a known pre-send failure releases its claim for an identical retry", async () => {
  let fail = true;
  const db = createFakeAssessmentDatabase({
    beforePatch({ fields }) {
      if (fields.state === "sending" && fail) {
        fail = false;
        throw new Error("Database connection failed before update");
      }
    }
  });
  let deliveries = 0;
  const submit = fixture(async () => { deliveries += 1; }, undefined, db);
  assert.equal((await submit()).body.code, "DELIVERY_RECONCILIATION_REQUIRED");
  assert.equal(deliveries, 0);
  assert.equal([...db.documents.values()][0].state, "released");
  assert.equal((await submit()).statusCode, 200);
  assert.equal(deliveries, 1);
});

test("a lost pre-send state response is safely released because no outbound attempt occurred", async () => {
  let fail = true;
  const db = createFakeAssessmentDatabase({
    afterPatch({ fields }) {
      if (fields.state === "sending" && fail) {
        fail = false;
        throw new Error("Lost sending-state response");
      }
    }
  });
  let deliveries = 0;
  const submit = fixture(async () => { deliveries += 1; }, undefined, db);
  assert.equal((await submit()).statusCode, 503);
  assert.equal([...db.documents.values()][0].state, "released");
  assert.equal((await submit()).statusCode, 200);
  assert.equal(deliveries, 1);
});

test("a provider receipt followed by an uncommitted acceptance stays in reconciliation without replay", async () => {
  const db = createFakeAssessmentDatabase({
    beforePatch({ fields }) {
      if (fields.state === "accepted") throw new Error("Acceptance write rejected");
    }
  });
  let deliveries = 0;
  const submit = fixture(async () => { deliveries += 1; }, undefined, db);
  assert.equal((await submit()).body.code, "DELIVERY_RECONCILIATION_REQUIRED");
  assert.equal([...db.documents.values()][0].state, "reconcile");
  const otherProcess = fixture(async () => { deliveries += 1; }, undefined, db);
  assert.equal((await otherProcess()).statusCode, 503);
  assert.equal(deliveries, 1);
});

test("a lost response after durable acceptance is recovered by a confirming read", async () => {
  let fail = true;
  const db = createFakeAssessmentDatabase({
    afterPatch({ fields }) {
      if (fields.state === "accepted" && fail) {
        fail = false;
        throw new Error("Lost acceptance response after commit");
      }
    }
  });
  let deliveries = 0;
  const submit = fixture(async () => { deliveries += 1; }, undefined, db);
  assert.deepEqual((await submit()).body, acknowledgement);
  assert.equal([...db.documents.values()][0].state, "accepted");
  assert.equal(deliveries, 1);
});

test("a process crash after entering sending requires reconciliation even if no receipt is known", async () => {
  const db = createFakeAssessmentDatabase();
  const options = { db, namespace: "test_assessment_short_delivery_v1" };
  const crashedStore = createAssessmentDeliveryStore(options);
  const payload = { submissionId, source: "test" };
  const claim = await crashedStore.claim(payload);
  await crashedStore.beginSend(claim);
  const freshStore = createAssessmentDeliveryStore(options);
  await assert.rejects(freshStore.claim(payload), error => error.code === "DELIVERY_RECONCILIATION_REQUIRED");
  assert.equal([...db.documents.values()][0].state, "sending");
});

test("an expired unsent claim is acquired atomically and the stale worker cannot begin a send", async () => {
  let timestamp = 100000;
  const db = createFakeAssessmentDatabase();
  const options = { db, now: () => timestamp, namespace: "test_assessment_short_delivery_v1" };
  const firstStore = createAssessmentDeliveryStore(options);
  const payload = { submissionId, source: "test" };
  const stale = await firstStore.claim(payload);
  timestamp += 61000;
  const replacementStore = createAssessmentDeliveryStore(options);
  const replacement = await replacementStore.claim(payload);
  await assert.rejects(firstStore.beginSend(stale), error => error.status === 409);
  await assert.rejects(firstStore.releaseBeforeSend(stale), error => error.code === "DELIVERY_RECONCILIATION_REQUIRED");
  await replacementStore.beginSend(replacement);
  assert.equal([...db.documents.values()][0].state, "sending");
});

test("missing outbound configuration creates no delivery claim", async () => {
  const previous = process.env.ZAPIER_ASSESSMENT_WEBHOOK_URL;
  delete process.env.ZAPIER_ASSESSMENT_WEBHOOK_URL;
  let claims = 0;
  const handler = createHandler({
    origins: new Set([origin]),
    deliveryStore: { async claim() { claims += 1; } },
    logError() {}
  });
  const result = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; } };
  try {
    await handler({
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: { formVersion: "teaching_short_v1", submissionId, name: "Олена", contactMethod: "email", contactValue: "test@example.com", consentAccepted: true, website: "" }
    }, result);
    assert.equal(result.statusCode, 500);
    assert.equal(claims, 0);
  } finally {
    if (previous === undefined) delete process.env.ZAPIER_ASSESSMENT_WEBHOOK_URL;
    else process.env.ZAPIER_ASSESSMENT_WEBHOOK_URL = previous;
  }
});

test("invalid outbound configuration creates no delivery claim", async () => {
  const previous = process.env.ZAPIER_ASSESSMENT_WEBHOOK_URL;
  let claims = 0;
  const handler = createHandler({
    origins: new Set([origin]),
    deliveryStore: { async claim() { claims += 1; } },
    logError() {}
  });
  try {
    for (const destination of ["not a URL", "http://hooks.example.test/webhook", "https://user:pass@hooks.example.test/webhook"]) {
      process.env.ZAPIER_ASSESSMENT_WEBHOOK_URL = destination;
      const result = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; } };
      await handler({
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: { formVersion: "teaching_short_v1", submissionId, name: "Олена", contactMethod: "email", contactValue: "test@example.com", consentAccepted: true, website: "" }
      }, result);
      assert.equal(result.statusCode, 500);
    }
    assert.equal(claims, 0);
  } finally {
    if (previous === undefined) delete process.env.ZAPIER_ASSESSMENT_WEBHOOK_URL;
    else process.env.ZAPIER_ASSESSMENT_WEBHOOK_URL = previous;
  }
});

test("Preview storage is isolated and rejects a production namespace", async () => {
  const previous = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = "preview";
  const db = createFakeAssessmentDatabase();
  try {
    const store = createAssessmentDeliveryStore({ db });
    await store.claim({ submissionId, source: "test" });
    assert.match([...db.documents.keys()][0], /^preview_assessment_short_delivery_v1\//);
    assert.throws(() => createAssessmentDeliveryStore({ db, namespace: "assessment_short_delivery_v1" }), /Preview/);
  } finally {
    if (previous === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previous;
  }
});
