import { timeClientStep } from './startup-timing.mjs';
export const PREVIEW_ORIGIN = 'https://speakdobre-cometchat-git-db9a07-ezecharles22436-4127s-projects.vercel.app';
const roles = new Set(['student', 'moderator', 'super_moderator']);

// Use only on Webflow staging with an explicitly signed-in Test Mode member.
// Tokens remain in memory and are never written into markup or browser storage.
export function createPreviewSessionClient({ pageOrigin, memberstack, fetcher = fetch }) {
  if (pageOrigin !== 'https://speakdobre.webflow.io') throw Error('Ця версія доступна лише на тестовому сайті.');
  let identity, issued;
  async function member(label = 'identity-only') {
    const result = await timeClientStep(label, () => memberstack.getCurrentMember());
    const current = result?.data ?? result;
    if (!/^mem_sb_[A-Za-z0-9_-]+$/.test(current?.id || '')) throw Error('Увійдіть до тестового акаунта.');
    if (identity && current.id !== identity) throw Error('Акаунт змінився. Оновіть сторінку.');
    identity = current.id;
    return current;
  }
  async function getMemberstackToken() {
    await member('member-before-cookie');
    const token = await timeClientStep('cookie', () => memberstack.getMemberCookie());
    if (typeof token !== 'string' || !token) throw Error('Увійдіть до тестового акаунта.');
    await member('member-after-cookie');
    return token;
  }
  async function getSession() {
    const credential = issued;
    // Keep the stricter standalone credential helper for selector/staff writes.
    // Session responses are not exposed until both account and token are checked
    // again. A second profile read immediately after a synchronous cookie read
    // adds a round trip without strengthening the final identity binding.
    await member('member-before-cookie');
    const token = await timeClientStep('cookie', () => memberstack.getMemberCookie());
    if (typeof token !== 'string' || !token) throw Error('Увійдіть до тестового акаунта.');
    const response = await timeClientStep('request', () => fetcher(`${PREVIEW_ORIGIN}/api/cometchat-token`, {
      method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: credential ? JSON.stringify({ operation: 'verify' }) : '{}', signal: AbortSignal.timeout(15000),
    }));
    if (!response.ok) throw Error(response.status === 403 ? 'Немає доступу до Practice Chat.' : 'Не вдалося перевірити доступ до чату.');
    let session = await timeClientStep('response-json', () => response.json());
    await member('member-after-request');
    if (await memberstack.getMemberCookie() !== token) throw Error('Сеанс змінився. Оновіть сторінку.');
    if (credential) {
      if (session?.verified !== true || session.user?.uid !== credential.uid || session.user?.role !== credential.role) throw Error('Сеанс змінився. Оновіть сторінку.');
      // Reuse only the SDK credential, never cached entitlement or memberships.
      session = { ...session, token: credential.token };
    }
    if (typeof session?.token !== 'string' || !session.token || session.user?.uid !== identity || !roles.has(session.user.role) || !Array.isArray(session.rooms) || !Array.isArray(session.staffContacts)) throw Error('Сервер не підтвердив сеанс чату.');
    if (!credential) issued = { uid: session.user.uid, role: session.user.role, token: session.token };
    return session;
  }
  return { getSession, getMemberstackToken, checkIdentity: member };
}
