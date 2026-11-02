// Shared account verification and Firestore storage used by Practice Chat.
const crypto = require("node:crypto");
const MEMBERSTACK_BASE_URL = "https://admin.memberstack.com";
const FIRESTORE_BASE_URL = "https://firestore.googleapis.com/v1";
const MAX_BODY_BYTES = 16 * 1024;
let cachedGoogleToken = null;

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
    throw new HttpError(409, "The record changed while this request was being processed. Refresh and try again.", "BOOKING_CONFLICT");
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
    throw new HttpError(409, "This record already exists. Refresh and try again.", "BOOKING_CONFLICT");
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

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
}

function safeError(error) {
  return { name: error?.name, message: error?.message, status: error?.status, code: error?.code };
}

module.exports = { HttpError, setCors, assertAllowedOrigin, assertJsonRequest, verifyMember, getMemberstackMember, getDocument, patchDocument, createDocument, safeError };
