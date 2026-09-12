const crypto = require("node:crypto");

const MEMBERSTACK_BASE_URL = "https://admin.memberstack.com";
const FIRESTORE_BASE_URL = "https://firestore.googleapis.com/v1";
const BOOKING_COLLECTION = "trialBookings";
const ELIGIBILITY_COLLECTION = "trialBookingEligibility";
const KYIV_TIME_ZONE = "Europe/Kyiv";
const MEETING_METHODS = new Set(["google-meet", "zoom", "skype", "other", "no-preference"]);
const CONTACT_CHANNELS = new Set(["telegram", "whatsapp", "viber", "signal", "messenger", "email", "other"]);
const MAX_BODY_BYTES = 16 * 1024;
let cachedGoogleToken = null;

function collectionName(base) {
  const namespace = String(process.env.TRIAL_BOOKING_DATA_NAMESPACE || "").trim();
  if (!namespace) return base;
  if (!/^[A-Za-z0-9_-]{1,48}$/.test(namespace)) throw new Error("Invalid TRIAL_BOOKING_DATA_NAMESPACE.");
  return `${namespace}_${base}`;
}

class HttpError extends Error {
  constructor(status, publicMessage, code, details) {
    super(publicMessage);
    this.name = "HttpError";
    this.status = status;
    this.publicMessage = publicMessage;
    this.code = code;
    this.details = details;
  }
}

function trialBookingEnabled() {
  return String(process.env.TRIAL_BOOKING_ENABLED || "").toLowerCase() === "true";
}

