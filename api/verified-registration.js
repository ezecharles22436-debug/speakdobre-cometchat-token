const MEMBERSTACK_BASE_URL = "https://admin.memberstack.com";

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    assertEnvironment();
    assertAllowedOrigin(req);

    const sessionToken = readBearerToken(req.headers.authorization);
    if (!sessionToken) {
      return res.status(401).json({ error: "Authentication required." });
    }

    const verifiedToken = await verifyMemberstackToken(sessionToken);
    const memberId = getVerifiedMemberId(verifiedToken);
    if (!memberId) {
      return res.status(401).json({ error: "Invalid Memberstack session." });
    }

    const member = await getMemberstackMember(memberId);
    if (!member || member.id !== memberId) {
      return res.status(401).json({ error: "Member not found." });
    }

    if (!isMemberVerified(member)) {
      return res.status(409).json({
        error: "Email is not verified yet.",
        code: "EMAIL_NOT_VERIFIED"
      });
    }

    const fields = member.customFields || {};
    const payload = {
      event: "verified-registration",
      memberId: member.id,
      email: cleanText(member.auth?.email || member.email, 254),
      firstName: cleanText(fields["first-name"] || fields.firstName, 80),
      lastName: cleanText(fields["last-name"] || fields.lastName, 80),
      name: cleanText(`${fields["first-name"] || ""} ${fields["last-name"] || ""}`.trim(), 160),
      phone: cleanText(fields.phone || fields.Phone, 60),
      emailVerified: true,
      source: "Website Reg.",
      status: "Registered",
      createdAt: member.createdAt || member.createdDate || member.created_at || "",
      verifiedAt: new Date().toISOString()
    };

    await notifyZapier(payload);

    return res.status(200).json({
      ok: true,
      message: "Verified registration recorded.",
      memberId: member.id
    });
  } catch (error) {
    console.error("Verified registration endpoint failed:", safeError(error));

    if (error instanceof HttpError) {
      return res.status(error.status).json({ error: error.publicMessage, details: error.details });
    }

    return res.status(500).json({ error: "Unable to record verified registration." });
  }
};

function assertEnvironment() {
  const required = [
    "MEMBERSTACK_SECRET_KEY",
    "ZAPIER_VERIFIED_REGISTRATION_WEBHOOK_URL",
    "ALLOWED_ORIGINS"
  ];

  const missing = required.filter(name => !process.env[name]);
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }
}

function setCors(req, res) {
  const allowedOrigins = allowedOriginSet();
  const requestOrigin = req.headers.origin;

  if (requestOrigin && allowedOrigins.has(requestOrigin)) {
    res.setHeader("Access-Control-Allow-Origin", requestOrigin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function assertAllowedOrigin(req) {
  const requestOrigin = req.headers.origin;
  if (requestOrigin && !allowedOriginSet().has(requestOrigin)) {
    throw new HttpError(403, "Origin not allowed.");
  }
}

function allowedOriginSet() {
  return csvSet(
    process.env.ALLOWED_ORIGINS ||
    "https://speakdobre.com,https://www.speakdobre.com"
  );
}

function readBearerToken(header) {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token || null;
}

async function verifyMemberstackToken(token) {
  const response = await fetch(`${MEMBERSTACK_BASE_URL}/members/verify-token`, {
    method: "POST",
    headers: memberstackHeaders(),
    body: JSON.stringify({ token })
  });

  const payload = await readJson(response);
  if (!response.ok) {
    throw new HttpError(401, "Invalid Memberstack session.", payload);
  }

  return payload?.data || payload;
}

function getVerifiedMemberId(payload) {
  return payload?.id ||
    payload?.memberId ||
    payload?.sub ||
    payload?.payload?.id ||
    payload?.payload?.sub ||
    null;
}

async function getMemberstackMember(memberId) {
  const response = await fetch(
    `${MEMBERSTACK_BASE_URL}/members/${encodeURIComponent(memberId)}`,
    { headers: memberstackHeaders(false) }
  );

  const payload = await readJson(response);
  if (!response.ok) {
    throw new HttpError(502, "Unable to verify member.", payload);
  }

  return payload?.data || payload || null;
}

function memberstackHeaders(withJson = true) {
  const headers = {
    "X-API-KEY": process.env.MEMBERSTACK_SECRET_KEY,
    "Accept": "application/json"
  };
  if (withJson) headers["Content-Type"] = "application/json";
  return headers;
}

function isMemberVerified(member) {
  return member?.verified === true ||
    member?.emailVerified === true ||
    member?.auth?.verified === true ||
    member?.auth?.emailVerified === true;
}

async function notifyZapier(payload) {
  const response = await fetch(process.env.ZAPIER_VERIFIED_REGISTRATION_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const result = await readJson(response);
  if (!response.ok) {
    throw new HttpError(502, "Unable to notify Zapier.", result);
  }
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

function csvSet(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map(item => item.trim())
      .filter(Boolean)
  );
}

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);
}

function safeError(error) {
  return {
    name: error?.name,
    message: error?.message,
    status: error?.status
  };
}

class HttpError extends Error {
  constructor(status, publicMessage, details) {
    super(publicMessage);
    this.name = "HttpError";
    this.status = status;
    this.publicMessage = publicMessage;
    this.details = details;
  }
}
