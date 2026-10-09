export const PREVIEW_ORIGIN = 'https://speakdobre-cometchat-git-db9a07-ezecharles22436-4127s-projects.vercel.app';
import { phaseTimer } from './startup-timing.mjs';
const roles = new Set(['student', 'moderator', 'super_moderator']);

// Use only on Webflow staging with an explicitly signed-in Test Mode member.
// Tokens remain in memory and are never written into markup or browser storage.
export function createPreviewSessionClient({ pageOrigin, memberstack, fetcher = fetch }) {
  if (pageOrigin !== 'https://speakdobre.webflow.io') throw Error('Ця версія доступна лише на тестовому сайті.');
  let identity, issued;
  async function member() {
    const result = await memberstack.getCurrentMember();
    const current = result?.data ?? result;
    if (!/^mem_sb_[A-Za-z0-9_-]+$/.test(current?.id || '')) throw Error('Увійдіть до тестового акаунта.');
    if (identity && current.id !== identity) throw Error('Акаунт змінився. Оновіть сторінку.');
    identity = current.id;
    return current;
  }
  async function getMemberstackToken() {
    await member();
    const token = await memberstack.getMemberCookie();
    if (typeof token !== 'string' || !token) throw Error('Увійдіть до тестового акаунта.');
    await member();
    return token;
  }
  async function getSession() {
    const done = phaseTimer('authorization');
    const credential = issued;
    const token = await getMemberstackToken();
    const response = await fetcher(`${PREVIEW_ORIGIN}/api/cometchat-token`, {
      method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: credential ? JSON.stringify({ operation: 'verify' }) : '{}', signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Error(response.status === 403 ? 'Немає доступу до Practice Chat.' : 'Не вдалося перевірити доступ до чату.');
    let session = await response.json();
    await member();
    if (credential) {
      if (session?.verified !== true || session.user?.uid !== credential.uid || session.user?.role !== credential.role) throw Error('Сеанс змінився. Оновіть сторінку.');
      // Reuse only the SDK credential, never cached entitlement or memberships.
      session = { ...session, token: credential.token };
    }
    if (typeof session?.token !== 'string' || !session.token || session.user?.uid !== identity || !roles.has(session.user.role) || !Array.isArray(session.rooms) || !Array.isArray(session.staffContacts)) throw Error('Сервер не підтвердив сеанс чату.');
    if (!credential) issued = { uid: session.user.uid, role: session.user.role, token: session.token };
    done();
    return session;
  }
  return { getSession, getMemberstackToken, checkIdentity: member };
}
