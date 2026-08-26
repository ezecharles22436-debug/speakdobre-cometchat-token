const crypto = require("node:crypto");

const MEMBERSTACK_BASE_URL = "https://admin.memberstack.com";
const SIGNATURE_TTL_SECONDS = 5 * 60;

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    assertEnvironment();
    assertAllowedOrigin(req);
    const sessionToken = readBearerToken(req.headers.authorization);
    if (!sessionToken) return res.status(401).json({ error: "Authentication required." });

    const verified = await verifyMemberstackToken(sessionToken);
    const memberId = getVerifiedMemberId(verified);
    if (!memberId) return res.status(401).json({ error: "Invalid Memberstack session." });

    const member = await getMemberstackMember(memberId);
    if (!member || member.id !== memberId) {
      return res.status(401).json({ error: "Member not found." });
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const params = buildSignedParams(memberId, timestamp);
    const signature = signUploadParams(params, process.env.CLOUDINARY_API_SECRET);

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY,
      signature,
      params,
      expiresAt: timestamp + SIGNATURE_TTL_SECONDS,
      constraints: {
        maxBytes: 5 * 1024 * 1024,
        allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"]
      }
    });
  } catch (error) {
    console.error("Cloudinary signature endpoint failed:", safeError(error));
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.publicMessage });
    return res.status(500).json({ error: "Unable to authorize profile photo upload." });
  }
};

function assertEnvironment() {
  const required = [
    "MEMBERSTACK_SECRET_KEY",
    "ALLOWED_ORIGINS",
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
    "CLOUDINARY_SIGNED_UPLOAD_PRESET"
  ];
  const missing = required.filter(name => !process.env[name]);
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(", ")}`);
}

function buildSignedParams(memberId, timestamp) {
  const opaqueMemberId = crypto
    .createHmac("sha256", process.env.CLOUDINARY_API_SECRET)
    .update(String(memberId))
    .digest("hex")
    .slice(0, 32);
  return {
    allowed_formats: "jpg,png,webp",
    asset_folder: "speakdobre/profile-photos",
    invalidate: "true",
    overwrite: "true",
    public_id: `member_${opaqueMemberId}`,
    timestamp: String(timestamp),
    transformation: "c_limit,h_1200,w_1200",
    upload_preset: process.env.CLOUDINARY_SIGNED_UPLOAD_PRESET
  };
}

function signUploadParams(params, secret) {
  const serialized = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return crypto.createHash("sha1").update(serialized + secret).digest("hex");
}

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && allowedOriginSet().has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function assertAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (origin && !allowedOriginSet().has(origin)) throw new HttpError(403, "Origin not allowed.");
}

function allowedOriginSet() {
  return new Set(String(process.env.ALLOWED_ORIGINS || "")
    .split(",").map(value => value.trim()).filter(Boolean));
}

function readBearerToken(header) {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
  return header.slice(7).trim() || null;
}

async function verifyMemberstackToken(token) {
  const response = await fetch(`${MEMBERSTACK_BASE_URL}/members/verify-token`, {
    method: "POST",
    headers: memberstackHeaders(),
    body: JSON.stringify({ token })
  });
  const payload = await readJson(response);
  if (!response.ok) throw new HttpError(401, "Invalid Memberstack session.");
  return payload?.data || payload;
}

function getVerifiedMemberId(payload) {
  return payload?.id || payload?.memberId || payload?.sub ||
    payload?.payload?.id || payload?.payload?.sub || null;
}

async function getMemberstackMember(memberId) {
  const response = await fetch(`${MEMBERSTACK_BASE_URL}/members/${encodeURIComponent(memberId)}`, {
    headers: memberstackHeaders(false)
  });
  const payload = await readJson(response);
  if (!response.ok) throw new HttpError(502, "Unable to verify member.");
  return payload?.data || payload || null;
}

function memberstackHeaders(withJson = true) {
  const headers = { "X-API-KEY": process.env.MEMBERSTACK_SECRET_KEY, Accept: "application/json" };
  if (withJson) headers["Content-Type"] = "application/json";
  return headers;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
}

function safeError(error) {
  return { name: error?.name, message: error?.message, status: error?.status };
}

class HttpError extends Error {
  constructor(status, publicMessage) {
    super(publicMessage);
    this.name = "HttpError";
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

module.exports._test = { buildSignedParams, signUploadParams, readBearerToken };
