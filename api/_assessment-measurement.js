const { createHash } = require("node:crypto");

const UTM_FIELDS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
const CAMPAIGN_FIELDS = ["campaign_id", "ad_id", "adset_id", "adgroup_id", "creative_id"];
const CLICK_FIELDS = ["fbclid", "ttclid", "gclid", "gbraid", "wbraid"];

function safeTag(value) {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length <= 120 && /^[\p{L}\p{N}][\p{L}\p{N}_.+ -]*$/u.test(text) ? text : undefined;
}

function safeTouch(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const result = {};
  for (const field of UTM_FIELDS) {
    const value = Object.hasOwn(input, field) ? safeTag(input[field]) : undefined;
    if (value !== undefined) result[field] = value;
  }
  for (const field of CAMPAIGN_FIELDS) {
    const value = Object.hasOwn(input, field) ? input[field] : undefined;
    if (typeof value === "string" && /^[0-9]{1,30}$/.test(value)) result[field] = value;
  }
  for (const field of CLICK_FIELDS) {
    const value = Object.hasOwn(input, field) ? input[field] : undefined;
    if (typeof value === "string" && /^[A-Za-z0-9._~-]{1,256}$/.test(value)) result[field] = value;
  }
  if (Object.hasOwn(input, "landingPath") && typeof input.landingPath === "string" &&
      input.landingPath.length <= 160 && /^\/[A-Za-z0-9_./-]*$/.test(input.landingPath) &&
      !input.landingPath.startsWith("//") && !input.landingPath.includes("..")) {
    result.landingPath = input.landingPath;
  }
  if (Object.hasOwn(input, "referrerHost") && typeof input.referrerHost === "string") {
    const host = input.referrerHost.toLowerCase();
    if (host.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) {
      result.referrerHost = host;
    }
  }
  if (Object.hasOwn(input, "capturedAt") && typeof input.capturedAt === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.capturedAt)) {
    const timestamp = new Date(input.capturedAt);
    if (Number.isFinite(timestamp.getTime()) && timestamp.toISOString() === input.capturedAt) {
      result.capturedAt = input.capturedAt;
    }
  }
  return Object.keys(result).length ? result : undefined;
}

function normalizeMeasurement(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      !Object.hasOwn(input, "schemaVersion") || input.schemaVersion !== 1) return null;
  const result = { schemaVersion: 1, testMode: Object.hasOwn(input, "testMode") && input.testMode === true };
  for (const field of ["firstTouch", "lastTouch"]) {
    const touch = Object.hasOwn(input, field) ? safeTouch(input[field]) : undefined;
    if (touch) result[field] = touch;
  }
  return result;
}

function hasTechnicalName(name) {
  const normalized = String(name).normalize("NFKC").replace(/[\s_\p{Pd}]+/gu, " ").trim().toUpperCase();
  return /^TECHNICAL TEST(?=$|[^\p{L}\p{M}\p{N}])/u.test(normalized);
}

function technicalTouch(touch) {
  return touch && (String(touch.utm_source || "").toLowerCase() === "technical_test" ||
    String(touch.utm_medium || "").toLowerCase() === "internal_test");
}

function assessmentMeasurement(submission, input) {
  const request = normalizeMeasurement(input);
  const test = hasTechnicalName(submission.name) || Boolean(request &&
    (request.testMode || technicalTouch(request.firstTouch) || technicalTouch(request.lastTouch)));
  const form = submission.formVersion || "legacy_assessment";
  const digest = createHash("sha256").update(`enquiry_measurement_v1:${form}:${submission.submissionId.toLowerCase()}`).digest("hex");
  const metadata = {
    schemaVersion: 1,
    enquiryId: `sd_enq_${digest.slice(0, 32)}`,
    test,
    leadEligible: !test,
    classification: test ? "declared_technical_test" : "ordinary_enquiry"
  };
  for (const field of ["firstTouch", "lastTouch"]) {
    if (request && request[field]) metadata[field] = request[field];
  }
  return { request, metadata };
}

function staffMeasurementLabel(original, metadata) {
  const parts = [original, `Заявка: ${metadata.enquiryId}.`, metadata.test
    ? "TECHNICAL TEST — технічна перевірка, не звернення студента."
    : "Звичайна заявка."];
  for (const [field, label] of [["firstTouch", "Перший перехід"], ["lastTouch", "Останній перехід"]]) {
    if (!metadata[field]) continue;
    const tags = [...UTM_FIELDS, ...CAMPAIGN_FIELDS, "referrerHost", "landingPath"]
      .filter(key => Object.hasOwn(metadata[field], key))
      .map(key => `${key}=${metadata[field][key]}`);
    if (!metadata[field].ad_id) tags.push("числовий ad_id не передано; точне оголошення не визначено");
    if (tags.length) parts.push(`${label}: ${tags.join(" · ")}.`);
  }
  if (!metadata.firstTouch && !metadata.lastTouch) parts.push("Числовий ad_id не передано; точне оголошення не визначено.");
  if (metadata.firstTouch || metadata.lastTouch) parts.push("Позначки посилання; рекламний перехід не підтверджено.");
  return parts.filter(Boolean).join(" ");
}

function outgoingMeasurement(payload, measurement) {
  return {
    ...payload,
    name: measurement.metadata.test && !hasTechnicalName(payload.name)
      ? `TECHNICAL TEST - ${payload.name}` : payload.name,
    enquiryId: measurement.metadata.enquiryId,
    technicalTest: measurement.metadata.test,
    leadEligible: measurement.metadata.leadEligible,
    measurementVersion: 1,
    measurement: measurement.metadata,
    referralSourceLabel: staffMeasurementLabel(payload.referralSourceLabel, measurement.metadata)
  };
}

function acceptedResponse(submissionId, measurement) {
  return {
    ok: true,
    accepted: true,
    submissionId,
    enquiryId: measurement.metadata.enquiryId,
    test: measurement.metadata.test,
    leadEligible: measurement.metadata.leadEligible,
    measurementVersion: 1
  };
}

module.exports = { assessmentMeasurement, outgoingMeasurement, acceptedResponse, normalizeMeasurement, hasTechnicalName };