function requireTrialEnvironment() {
  const required = [
    "MEMBERSTACK_SECRET_KEY",
    "FIREBASE_PROJECT_ID",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY",
    "TRIAL_ELIGIBILITY_HMAC_SECRET",
    "ALLOWED_ORIGINS"
  ];
  const missing = required.filter(name => !process.env[name]);
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(", ")}`);
}

function setCors(req, res, methods = "GET, POST, OPTIONS") {
  const origin = req.headers.origin;
  if (origin && allowedOrigins().has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Cache-Control", "no-store");
}

function assertAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin || !allowedOrigins().has(origin)) {
    throw new HttpError(403, "Origin not allowed.", "ORIGIN_NOT_ALLOWED");
  }
}

function allowedOrigins() {
  return new Set(String(process.env.ALLOWED_ORIGINS || "https://speakdobre.com,https://www.speakdobre.com")
    .split(",").map(value => value.trim()).filter(Boolean));
}

function assertJsonRequest(req) {
  const type = String(req.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  if (type !== "application/json") {
    throw new HttpError(415, "JSON content type required.", "UNSUPPORTED_MEDIA_TYPE");
  }
  const measured = Buffer.byteLength(JSON.stringify(req.body || {}), "utf8");
  if (measured > MAX_BODY_BYTES) {
    throw new HttpError(413, "Request is too large.", "REQUEST_TOO_LARGE");
  }
}

function readBearerToken(header) {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return "";
  return header.slice(7).trim();
}

async function verifyMember(req) {
  const token = readBearerToken(req.headers.authorization);
  if (!token) throw new HttpError(401, "Authentication required.", "AUTH_REQUIRED");

  const verifiedResponse = await fetch(`${MEMBERSTACK_BASE_URL}/members/verify-token`, {
    method: "POST",
    headers: memberstackHeaders(),
    body: JSON.stringify({ token }),
    signal: AbortSignal.timeout(8000)
  });
  const verifiedPayload = await readJson(verifiedResponse);
  if (!verifiedResponse.ok) throw new HttpError(401, "Invalid Memberstack session.", "INVALID_SESSION");
  const verified = verifiedPayload?.data || verifiedPayload;
  const memberId = verified?.id || verified?.memberId || verified?.sub || verified?.payload?.id || verified?.payload?.sub;
  if (!memberId) throw new HttpError(401, "Invalid Memberstack session.", "INVALID_SESSION");

  const member = await getMemberstackMember(memberId);
  if (!member || member.id !== memberId) throw new HttpError(401, "Member not found.", "MEMBER_NOT_FOUND");
  const email = cleanText(member.auth?.email || member.email, 254).toLowerCase();
  if (!isEmail(email)) throw new HttpError(409, "Your account needs a valid email address.", "MEMBER_EMAIL_REQUIRED");
  return { member, memberId, email };
}

async function getMemberstackMember(memberId) {
  const response = await fetch(`${MEMBERSTACK_BASE_URL}/members/${encodeURIComponent(memberId)}`, {
    headers: memberstackHeaders(false),
    signal: AbortSignal.timeout(8000)
  });
  const payload = await readJson(response);
  if (!response.ok) throw new HttpError(502, "Unable to verify your account.", "MEMBERSTACK_UNAVAILABLE");
  return payload?.data || payload || null;
}

function memberstackHeaders(withJson = true) {
  const headers = { "X-API-KEY": process.env.MEMBERSTACK_SECRET_KEY, Accept: "application/json" };
  if (withJson) headers["Content-Type"] = "application/json";
  return headers;
}

function memberSummary(member) {
  const fields = member.customFields || member.custom_fields || {};
  const firstName = cleanText(fields["first-name"] || fields.firstName, 80);
  const lastName = cleanText(fields["last-name"] || fields.lastName, 80);
  return {
    name: cleanText(`${firstName} ${lastName}`.trim() || "Студент SpeakDobre", 160),
    phone: cleanText(fields.phone || fields.Phone, 60)
  };
}

function emailDocumentId(email) {
  return crypto.createHmac("sha256", process.env.TRIAL_ELIGIBILITY_HMAC_SECRET)
    .update(String(email || "").trim().toLowerCase()).digest("hex");
}

function bookingDocumentId(memberId) {
  return crypto.createHash("sha256").update(String(memberId || "")).digest("hex");
}

async function persistAssessmentEligibility(payload) {
  if (!trialBookingEnabled()) return { enabled: false };
  requireTrialEnvironment();
  const now = new Date().toISOString();
  const id = emailDocumentId(payload.email);
  await patchDocument(`${collectionName(ELIGIBILITY_COLLECTION)}/${id}`, {
    emailHash: id,
    submissionId: payload.submissionId,
    submittedAt: payload.submittedAt || now,
    updatedAt: now,
    status: "eligible"
  });
  return { enabled: true };
}

async function loadEligibility(email) {
  return getDocument(`${collectionName(ELIGIBILITY_COLLECTION)}/${emailDocumentId(email)}`);
}

function generateAvailableSlots(now = new Date()) {
  const minNoticeMinutes = positiveInteger(process.env.TRIAL_BOOKING_MIN_NOTICE_MINUTES, 120);
  const earliestMs = now.getTime() + minNoticeMinutes * 60_000;
  const latestMs = now.getTime() + 14 * 24 * 60 * 60_000;
  const firstSlotMs = Math.ceil(earliestMs / (30 * 60_000)) * 30 * 60_000;
  const slots = [];
  for (let value = firstSlotMs; value <= latestMs; value += 30 * 60_000) {
    const start = new Date(value);
    const parts = zonedParts(start, KYIV_TIME_ZONE);
    if (!(parts.hour === 0 || parts.hour >= 6)) continue;
    slots.push({
      startAt: start.toISOString(),
      date: `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`,
      time: `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`,
      label: formatKyiv(start)
    });
  }
  return slots;
}

function validateBookingInput(body, now = new Date()) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Invalid request.", "INVALID_BODY");
  }
  const action = cleanText(body.action || "schedule", 20).toLowerCase();
  if (!["schedule", "reschedule", "cancel"].includes(action)) {
    throw new HttpError(400, "Invalid booking action.", "INVALID_ACTION");
  }
  if (action === "cancel") return { action };

  const startAt = new Date(cleanText(body.startAt, 40));
  if (Number.isNaN(startAt.getTime())) throw new HttpError(400, "Select a valid lesson time.", "INVALID_START_TIME");
  if (![0, 30].includes(startAt.getUTCMinutes()) || startAt.getUTCSeconds() !== 0 || startAt.getUTCMilliseconds() !== 0) {
    throw new HttpError(400, "Select an available 30-minute time slot.", "INVALID_SLOT");
  }

  const minNoticeMinutes = positiveInteger(process.env.TRIAL_BOOKING_MIN_NOTICE_MINUTES, 120);
  const earliest = new Date(now.getTime() + minNoticeMinutes * 60_000);
  const latest = new Date(now.getTime() + 14 * 24 * 60 * 60_000);
  if (startAt < earliest) throw new HttpError(409, `Book at least ${minNoticeMinutes} minutes in advance.`, "MIN_NOTICE");
  if (startAt > latest) throw new HttpError(409, "Choose a date within the next 14 days.", "OUTSIDE_BOOKING_WINDOW");

  const kyiv = zonedParts(startAt, KYIV_TIME_ZONE);
  if (![0, 30].includes(kyiv.minute) || !(kyiv.hour === 0 || kyiv.hour >= 6)) {
    throw new HttpError(409, "Choose a time from 06:00 through 00:30 Kyiv time.", "OUTSIDE_DAILY_HOURS");
  }

  const meetingMethod = cleanText(body.meetingMethod, 40).toLowerCase();
  const contactChannel = cleanText(body.contactChannel, 40).toLowerCase();
  const contactValue = cleanText(body.contactValue, 180);
  if (!MEETING_METHODS.has(meetingMethod)) throw new HttpError(400, "Select a meeting platform.", "INVALID_MEETING_METHOD");
  if (!CONTACT_CHANNELS.has(contactChannel)) throw new HttpError(400, "Select a contact method.", "INVALID_CONTACT_CHANNEL");
  if (contactChannel !== "email" && contactValue.length < 2) {
    throw new HttpError(400, "Enter your messenger username, phone number or profile link.", "CONTACT_VALUE_REQUIRED");
  }
  return { action, startAt, meetingMethod, contactChannel, contactValue };
}

function zonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  });
  return Object.fromEntries(formatter.formatToParts(date)
    .filter(part => part.type !== "literal").map(part => [part.type, Number(part.value)]));
}

function formatKyiv(date) {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: KYIV_TIME_ZONE,
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).format(date);
}

async function createOrUpdateBooking(authenticated, validated, now = new Date()) {
  const { member, memberId, email } = authenticated;
  const documentId = bookingDocumentId(memberId);
  const bookingsCollection = collectionName(BOOKING_COLLECTION);
  const eligibilityCollection = collectionName(ELIGIBILITY_COLLECTION);
  const current = await getDocument(`${bookingsCollection}/${documentId}`);
  if (validated.action === "schedule" && current?.status === "scheduled") {
    throw new HttpError(409, "You already have a scheduled trial lesson.", "BOOKING_EXISTS", publicBooking(current));
  }
  if (validated.action === "reschedule" && (!current || current.status !== "scheduled")) {
    throw new HttpError(404, "No scheduled trial lesson was found.", "BOOKING_NOT_FOUND");
  }
  const eligibility = await loadEligibility(email);
  if (!hasBookingEligibility(validated.action, eligibility, current, memberId)) {
    throw new HttpError(403, "Complete the assessment using this account email before booking.", "ASSESSMENT_REQUIRED");
  }

  const startAt = validated.startAt.toISOString();
  const endAt = new Date(validated.startAt.getTime() + 30 * 60_000).toISOString();
  const leadMinutes = positiveInteger(process.env.TRIAL_REMINDER_LEAD_MINUTES, 120);
  const reminderDueAt = new Date(validated.startAt.getTime() - leadMinutes * 60_000).toISOString();
  const summary = memberSummary(member);
  const bookingId = current?.bookingId || crypto.randomUUID();
  const eventVersion = Number(current?.eventVersion || 0) + 1;
  const pendingEvent = validated.action === "reschedule" ? "trial-booking-rescheduled" : "trial-booking-created";
  const fields = {
    bookingId, memberId, studentEmail: email, studentName: summary.name, studentPhone: summary.phone,
    assessmentSubmissionId: eligibility.submissionId || "",
    startAt, endAt, timeZone: KYIV_TIME_ZONE, durationMinutes: 30,
    meetingMethod: validated.meetingMethod,
    contactChannel: validated.contactChannel,
    contactValue: validated.contactValue,
    status: "scheduled", eventVersion,
    createdAt: current?.createdAt || now.toISOString(), updatedAt: now.toISOString(),
    reminderDueAt, reminderSentAt: "", reminderStatus: "pending",
    notificationStatus: "pending", notificationSentAt: "", pendingEvent
  };
  if (current) {
    await patchDocument(`${bookingsCollection}/${documentId}`, fields, { updateTime: current._updateTime });
  } else {
    await createDocument(bookingsCollection, documentId, fields);
  }
  await patchDocument(`${eligibilityCollection}/${emailDocumentId(email)}`, {
    status: "booked", bookedMemberId: memberId, bookingId, updatedAt: now.toISOString()
  });

  let notificationsPending = true;
  try {
    await sendBookingEvent(eventPayload(pendingEvent, fields));
    await patchDocument(`${bookingsCollection}/${documentId}`, {
      notificationStatus: "sent", notificationSentAt: new Date().toISOString(), pendingEvent: ""
    });
    notificationsPending = false;
  } catch (error) {
    console.warn("Trial booking notification queued for retry:", safeError(error));
  }
  return { booking: publicBooking(fields), notificationsPending };
}

function hasBookingEligibility(action, eligibility, current, memberId) {
  if (eligibility?.status === "eligible") return true;
  return action === "reschedule"
    && eligibility?.status === "booked"
    && current?.status === "scheduled"
    && eligibility.bookedMemberId === memberId
    && eligibility.bookingId === current.bookingId;
}

async function cancelBooking(authenticated, now = new Date()) {
  const documentId = bookingDocumentId(authenticated.memberId);
  const bookingsCollection = collectionName(BOOKING_COLLECTION);
  const eligibilityCollection = collectionName(ELIGIBILITY_COLLECTION);
  const current = await getDocument(`${bookingsCollection}/${documentId}`);
  if (!current || current.status !== "scheduled") {
    throw new HttpError(404, "No scheduled trial lesson was found.", "BOOKING_NOT_FOUND");
  }
  const fields = {
    bookingId: current.bookingId,
    memberId: current.memberId,
    studentEmail: current.studentEmail,
    studentName: current.studentName,
    studentPhone: current.studentPhone,
    assessmentSubmissionId: current.assessmentSubmissionId,
    startAt: current.startAt,
    endAt: current.endAt,
    timeZone: current.timeZone || KYIV_TIME_ZONE,
    durationMinutes: Number(current.durationMinutes || 30),
    meetingMethod: current.meetingMethod,
    contactChannel: current.contactChannel,
    contactValue: current.contactValue,
    createdAt: current.createdAt,
    reminderDueAt: current.reminderDueAt,
    status: "cancelled", updatedAt: now.toISOString(),
    eventVersion: Number(current.eventVersion || 0) + 1,
    reminderStatus: "cancelled", reminderSentAt: current.reminderSentAt || "",
    notificationStatus: "pending", notificationSentAt: "", pendingEvent: "trial-booking-cancelled"
  };
  await patchDocument(`${bookingsCollection}/${documentId}`, fields, { updateTime: current._updateTime });
  await patchDocument(`${eligibilityCollection}/${emailDocumentId(authenticated.email)}`, {
    status: "eligible", bookedMemberId: "", bookingId: "", updatedAt: now.toISOString()
  });
  let notificationsPending = true;
  try {
    await sendBookingEvent(eventPayload("trial-booking-cancelled", fields));
    await patchDocument(`${bookingsCollection}/${documentId}`, {
      notificationStatus: "sent", notificationSentAt: new Date().toISOString(), pendingEvent: ""
    });
    notificationsPending = false;
  } catch (error) {
    console.warn("Trial cancellation notification queued for retry:", safeError(error));
  }
  return { booking: publicBooking(fields), notificationsPending };
}

function eventPayload(event, booking) {
  return {
    event,
    idempotencyKey: `${booking.bookingId}:${event}:${booking.eventVersion}`,
    bookingId: booking.bookingId,
    memberId: booking.memberId,
    assessmentSubmissionId: booking.assessmentSubmissionId,
    studentName: booking.studentName,
    studentEmail: booking.studentEmail,
    studentPhone: booking.studentPhone,
    startAt: booking.startAt,
    endAt: booking.endAt,
    timeZone: booking.timeZone,
    startKyiv: formatKyiv(new Date(booking.startAt)),
    durationMinutes: booking.durationMinutes,
    meetingMethod: booking.meetingMethod,
    contactChannel: booking.contactChannel,
    contactValue: booking.contactValue,
    reminderDueAt: booking.reminderDueAt,
    manageUrl: "https://www.speakdobre.com/profile?section=trial-lesson"
  };
}

async function sendBookingEvent(payload) {
  const url = process.env.ZAPIER_TRIAL_BOOKING_WEBHOOK_URL;
  if (!url) throw new Error("ZAPIER_TRIAL_BOOKING_WEBHOOK_URL is not configured.");
  const response = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`Zapier trial-booking webhook failed with status ${response.status}.`);
}

function publicBooking(booking) {
  if (!booking) return null;
  return {
    bookingId: booking.bookingId,
    startAt: booking.startAt,
    endAt: booking.endAt,
    timeZone: booking.timeZone || KYIV_TIME_ZONE,
    durationMinutes: Number(booking.durationMinutes || 30),
    meetingMethod: booking.meetingMethod,
    contactChannel: booking.contactChannel,
    contactValue: booking.contactValue,
    status: booking.status,
    startKyiv: booking.startAt ? formatKyiv(new Date(booking.startAt)) : ""
  };
}

async function getBookingForMember(memberId) {
  return getDocument(`${collectionName(BOOKING_COLLECTION)}/${bookingDocumentId(memberId)}`);
}

async function listBookings() {
  const token = await googleAccessToken();
  const project = encodeURIComponent(process.env.FIREBASE_PROJECT_ID);
  const base = `${FIRESTORE_BASE_URL}/projects/${project}/databases/(default)/documents/${collectionName(BOOKING_COLLECTION)}`;
  const bookings = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({ pageSize: "300" });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await fetch(`${base}?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000)
    });
    const payload = await readJson(response);
    if (!response.ok) throw new Error(`Firestore list failed with status ${response.status}.`);
    bookings.push(...(payload.documents || []).map(document => decodeDocument(document)));
    pageToken = String(payload.nextPageToken || "");
  } while (pageToken);
  return bookings;
}

