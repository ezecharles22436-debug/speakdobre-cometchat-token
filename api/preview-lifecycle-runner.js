const crypto = require("crypto");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (process.env.VERCEL_ENV !== "preview") {
    return res.status(404).json({ ok: false, error: "Not found." });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }
  if (!secretsMatch(readBearerToken(req.headers.authorization), process.env.PREVIEW_LIFECYCLE_RUNNER_SECRET)) {
    return res.status(401).json({ ok: false, error: "Unauthorized." });
  }

  const uid = cleanUid(req.body?.uid);
  const action = String(req.body?.action || "").trim().toLowerCase();
  if (!uid || !["status", "reactivate"].includes(action)) {
    return res.status(400).json({ ok: false, error: "Invalid synthetic lifecycle request." });
  }

  try {
    if (action === "reactivate") {
      await cometChatRequest("/users", {
        method: "PUT",
        body: { uidsToActivate: [uid] }
      });
    }

    const user = await cometChatRequest(`/users/${encodeURIComponent(uid)}`);
    return res.status(200).json({
      ok: true,
      action,
      uid,
      status: user?.data?.status || user?.status || "unknown"
    });
  } catch (error) {
    console.error("Preview lifecycle runner failed:", safeError(error));
    return res.status(500).json({ ok: false, error: "Synthetic lifecycle test failed." });
  }
};

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
  return /^mem_sb_[A-Za-z0-9_-]{1,93}$/.test(uid) ? uid : "";
}

async function cometChatRequest(path, options = {}) {
  const required = ["COMETCHAT_APP_ID", "COMETCHAT_REGION"];
  const missing = required.filter(name => !process.env[name]);
  if (!process.env.COMETCHAT_API_KEY && !process.env.COMETCHAT_REST_API_KEY) missing.push("COMETCHAT_API_KEY");
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(", ")}`);

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
  const payload = await readJson(response);
  if (!response.ok) {
    const error = new Error("CometChat request failed.");
    error.status = response.status;
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
  return { name: error?.name, message: error?.message, status: error?.status };
}

module.exports._test = { cleanUid, secretsMatch };
