const shared = require('./_trial-booking-shared');
const { getPracticeChatAccess } = require('./cometchat-token');
const { ROOMS, roleForMember, SelectionError } = require('./_chat-room-policy');
const { createRoomSelectionService, RoomChangeError } = require('./_chat-room-selection');
const { createRoomStore } = require('./_chat-room-store');
const { createRoomProvider } = require('./_chat-room-provider');

function createHandler(deps = {}) {
  const env = deps.env || process.env;
  return async (req, res) => {
    shared.setCors(req, res, 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (!['GET', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST, OPTIONS');
      return res.status(405).json({ error: 'Метод не підтримується.' });
    }
    // Feature is disabled by default, and requires explicit RBAC verification.
    if (env.CHAT_ROOMS_ENABLED !== 'true' || env.CHAT_ROOMS_PERMISSIONS_VERIFIED !== 'true') {
      return res.status(503).json({ error: 'Вибір груп тимчасово недоступний.' });
    }
    try {
      shared.assertAllowedOrigin(req);
      if (req.method === 'POST') shared.assertJsonRequest(req);
      const { memberId, member } = await (deps.verifyMember || shared.verifyMember)(req);
      const config = {
        superModeratorIds: String(env.CHAT_SUPER_MODERATOR_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
        moderatorIds: String(env.CHAT_MODERATOR_IDS || '').split(',').map(s => s.trim()).filter(Boolean)
      };
      const role = roleForMember(memberId, config);
      if (role !== 'student' || !getPracticeChatAccess(member).allowed) {
        return res.status(403).json({ error: 'Вибір груп недоступний для цього акаунта.' });
      }
      const store = deps.store || createRoomStore();
      const chat = deps.chat || createRoomProvider();
      if (req.method === 'GET') {
        const record = await store.read(memberId);
        const memberships = await chat.memberships(memberId);
        return res.status(200).json({ rooms: ROOMS, selected: memberships.map(room => room.guid),
          pending: Boolean(record && record.state !== 'idle') });
      }
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!body || Object.keys(body).some(key => key !== 'rooms')) {
        return res.status(400).json({ error: 'Некоректні дані вибору груп.' });
      }
      const select = createRoomSelectionService({ locks: store, chat, access: async uid => {
        const fresh = await (deps.getMember || shared.getMemberstackMember)(uid);
        return { active: fresh?.id === uid && getPracticeChatAccess(fresh).allowed, role: roleForMember(uid, config) };
      } });
      return res.status(200).json(await select(memberId, body.rooms));
    } catch (error) {
      if (error instanceof SelectionError || error instanceof RoomChangeError) {
        return res.status(error.status).json({ error: error.message, code: error.code });
      }
      if (error instanceof SyntaxError) return res.status(400).json({ error: 'Некоректні дані.' });
      const status = [400, 401, 403, 409, 413, 415].includes(error.status) ? error.status : 503;
      // No upstream body, credentials, emails or identity in logs/responses.
      return res.status(status).json({ error: status === 401 ? 'Увійдіть до акаунта.' : 'Не вдалося оновити групи. Спробуйте пізніше.' });
    }
  };
}
module.exports = createHandler();
module.exports.createHandler = createHandler;
