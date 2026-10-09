'use strict';

// Local prototype only. No SDK keys, endpoints, storage or deployment wiring.
// getSession must be the existing authenticated server session loader.
function createSessionAdapter({ getSession, sdk, render, clear, authorizeStudent }) {
  let identity = null;
  let busy = false;
  let disposed = false;
  const roles = new Set(['student', 'moderator', 'super_moderator']);
  function check(session) {
    if (!session?.token || !session.user?.uid || !roles.has(session.user.role)) {
      throw Error('Не вдалося перевірити доступ до чату.');
    }
    if (identity && (session.user.uid !== identity.uid || session.user.role !== identity.role)) {
      throw Error('Акаунт або права доступу змінилися. Оновіть сторінку.');
    }
    return session;
  }
  async function reset() {
    clear();
    await sdk.logout();
  }
  async function allowedFor(session,type,id,roomGuid) {
    if(type==='group')return session.rooms?.some(room=>room.guid===id&&room.unlocked===true);
    if(type!=='user')return false;
    if(session.user.role==='student')return session.staffContacts?.includes(id);
    if(!authorizeStudent||!session.rooms?.some(room=>room.guid===roomGuid&&room.unlocked===true))return false;
    const result=await authorizeStudent({uid:id,roomGuid});
    return result?.actor?.uid===session.user.uid&&result.actor.role===session.user.role&&result.target?.uid===id&&result.roomGuid===roomGuid;
  }
  async function open(type, id, roomGuid, navigationSession) {
    if (disposed) throw Error('Сеанс чату завершено.');
    if (busy) return false;
    busy = true;
    // Remove the old message view before awaiting entitlement checks.
    clear();
    try {
      // Navigation just performed the same authenticated request for this click.
      // Reuse only its argument, never persist it for another action. The fresh
      // post-login check below remains mandatory before rendering any messages.
      const session = check(navigationSession || await getSession());
      const allowed = await allowedFor(session,type,id,roomGuid);
      if (typeof id !== 'string' || !allowed) throw Error('Цей чат недоступний.');
      // Never reuse a cached SDK login without comparing its identity.
      const current = await sdk.getLoggedInUser();
      if (current && current.getUid() !== session.user.uid) await sdk.logout();
      const user = await sdk.loginWithAuthToken(session.token);
      if (user?.getUid() !== session.user.uid) throw Error('Не вдалося перевірити акаунт.');
      // Recheck after asynchronous SDK login to catch account/role/access changes.
      identity = { uid: session.user.uid, role: session.user.role };
      const fresh = check(await getSession());
      const stillAllowed = await allowedFor(fresh,type,id,roomGuid);
      if (!stillAllowed || disposed) throw Error('Доступ до чату змінився.');
      // Token never reaches renderer, DOM, logs or localStorage.
      await render({ type, id, role: identity.role, canStartCalls: identity.role !== 'student', ...(roomGuid?{roomGuid}:{}) });
      if (disposed) { clear(); return false; }
      return true;
    } catch (error) {
      await reset().catch(() => {});
      throw error;
    } finally { busy = false; }
  }
  return {
    open,
    async dispose() { disposed = true; await reset(); },
  };
}
module.exports = { createSessionAdapter };