async function getDocument(path) {
  const token = await googleAccessToken();
  const project = encodeURIComponent(process.env.FIREBASE_PROJECT_ID);
  const url = `${FIRESTORE_BASE_URL}/projects/${project}/databases/(default)/documents/${path.split("/").map(encodeURIComponent).join("/")}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
  if (response.status === 404) return null;
  const payload = await readJson(response);
  if (!response.ok) throw new Error(`Firestore read failed with status ${response.status}.`);
  return decodeDocument(payload);
}

async function patchDocument(path, fields, options = {}) {
  const token = await googleAccessToken();
  const project = encodeURIComponent(process.env.FIREBASE_PROJECT_ID);
  const base = `${FIRESTORE_BASE_URL}/projects/${project}/databases/(default)/documents/${path.split("/").map(encodeURIComponent).join("/")}`;
  const params = new URLSearchParams();
  Object.keys(fields).forEach(field => params.append("updateMask.fieldPaths", field));
  if (options.updateTime) params.set("currentDocument.updateTime", options.updateTime);
  const response = await fetch(`${base}?${params}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: encodeFields(fields) }),
    signal: AbortSignal.timeout(8000)
  });
  const payload = await readJson(response);
  if (response.status === 409 || response.status === 412) {
    throw new HttpError(409, "The booking changed while this request was being processed. Refresh and try again.", "BOOKING_CONFLICT");
  }
  if (!response.ok) throw new Error(`Firestore write failed with status ${response.status}.`);
  return decodeDocument(payload);
}

