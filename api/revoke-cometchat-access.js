const crypto = require("crypto");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  try {
    assertEnvironment();

    const suppliedSecret = readBearerToken(req.headers.authorization);
    if (!secretsMatch(suppliedSecret, process.env.COMETCHAT_LIFECYCLE_SECRET)) {
      return res.status(401).json({ ok: false, error: "Unauthorized." });
    }

    const uid = cleanUid(req.body?.uid);
    if (!uid) {
      return res.status(400).json({ ok: false, error: "Invalid member ID." });
    }

    await flushAuthTokens(uid);
    await deactivateUser(uid);

    return res.status(200).json({ ok: true, uid, status: "deactivated" });
  } catch (error) {
    console.error("CometChat access revocation failed:", safeError(error));
    return res.status(500).json({ ok: false, error: "Unable to revoke Practice Chat access." });
  }
};

function assertEnvironment() {
  const required = [
    "COMETCHAT_APP_ID",
    "COMETCHAT_REGION",
    "COMETCHAT_LIFECYCLE_SECRET"
  ];
  const missing = required.filter(name => !process.env[name]);
  if (!process.env.COMETCHAT_API_KEY && !process.env.COMETCHAT_REST_API_KEY) {
    missing.push("COMETCHAT_API_KEY");
  }
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }
}

function readBearerToken(header) {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return "";
  return header.slice(7).trim();
}

function secretsMatch(supplied, expected) {
  if (!supplied || !expected) return false;
  const suppliedBuffer = Buffer.from(String(supplied));
  const expectedBuffer = Buffer.from(String(expected));
  if (suppliedBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
}

function cleanUid(value) {
  const uid = String(value || "").trim();
  if (!/^mem_[A-Za-z0-9_-]{1,96}$/.test(uid)) return "";
  return uid;
}

async function flushAuthTokens(uid) {
  await cometChatRequest(`/users/${encodeURIComponent(uid)}/auth_tokens`, {
    method: "DELETE",
    allowNotFound: true
  });
}

async function deactivateUser(uid) {
  await cometChatRequest("/users", {
    method: "DELETE",
    body: { uidsToDeactivate: [uid] },
    allowNotFound: true
  });
}

async function cometChatRequest(path, options = {}) {
  const base = `https://${process.env.COMETCHAT_APP_ID}.api-${process.env.COMETCHAT_REGION}.cometchat.io/v3`;
  const response = await fetch(`${base}${path}`, {
    method: options.method || "GET",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "apiKey": process.env.COMETCHAT_API_KEY || process.env.COMETCHAT_REST_API_KEY
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  if (response.status === 404 && options.allowNotFound) return null;
  const payload = await readJson(response);
  if (!response.ok) {
    const error = new Error("CometChat request failed.");
    error.status = response.status;
    error.details = payload;
    throw error;
  }
  return payload;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 500) };
  }
}

function safeError(error) {
  return {
    name: error?.name,
    message: error?.message,
    status: error?.status
  };
}

module.exports._test = { cleanUid, secretsMatch };
