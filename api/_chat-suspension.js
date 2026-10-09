// Chat-only access restriction. Never changes Memberstack plans or billing.
function assertChatAccess(record) {
  if (record && Object.hasOwn(record, 'accessState') && record.accessState !== 'active') {
    const error = new Error('Доступ до Practice Chat призупинено. Зверніться до підтримки.');
    error.status = 403; error.code = 'CHAT_SUSPENDED'; throw error;
  }
}
async function revokeChatSessions(chat, uid) {
  // Attempt both safeguards even if either provider operation fails.
  const results = await Promise.allSettled([chat.flushTokens(uid), chat.deactivate(uid)]);
  if (results.some(result => result.status === 'rejected')) throw Error('Session revocation incomplete');
  if (!(await chat.user(uid)).deactivatedAt) throw Error('Revocation not confirmed');
}
async function verifyIssuedChatAccess({ store, chat, uid }) {
  try { assertChatAccess(await store.read(uid)); }
  catch (error) {
    await revokeChatSessions(chat, uid);
    throw error;
  }
}
function createSuspensionService({ store, chat, now = () => new Date().toISOString() }) {
  return async ({ actor, uid, action }) => {
    if (actor?.role !== 'super_moderator' || actor.uid === uid || !/^mem_[A-Za-z0-9_-]{1,96}$/.test(uid) || !['suspend','restore'].includes(action)) {
      const error = new Error('Недоступно.'); error.status = 403; throw error;
    }
    const previous = await store.read(uid);
    if ((previous?.state && previous.state !== 'idle') || ['revoking','restoring'].includes(previous?.accessState)) {
      const error = new Error('Операція вже виконується.'); error.status = 409; throw error;
    }
    if (action === 'restore' && (!previous || previous.accessState === 'active' || !previous.accessState)) return { status: 'active' };
    const pending = await store.writeAccess(uid, previous, {
      accessState: action === 'suspend' ? 'revoking' : 'restoring',
      accessUpdatedBy: actor.uid, accessUpdatedAt: now(), accessSyncError: false
    });
    try {
      // Restriction is durable BEFORE revocation. No automatic expiry/unban.
      // Restore only permits the normal login path, which still checks entitlement.
      if (action === 'suspend') {
        await revokeChatSessions(chat, uid);
      }
      await store.writeAccess(uid, pending, { accessState: action === 'suspend' ? 'suspended' : 'active', accessUpdatedAt: now(), accessSyncError: false });
      return { status: action === 'suspend' ? 'suspended' : 'active' };
    } catch (error) {
      // Leave failed operations blocked, never grant access on partial failure.
      await store.writeAccess(uid, pending, { accessState: 'suspended', accessSyncError: true, accessUpdatedAt: now() }).catch(() => {});
      throw error;
    }
  };
}
module.exports = { assertChatAccess, createSuspensionService, revokeChatSessions, verifyIssuedChatAccess };
