const MEMBERSTACK_BASE_URL = "https://admin.memberstack.com";
const { roleForMember, ROOMS } = require('./_chat-room-policy');
const { roomReleaseReady } = require('./_chat-room-release');
const { createRoomProvider } = require('./_chat-room-provider');
const { prepareRoomAccess } = require('./_chat-room-staff');
const { createRoomStore } = require('./_chat-room-store');
const { startupSelection } = require('./_chat-startup-selection');
const { createStartupTiming } = require('./_chat-startup-timing');

function roomRoleForMember(memberId, env = process.env) {
  if (env.CHAT_ROOMS_ENABLED !== 'true') return null;
  if (!roomReleaseReady(env)) {
    throw new HttpError(503, 'Practice Chat permissions are not ready.');
  }
  return roleForMember(memberId, {
    superModeratorIds: [...csvSet(env.CHAT_SUPER_MODERATOR_IDS)],
    moderatorIds: [...csvSet(env.CHAT_MODERATOR_IDS)]
  });
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  const timing = createStartupTiming(req);

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
    let body;
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); }
    catch { throw new HttpError(400, 'Invalid request.'); }
    if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some(key => key !== 'operation') ||
        (body.operation !== undefined && body.operation !== 'verify')) throw new HttpError(400, 'Invalid request.');
    const readOnly = body.operation === 'verify';

    const sessionToken = readBearerToken(req.headers.authorization);
    if (!sessionToken) {
      return res.status(401).json({ error: "Authentication required." });
    }

    const verified = await timing.run('verify', () => verifyMemberstackToken(sessionToken));
    const memberId = getVerifiedMemberId(verified);

    if (!memberId) {
      return res.status(401).json({ error: "Invalid Memberstack session." });
    }

    const member = await timing.run('member', () => getMemberstackMember(memberId));
    if (!member || member.id !== memberId) {
      return res.status(401).json({ error: "Member not found." });
    }

    const role = roomRoleForMember(memberId);
    if (readOnly && !role) throw new HttpError(503, 'Verification unavailable.');
    const access = role && role !== 'student'
      ? { allowed: true, type: 'staff', trialEnd: null }
      : getPracticeChatAccess(member);
    if (!access.allowed) {
      return res.status(403).json({
        error: "Practice Chat access has expired.",
        code: "CHAT_ACCESS_EXPIRED"
      });
    }

    const fields = member.customFields || {};
    const firstName = cleanText(fields["first-name"], 80);
    const lastName = cleanText(fields["last-name"], 80);
    const email = cleanText(member.auth?.email, 254);
    const name = cleanText(`${firstName} ${lastName}`.trim() || email || "SpeakDobre Member", 100);
    const uid = member.id;

    if (!readOnly) await timing.run('provision', () => ensureCometChatUser(uid, name, role));
    const provider = role ? createRoomProvider() : null;
    const [roomAccess, studentState] = await Promise.all([
      role ? timing.run('contacts', () => prepareRoomAccess({ uid, role, chat: provider, readOnly })) : null,
      role === 'student' ? (async () => {
        const memberships = await timing.run('memberships', () => provider.memberships(uid));
        const selection = await timing.run('selection', () => startupSelection({ uid, memberships, store: createRoomStore() }));
        return { memberships, selection };
      })() : null,
    ]);
    let token;
    if (!readOnly) {
      await timing.run('reactivate', () => reactivateCometChatUser(uid));
      token = await timing.run('token', () => createCometChatToken(uid));
    }
    const memberships = studentState?.memberships || roomAccess?.memberships;
    const rooms = await getVisibleRoomsForUser(uid, memberships
      ? { memberships: async () => memberships } : undefined);

    res.setHeader("Cache-Control", "no-store");
    timing.attach(res);
    return res.status(200).json({
      ...(readOnly ? { verified: true } : { token }),
      user: {
        uid,
        name,
        ...(role ? { role } : {})
      },
      rooms,
      ...(studentState ? { selection: studentState.selection } : {}),
      ...(roomAccess ? { staffContacts: roomAccess.contacts } : {}),
      access: {
        type: access.type,
        trialEnd: access.trialEnd ? new Date(access.trialEnd).toISOString() : null
      }
    });
  } catch (error) {
    console.error("CometChat token endpoint failed:", safeError(error));

    if (error instanceof HttpError) {
      return res.status(error.status).json({ error: error.publicMessage });
    }

    return res.status(500).json({ error: "Unable to open Practice Chat." });
  }
};

