const { createHash, randomUUID } = require("node:crypto");
const MAX_BODY_BYTES = 16 * 1024;
const SHORT_FORM_VERSION = "teaching_short_v1";
const SHORT_CONSENT_VERSION = "assessment-teaching-short-2026-11";
const SHORT_CONTACT_METHODS = new Set(["email", "telegram", "whatsapp", "viber"]);
const ATTRIBUTION_FIELDS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
const CLAIM_LEASE_MS = 60 * 1000;
const LEVELS = new Set([
  "A1 (Початковий)",
  "A2 (Нижче середнього)",
  "B1 (Середній)",
  "B2 (Вище середнього)",
  "C1 (Просунутий)",
  "Не знаю"
]);
const AVAILABILITY = new Set(["Ранок", "День", "Вечір", "У будь-який час"]);
const { assessmentContact, assessmentReferral } = require("./_assessment-contact");
const { assessmentLocation } = require("./_assessment-location");

function createHandler({ deliver: sendAssessment = deliver, deliveryStore, origins, now = Date.now, logError = console.error } = {}) {
  let shortStore = deliveryStore;

  async function sendShortOnce(payload) {
    // Fail before creating a claim when no outbound destination is configured.
    if (sendAssessment === deliver) assertDeliveryConfigured(true);
    if (!shortStore) shortStore = createAssessmentDeliveryStore({ now });
    const lock = await shortStore.claim(payload);
    if (lock.accepted) return;

    let sending;
    try {
      sending = await shortStore.beginSend(lock);
    } catch (error) {
      // No webhook invocation occurred, so releasing this owner is safe.
      await shortStore.releaseBeforeSend(lock).catch(() => {});
      throw reconciliationRequired();
    }

    try {
      await sendAssessment({
        ...payload,
        referralSourceLabel: shortReferralLabel(payload.attribution),
        deliveryReference: lock.documentId,
        submittedAt: new Date(now()).toISOString()
      });
    } catch (error) {
      // A timeout or non-2xx acknowledgement may follow remote receipt.
      await shortStore.flagForReconciliation(sending, "WEBHOOK_OUTCOME_UNKNOWN").catch(() => {});
      throw reconciliationRequired();
    }

    try {
      await shortStore.complete(sending);
    } catch (error) {
      // Re-read after an uncertain write before withholding acknowledgement.
      if (await shortStore.isAccepted(sending).catch(() => false)) return;
      await shortStore.flagForReconciliation(sending, "ACCEPTANCE_WRITE_UNKNOWN").catch(() => {});
      throw reconciliationRequired();
    }
  }

  return async function handler(req, res) {
    const permittedOrigins = origins || allowedOrigins();
    setCors(req, res, permittedOrigins);
    res.setHeader("Cache-Control", "no-store");

    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST, OPTIONS");
      return res.status(405).json({ error: "Method not allowed." });
    }

    try {
      assertAllowedOrigin(req, permittedOrigins);
      assertJsonRequest(req);
      const submission = validateSubmission(req.body);
      if (submission.website) return res.status(202).json({ ok: true });

      const payload = assessmentPayload(submission);
      if (submission.formVersion === SHORT_FORM_VERSION) {
        await sendShortOnce(payload);
      } else {
        await sendAssessment({ ...payload, submittedAt: new Date(now()).toISOString() });
      }
      return res.status(200).json({ ok: true, submissionId: submission.submissionId });
    } catch (error) {
      logError("Assessment endpoint failed:", safeError(error));
      if (error instanceof HttpError) {
        return res.status(error.status).json({ error: error.publicMessage, code: error.code });
      }
      return res.status(500).json({ error: "Unable to submit assessment request." });
    }
  };
}

function assessmentPayload(submission) {
  const payload = {
    event: "assessment-request",
    submissionId: submission.submissionId,
    name: submission.name,
    email: submission.email,
    phone: submission.phone,
    ...submission.contact,
    ...submission.referral,
    ...submission.location,
    englishLevel: submission.englishLevel,
    goal: submission.goal,
    availability: submission.availability,
    privacyConsent: true,
    consentVersion: submission.contact.contactSchemaVersion === 2 ? "assessment-direct-contact-2026-10" : "privacy-policy-2026-08",
    source: "speakdobre-home"
  };
  if (submission.formVersion === SHORT_FORM_VERSION) {
    payload.formVersion = SHORT_FORM_VERSION;
    payload.acquisitionChannel = "paid_landing";
    payload.consentVersion = SHORT_CONSENT_VERSION;
    payload.attribution = submission.attribution;
  }
  return payload;
}

