const MAX_BODY_BYTES = 16 * 1024;
const LEVELS = new Set([
  "A1 (Початковий)",
  "A2 (Нижче середнього)",
  "B1 (Середній)",
  "B2 (Вище середнього)",
  "C1 (Просунутий)",
  "Не знаю"
]);
const AVAILABILITY = new Set(["Ранок", "День", "Вечір", "У будь-який час"]);

module.exports = async function handler(req, res) {
  setCors(req, res);
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    assertAllowedOrigin(req);
    assertJsonRequest(req);
    const submission = validateSubmission(req.body);

    // Silently accept bot-filled honeypots without forwarding personal data.
    if (submission.website) return res.status(202).json({ ok: true });

    const payload = {
      event: "assessment-request",
      submissionId: submission.submissionId,
      name: submission.name,
      email: submission.email,
      phone: submission.phone,
      englishLevel: submission.englishLevel,
      goal: submission.goal,
      availability: submission.availability,
      privacyConsent: true,
      consentVersion: "privacy-policy-2026-08",
      source: "speakdobre-home",
      submittedAt: new Date().toISOString()
    };

    await deliver(payload);
    return res.status(200).json({ ok: true, submissionId: submission.submissionId });
  } catch (error) {
    console.error("Assessment endpoint failed:", safeError(error));
    if (error instanceof HttpError) {
      return res.status(error.status).json({ error: error.publicMessage, code: error.code });
    }
    return res.status(500).json({ error: "Unable to submit assessment request." });
  }
};

function validateSubmission(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Invalid request.", "INVALID_BODY");
  }

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

  return { submissionId, name, email, phone, englishLevel, goal, availability, website };
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
  const url = process.env.ZAPIER_ASSESSMENT_WEBHOOK_URL;
  if (!url) throw new Error("ZAPIER_ASSESSMENT_WEBHOOK_URL is not configured.");

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new HttpError(502, "Unable to deliver assessment request.", "DELIVERY_FAILED");
}

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && allowedOrigins().has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function assertAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin || !allowedOrigins().has(origin)) throw new HttpError(403, "Origin not allowed.", "ORIGIN_NOT_ALLOWED");
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
  return { name: error?.name, message: error?.message, status: error?.status, code: error?.code };
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

module.exports._test = { validateSubmission, isEmail, isUuid, MAX_BODY_BYTES };