function assertEnvironment() {
  const required = [
    "MEMBERSTACK_SECRET_KEY",
    "COMETCHAT_APP_ID",
    "COMETCHAT_REGION",
    "ALLOWED_ORIGINS"
  ];

  const missing = required.filter(name => !process.env[name]);
  if (!process.env.COMETCHAT_API_KEY && !process.env.COMETCHAT_REST_API_KEY) {
    missing.push("COMETCHAT_API_KEY");
  }
  if (!process.env.MEMBERSTACK_ALLOWED_PLAN_IDS && !process.env.MEMBERSTACK_ALLOWED_PLAN_NAMES) {
    missing.push("MEMBERSTACK_ALLOWED_PLAN_IDS or MEMBERSTACK_ALLOWED_PLAN_NAMES");
  }
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
    throw new HttpError(502, "Unable to verify Practice Chat access.", payload);
  }

  return payload?.data || null;
}

function memberstackHeaders(withJson = true) {
  const headers = {
    "X-API-KEY": process.env.MEMBERSTACK_SECRET_KEY,
    "Accept": "application/json"
  };
  if (withJson) headers["Content-Type"] = "application/json";
  return headers;
}

function getPracticeChatAccess(member) {
  const fields = member.customFields || member.custom_fields || {};
  const allowedPlanIds = csvSet(process.env.MEMBERSTACK_ALLOWED_PLAN_IDS);
  const allowedPlanNames = csvSet(process.env.MEMBERSTACK_ALLOWED_PLAN_NAMES, true);
  const plans = Array.isArray(member.planConnections) ? member.planConnections : [];

  const hasAllowedPlan = plans.some(connection => {
    const active = connection.active === true ||
      String(connection.status || "").toUpperCase() === "ACTIVE";
    if (!active) return false;

    const planId = String(connection.planId || connection.id || connection.plan?.id || "").trim();
    const planName = String(connection.planName || connection.name || connection.plan?.name || "").trim().toLowerCase();
    return allowedPlanIds.has(planId) || allowedPlanNames.has(planName);
  });

  if (hasAllowedPlan) {
    const trialEnd = parseDate(firstValue(fields, ["trialEnd", "trial-end", "trial_end"]));
    if (trialEnd && Date.now() < trialEnd) {
      return { allowed: true, type: "trial", trialEnd };
    }
    return { allowed: true, type: "paid", trialEnd: null };
  }
  return { allowed: false, type: "expired", trialEnd: null };
}

function firstValue(source, keys) {
  if (!source || typeof source !== "object") return "";
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return "";
}

async function ensureCometChatUser(uid, name, role = null) {
  const existing = await cometChatRequest(`/users/${encodeURIComponent(uid)}`, {
    method: "GET",
    allowNotFound: true
  });

  if (existing) {
    // Never trust a client-editable Memberstack field or a prior provider role.
    if (role && (existing?.data || existing)?.role !== role) {
      const updated = await cometChatRequest(`/users/${encodeURIComponent(uid)}`, {
        method: 'PUT', body: { role }
      });
      if ((updated?.data || updated)?.role !== role) {
        throw new HttpError(503, 'Unable to verify Practice Chat role.');
      }
    }
    return;
  }

  const created = await cometChatRequest("/users", {
    method: "POST",
    body: { uid, name, ...(role ? { role } : {}) }
  });
  if (role && (created?.data || created)?.role !== role) {
    throw new HttpError(503, 'Unable to verify Practice Chat role.');
  }
}

async function createCometChatToken(uid) {
  const payload = await cometChatRequest(
    `/users/${encodeURIComponent(uid)}/auth_tokens`,
    { method: "POST", body: {} }
  );

  const token = payload?.data?.authToken ||
    payload?.authToken ||
    payload?.data?.token ||
    payload?.token;

  if (!token) {
    throw new Error("CometChat did not return an auth token.");
  }
  return token;
}

async function reactivateCometChatUser(uid) {
  await cometChatRequest("/users", {
    method: "PUT",
    body: { uidsToActivate: [uid] }
  });
}

async function getVisibleRoomsForUser(uid, provider) {
  const rooms = configuredRooms();

  // A per-group member lookup can error for a banned user. One inaccessible
  // group must not prevent entry to the selector or to unrelated joined groups.
  // Use the same complete, identity-scoped membership list as the selector.
  // Do not catch provider failures or infer membership from a saved preference.
  if (roomReleaseReady(process.env)) {
    const memberships = await (provider || createRoomProvider()).memberships(uid);
    const joined = new Set(memberships.map(room => room.guid));
    return rooms.map(room => ({ guid: room.guid, name: room.name,
      level: room.level || '', description: room.description || '',
      unlocked: joined.has(room.guid) }));
  }

  return Promise.all(
    rooms.map(async room => {
      const unlocked = await isCometChatGroupMember(room.guid, uid);
      return {
        guid: room.guid,
        name: room.name,
        level: room.level || "",
        description: room.description || "",
        unlocked
      };
    })
  );
}