function validateSubmission(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Invalid request.", "INVALID_BODY");
  }
  if (body.formVersion === SHORT_FORM_VERSION) return validateShortSubmission(body);

  const submissionId = cleanText(body.submissionId, 64);
  const name = cleanText(body.name, 120);
  const email = cleanText(body.email, 254).toLowerCase();
  const phone = cleanText(body.phone, 32);
  const englishLevel = cleanText(body.englishLevel, 40);
  const goal = cleanText(body.goal, 1000);
  const availability = cleanText(body.availability, 40);
  const website = cleanText(body.website, 200);

  if (!isUuid(submissionId)) throw new HttpError(400, "Invalid submission identifier.", "INVALID_SUBMISSION_ID");
  if (name.length < 2) throw new HttpError(400, "Enter your name.", "INVALID_NAME");
  if (!isEmail(email)) throw new HttpError(400, "Enter a valid email address.", "INVALID_EMAIL");
  if (phone && !/^\+?[0-9 ()-]{7,32}$/.test(phone)) {
    throw new HttpError(400, "Enter a valid phone number.", "INVALID_PHONE");
  }
  if (!LEVELS.has(englishLevel)) throw new HttpError(400, "Select your English level.", "INVALID_LEVEL");
  if (!AVAILABILITY.has(availability)) throw new HttpError(400, "Select your availability.", "INVALID_AVAILABILITY");
  if (body.privacyConsent !== true) throw new HttpError(400, "Privacy consent is required.", "CONSENT_REQUIRED");
  const contact = assessmentContact(body, email);
  if (!contact) throw new HttpError(400, "Оберіть спосіб зв’язку та вкажіть коректний контакт: @username для Telegram або номер із кодом країни, наприклад +380…", "INVALID_CONTACT");
  const referral=assessmentReferral(body);
  if (!referral) throw new HttpError(400, "Оберіть один із запропонованих варіантів, звідки ви дізналися про SpeakDobre.", "INVALID_REFERRAL");
  const location = assessmentLocation(body);
  if (!location) throw new HttpError(400, "Вкажіть країну, де ви зараз перебуваєте. Місто — необов’язково. Використовуйте до 80 символів без посилань і спеціальної розмітки.", "INVALID_LOCATION");

  return { submissionId, name, email, phone, englishLevel, goal, availability, website, contact, referral, location };
}

