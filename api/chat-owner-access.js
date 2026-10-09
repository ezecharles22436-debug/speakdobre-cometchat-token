const shared = require('./_trial-booking-shared');
const { trustedStaffConfig } = require('./_chat-room-staff');
const { roleForMember } = require('./_chat-room-policy');
const { roomReleaseReady } = require('./_chat-room-release');
const { createRoomStore } = require('./_chat-room-store');
const { createRoomProvider } = require('./_chat-room-provider');
const { createSuspensionService } = require('./_chat-suspension');

function createHandler(deps = {}) {
  const env = deps.env || process.env;
  return async (req, res) => {
    shared.setCors(req, res, 'POST, OPTIONS'); res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Метод не підтримується.' });
    const isolated = env.VERCEL_ENV === 'preview' && env.COMETCHAT_APP_ID === '168437005e7f6fa2a';
    const live = env.VERCEL_ENV === 'production' && env.COMETCHAT_APP_ID === '1677376866e3f736f';
    if (!(isolated || live) || env.CHAT_OWNER_MANAGEMENT_ENABLED !== 'true' || !roomReleaseReady(env)) return res.status(503).json({ error: 'Керування доступом ще не ввімкнено.' });
    try {
      shared.assertAllowedOrigin(req); shared.assertJsonRequest(req);
      const { memberId } = await (deps.verifyMember || shared.verifyMember)(req);
      const { config } = trustedStaffConfig(env);
      const role = roleForMember(memberId, config);
      const sameMode = uid => isolated ? uid.startsWith('mem_sb_') : !uid.startsWith('mem_sb_');
      if (role !== 'super_moderator' || !sameMode(memberId)) return res.status(403).json({ error: 'Доступ лише для власника.' });
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!body || Object.keys(body).some(k => !['targetUid','action'].includes(k)) || !/^mem_[A-Za-z0-9_-]{1,96}$/.test(body.targetUid || '') || !['status','suspend','restore'].includes(body.action)) return res.status(400).json({ error: 'Некоректний запит.' });
      const uid = body.targetUid;
      if (!sameMode(uid) || uid === memberId || roleForMember(uid, config) !== 'student') return res.status(403).json({ error: 'Цей акаунт недоступний для цієї дії.' });
      const chat = deps.chat || createRoomProvider();
      const actor = await chat.user(memberId);
      if (actor.role !== 'super_moderator' || actor.deactivatedAt) return res.status(403).json({ error: 'Не підтверджено права власника.' });
      const member = await (deps.getMember || shared.getMemberstackMember)(uid);
      if (member?.id !== uid) return res.status(404).json({ error: 'Акаунт не знайдено.' });
      const target = await chat.user(uid);
      if (target.role !== 'student') return res.status(403).json({ error: 'Цей акаунт недоступний для цієї дії.' });
      const store = deps.store || createRoomStore();
      if (body.action === 'status') {
        const record = await store.read(uid);
        return res.status(200).json({ targetUid: uid, name: target.name || 'Студент', status: record?.accessState || 'active', syncError: record?.accessSyncError === true });
      }
      const result = await createSuspensionService({ store, chat })({ actor: { uid: memberId, role }, uid, action: body.action });
      return res.status(200).json({ targetUid: uid, ...result });
    } catch (error) {
      const status = error instanceof SyntaxError ? 400 : [400,401,403,404,409,413,415].includes(error.status) ? error.status : 503;
      return res.status(status).json({ error: 'Не вдалося завершити дію. Перевірте стан доступу перед повторною спробою.' });
    }
  };
}
module.exports = createHandler(); module.exports.createHandler = createHandler;