function configuredRooms() {
  // Keep navigation labels consistent with the Ukrainian selection catalog.
  // The legacy production configuration is unchanged while this release is off.
  if (roomReleaseReady(process.env)) {
    return ROOMS.map(room => ({ ...room, level: room.kind === 'level' ? room.name.split(' · ')[0] : '' }));
  }
  const raw = String(process.env.SPEAKDOBRE_CHAT_ROOMS || "").trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .map(room => ({
            guid: cleanText(room.guid, 120),
            name: cleanText(room.name, 120),
            level: cleanText(room.level, 40),
            description: cleanText(room.description, 180)
          }))
          .filter(room => room.guid && room.name);
      }
    } catch (error) {
      console.warn("Invalid SPEAKDOBRE_CHAT_ROOMS JSON:", error?.message);
    }
  }

  return [
    {
      guid: "speakdobre-a1",
      name: "A1–A2 Beginners",
      level: "A1–A2",
      description: "For beginners building basic speaking confidence."
    },
    {
      guid: "speakdobre-b1",
      name: "B1–B2 Intermediate",
      level: "B1–B2",
      description: "For confident everyday conversations and smoother fluency."
    },
    {
      guid: "speakdobre-travel",
      name: "Travel English",
      level: "Travel",
      description: "Practice English for trips, airports and hotels."
    },
    {
      guid: "speakdobre-c1",
      name: "C1 Advanced",
      level: "C1",
      description: "For advanced discussions, precision and natural expression."
    },
    {
      guid: "speakdobre-c2",
      name: "C2 Mastery",
      level: "C2",
      description: "For near-native fluency, nuance and mastery."
    },
    {
      guid: "speakdobre-business",
      name: "Business English",
      level: "Business",
      description: "Practice workplace communication, meetings and professional English."
    },
    {
      guid: "speakdobre-job-interview",
      name: "Job Interview",
      level: "Career",
      description: "Prepare for interviews, self-presentation and career conversations."
    },
    {
      guid: "speakdobre-ielts-toefl",
      name: "Practice IELTS/TOEFL Preparation",
      level: "Exam Prep",
      description: "Practice speaking, writing and exam-focused communication."
    },
    {
      guid: "speakdobre-listening-reading",
      name: "Listening/Reading Club",
      level: "Skills",
      description: "Discuss articles, audio, stories and comprehension practice."
    },
    {
      guid: "speakdobre-movies-tv",
      name: "Movies & TV",
      level: "Interest",
      description: "Practice English through films, series and entertainment."
    },
    {
      guid: "speakdobre-music-lovers",
      name: "Music Lovers",
      level: "Interest",
      description: "Talk about songs, artists, lyrics and music culture."
    },
    {
      guid: "speakdobre-sports-gaming",
      name: "Sports/Gaming",
      level: "Interest",
      description: "Discuss sports, games, teams, tournaments and hobbies."
    },
    {
      guid: "speakdobre-food-cooking",
      name: "Food & Cooking",
      level: "Interest",
      description: "Practice English through recipes, food culture and cooking."
    },
    {
      guid: "speakdobre-culture-exchange",
      name: "Culture Exchange",
      level: "Community",
      description: "Share traditions, places, habits and cultural experiences."
    },
    {
      guid: "speakdobre-ukrainian-gossip",
      name: "Ukrainian Gossip Community",
      level: "Community",
      description: "Casual community talk for Ukrainian topics and social conversation."
    },
    {
      guid: "speakdobre-international-gossip",
      name: "International Gossip Community",
      level: "Community",
      description: "Casual global conversation about people, trends and everyday stories."
    }
  ];
}

async function isCometChatGroupMember(guid, uid) {
  const payload = await cometChatRequest(
    `/groups/${encodeURIComponent(guid)}/members/${encodeURIComponent(uid)}`,
    { method: "GET", allowNotFound: true }
  );

  return Boolean(payload);
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
    throw new HttpError(502, "Unable to connect to CometChat.", payload);
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

function parseDate(value) {
  if (!value) return null;
  if (typeof value === "number") {
    return value < 100000000000 ? value * 1000 : value;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric < 100000000000 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function csvSet(value, lowercase = false) {
  return new Set(
    String(value || "")
      .split(",")
      .map(item => item.trim())
      .filter(Boolean)
      .map(item => lowercase ? item.toLowerCase() : item)
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

module.exports._test = { getPracticeChatAccess, roomRoleForMember, ensureCometChatUser, configuredRooms, getVisibleRoomsForUser };
module.exports.getPracticeChatAccess = getPracticeChatAccess;