function validateShortSubmission(body) {
  if (body.acquisitionChannel !== undefined && body.acquisitionChannel !== "paid_landing") {
    throw new HttpError(400, "Invalid acquisition channel.", "INVALID_ACQUISITION_CHANNEL");
  }
  const submissionId = typeof body.submissionId === "string" ? body.submissionId : "";
  if (!isUuid(submissionId)) throw new HttpError(400, "Invalid submission identifier.", "INVALID_SUBMISSION_ID");

  const name = typeof body.name === "string" ? body.name.trim().normalize("NFC") : "";
  if (name.length > 120 || !/^[\p{L}][\p{L}\p{M} .'’ʼ-]*$/u.test(name)) {
    throw new HttpError(400, "Enter your name.", "INVALID_NAME");
  }
  if (body.consentAccepted !== true) throw new HttpError(400, "Privacy consent is required.", "CONSENT_REQUIRED");

  const method = body.contactMethod;
  const value = body.contactValue;
  const invalidContact = () => new HttpError(400, "Enter a valid contact for the selected method.", "INVALID_CONTACT");
  if (!SHORT_CONTACT_METHODS.has(method) || typeof value !== "string" || /[\u0000-\u001f\u007f]/.test(value)) {
    throw invalidContact();
  }

  const email = method === "email" ? value.trim().toLowerCase() : "";
  if (method === "email" && (value.length > 254 || !isEmail(email) || /[<>]|^[=+@-]/.test(email))) {
    throw invalidContact();
  }
  const contact = method === "email"
    ? assessmentContact({ contactMethod: method }, email)
    : assessmentContact({ contactMethod: method, contactValue: value }, "");
  if (!contact) throw invalidContact();

  const website = typeof body.website === "string" ? body.website.trim() : "";
  return {
    formVersion: SHORT_FORM_VERSION,
    submissionId,
    name,
    email,
    phone: contact.contactValue.startsWith("+") ? contact.contactValue : "",
    website,
    contact,
    referral: assessmentReferral({}),
    location: assessmentLocation({}),
    englishLevel: "",
    goal: "",
    availability: "",
    attribution: assessmentAttribution(body.attribution)
  };
}

function assessmentAttribution(input) {
  const result = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return result;
  for (const field of ATTRIBUTION_FIELDS) {
    const value = Object.hasOwn(input, field) && typeof input[field] === "string" ? input[field].trim() : "";
    if (value.length <= 120 && /^[\p{L}\p{N}][\p{L}\p{N}_.+ -]*$/u.test(value)) result[field] = value;
  }
  return result;
}

function shortReferralLabel(attribution) {
  const tags = ATTRIBUTION_FIELDS
    .filter(field => Object.hasOwn(attribution, field))
    .map(field => `${field.slice(4)}=${attribution[field]}`);
  const prefix = "Не запитували. Форма: рекламна сторінка уроків.";
  if (!tags.length) return `${prefix} Позначок UTM немає.`;
  return `${prefix} UTM ${tags.join(" · ")}. Це позначки посилання, рекламний перехід не перевірено.`;
}

function reconciliationRequired() {
  return new HttpError(503, "Delivery needs confirmation. Keep this submission identifier and contact support.", "DELIVERY_RECONCILIATION_REQUIRED");
}

function createAssessmentDeliveryStore({ db, now = Date.now, namespace } = {}) {
  const collection = namespace || (process.env.VERCEL_ENV === "preview"
    ? "preview_assessment_short_delivery_v1"
    : "assessment_short_delivery_v1");
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(collection)) throw new Error("Invalid assessment delivery namespace.");
  if (process.env.VERCEL_ENV === "preview" && !collection.startsWith("preview_")) {
    throw new Error("Preview assessment delivery namespace required.");
  }
  const database = () => db || require("./_platform-shared");
  const path = documentId => `${collection}/${documentId}`;
  const sha256 = value => createHash("sha256").update(value).digest("hex");

  function lockFor(documentId, record) {
    if (!record?._updateTime || !record.operationToken) throw reconciliationRequired();
    return {
      documentId,
      requestHash: record.requestHash,
      operationToken: record.operationToken,
      updateTime: record._updateTime
    };
  }

  async function ownedRecord(lock) {
    const record = await database().getDocument(path(lock.documentId));
    if (!record || record.requestHash !== lock.requestHash || record.operationToken !== lock.operationToken) {
      throw reconciliationRequired();
    }
    return record;
  }

  return {
    async claim(payload) {
      const documentId = sha256(`${SHORT_FORM_VERSION}:${payload.submissionId.toLowerCase()}`);
      const requestHash = sha256(JSON.stringify(payload));
      const timestamp = now();
      const operationToken = randomUUID();
      const fields = {
        schemaVersion: 1,
        requestHash,
        operationToken,
        state: "claimed",
        createdAt: new Date(timestamp).toISOString(),
        updatedAt: new Date(timestamp).toISOString(),
        leaseUntil: timestamp + CLAIM_LEASE_MS,
        reason: ""
      };
      try {
        const record = await database().createDocument(collection, documentId, fields);
        return lockFor(documentId, record);
      } catch (error) {
        if (error?.status !== 409) throw reconciliationRequired();
      }

      let previous;
      try {
        previous = await database().getDocument(path(documentId));
      } catch (error) {
        throw reconciliationRequired();
      }
      if (!previous || previous.schemaVersion !== 1) throw reconciliationRequired();
      if (previous.requestHash !== requestHash) {
        throw new HttpError(409, "Submission identifier already in use.", "SUBMISSION_ID_REUSED");
      }
      if (previous.state === "accepted") return { accepted: true, documentId };
      const mayReclaim = previous.state === "released" ||
        (previous.state === "claimed" && Number.isFinite(previous.leaseUntil) && previous.leaseUntil <= timestamp);
      if (!mayReclaim) throw reconciliationRequired();
      try {
        const claimed = await database().patchDocument(path(documentId), {
          operationToken,
          state: "claimed",
          updatedAt: new Date(timestamp).toISOString(),
          leaseUntil: timestamp + CLAIM_LEASE_MS,
          reason: ""
        }, { updateTime: previous._updateTime });
        return lockFor(documentId, claimed);
      } catch (error) {
        throw reconciliationRequired();
      }
    },

    async beginSend(lock) {
      const record = await database().patchDocument(path(lock.documentId), {
        state: "sending",
        updatedAt: new Date(now()).toISOString(),
        leaseUntil: null
      }, { updateTime: lock.updateTime });
      return lockFor(lock.documentId, record);
    },

    async releaseBeforeSend(lock) {
      const record = await ownedRecord(lock);
      if (record.state !== "claimed" && record.state !== "sending") return;
      await database().patchDocument(path(lock.documentId), {
        state: "released",
        updatedAt: new Date(now()).toISOString(),
        leaseUntil: null,
        reason: "NO_OUTBOUND_ATTEMPT"
      }, { updateTime: record._updateTime });
    },

    async complete(lock) {
      const record = await ownedRecord(lock);
      if (record.state !== "sending") throw reconciliationRequired();
      return database().patchDocument(path(lock.documentId), {
        state: "accepted",
        acceptedAt: new Date(now()).toISOString(),
        updatedAt: new Date(now()).toISOString(),
        leaseUntil: null,
        reason: ""
      }, { updateTime: record._updateTime });
    },

    async isAccepted(lock) {
      const record = await database().getDocument(path(lock.documentId));
      return record?.state === "accepted" && record.requestHash === lock.requestHash;
    },

    async flagForReconciliation(lock, reason) {
      const record = await ownedRecord(lock);
      if (record.state === "accepted") return;
      await database().patchDocument(path(lock.documentId), {
        state: "reconcile",
        updatedAt: new Date(now()).toISOString(),
        leaseUntil: null,
        reason
      }, { updateTime: record._updateTime });
    }
  };
}