async function createDocument(collectionPath, documentId, fields) {
  const token = await googleAccessToken();
  const project = encodeURIComponent(process.env.FIREBASE_PROJECT_ID);
  const collection = collectionPath.split("/").map(encodeURIComponent).join("/");
  const base = `${FIRESTORE_BASE_URL}/projects/${project}/databases/(default)/documents/${collection}`;
  const params = new URLSearchParams({ documentId });
  const response = await fetch(`${base}?${params}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: encodeFields(fields) }),
    signal: AbortSignal.timeout(8000)
  });
  const payload = await readJson(response);
  if (response.status === 409) {
    throw new HttpError(409, "You already have a trial-booking record. Refresh and try again.", "BOOKING_CONFLICT");
  }
  if (!response.ok) throw new Error(`Firestore create failed with status ${response.status}.`);
  return decodeDocument(payload);
}

async function googleAccessToken() {
  if (cachedGoogleToken && cachedGoogleToken.expiresAt > Date.now() + 60_000) return cachedGoogleToken.token;
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(JSON.stringify({
    iss: process.env.FIREBASE_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  signer.end();
  const privateKey = String(process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  const assertion = `${header}.${claim}.${base64url(signer.sign(privateKey))}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    signal: AbortSignal.timeout(8000)
  });
  const payload = await readJson(response);
  if (!response.ok || !payload.access_token) throw new Error("Unable to authenticate with Firebase.");
  cachedGoogleToken = { token: payload.access_token, expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000 };
  return cachedGoogleToken.token;
}

function encodeFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, encodeValue(value)]));
}

function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (typeof value === "object") return { mapValue: { fields: encodeFields(value) } };
  return { stringValue: String(value) };
}

function decodeDocument(document) {
  if (!document?.fields) return null;
  const decoded = Object.fromEntries(Object.entries(document.fields).map(([key, value]) => [key, decodeValue(value)]));
  decoded._documentName = document.name || "";
  decoded._updateTime = document.updateTime || "";
  return decoded;
}

function decodeValue(value) {
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("nullValue" in value) return null;
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decodeValue);
  if ("mapValue" in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([k, v]) => [k, decodeValue(v)]));
  return null;
}

function base64url(value) {
  return Buffer.from(value).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function cleanText(value, maxLength) {
  return String(value || "").replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, maxLength);
}

function isEmail(value) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
}

function safeError(error) {
  return { name: error?.name, message: error?.message, status: error?.status, code: error?.code };
}

module.exports = {
  BOOKING_COLLECTION,
  CONTACT_CHANNELS,
  HttpError,
  KYIV_TIME_ZONE,
  MEETING_METHODS,
  assertAllowedOrigin,
  assertJsonRequest,
  cancelBooking,
  collectionName,
  createDocument,
  createOrUpdateBooking,
  hasBookingEligibility,
  eventPayload,
  formatKyiv,
  getBookingForMember,
  generateAvailableSlots,
  getMemberstackMember,
  listBookings,
  loadEligibility,
  patchDocument,
  persistAssessmentEligibility,
  publicBooking,
  requireTrialEnvironment,
  safeError,
  sendBookingEvent,
  setCors,
  trialBookingEnabled,
  validateBookingInput,
  verifyMember,
  zonedParts
};