function assertJsonRequest(req) {
  const type = String(req.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  if (type !== "application/json") throw new HttpError(415, "JSON content type required.", "UNSUPPORTED_MEDIA_TYPE");

  const declaredLength = Number(req.headers["content-length"] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new HttpError(413, "Request is too large.", "REQUEST_TOO_LARGE");
  }

  const measuredLength = Buffer.byteLength(JSON.stringify(req.body || {}), "utf8");
  if (measuredLength > MAX_BODY_BYTES) throw new HttpError(413, "Request is too large.", "REQUEST_TOO_LARGE");
}

async function deliver(payload) {
  const url = assertDeliveryConfigured();

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new HttpError(502, "Unable to deliver assessment request.", "DELIVERY_FAILED");
}

function assertDeliveryConfigured(requireSecureWebhook = false) {
  const url = process.env.ZAPIER_ASSESSMENT_WEBHOOK_URL;
  if (!url) throw new Error("ZAPIER_ASSESSMENT_WEBHOOK_URL is not configured.");
  if (requireSecureWebhook) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      throw new Error("Assessment delivery requires a configured HTTPS webhook.");
    }
  }
  return url;
}

function setCors(req, res, origins) {
  const origin = req.headers.origin;
  if (origin && origins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function assertAllowedOrigin(req, origins) {
  const origin = req.headers.origin;
  if (!origin || !origins.has(origin)) throw new HttpError(403, "Origin not allowed.", "ORIGIN_NOT_ALLOWED");
}

function allowedOrigins() {
  return new Set(String(process.env.ALLOWED_ORIGINS || "https://speakdobre.com,https://www.speakdobre.com")
    .split(",").map(value => value.trim()).filter(Boolean));
}

function cleanText(value, maxLength) {
  return String(value || "").replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, maxLength);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isEmail(value) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function safeError(error) {
  return error instanceof HttpError
    ? { name: error.name, status: error.status, code: error.code }
    : { name: error?.name || "Error" };
}

class HttpError extends Error {
  constructor(status, publicMessage, code) {
    super(publicMessage);
    this.name = "HttpError";
    this.status = status;
    this.publicMessage = publicMessage;
    this.code = code;
  }
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.createAssessmentDeliveryStore = createAssessmentDeliveryStore;
module.exports._test = { validateSubmission, isEmail, isUuid, MAX_BODY_BYTES };


