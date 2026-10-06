const { ROOMS, roleForMember } = require('./_chat-room-policy');

function trustedStaffConfig(env = process.env) {
  const parse = value => [...new Set(String(value || '').split(',').map(s => s.trim()).filter(Boolean))];
  const config = { superModeratorIds: parse(env.CHAT_SUPER_MODERATOR_IDS), moderatorIds: parse(env.CHAT_MODERATOR_IDS) };
  const ids = [...new Set([...config.superModeratorIds, ...config.moderatorIds])];
  if (!ids.length || ids.length > 30 || ids.some(id => !/^mem_[A-Za-z0-9_-]{1,96}$/.test(id))) {
    throw new Error('Verified staff configuration required');
  }
  return { config, ids };
}

// Called only after authentication, entitlement and server role verification.
// No customer enumeration, role reassignment, automatic unbanning or removal.
async function prepareRoomAccess({ uid, role, chat, env = process.env }) {
  const { config, ids } = trustedStaffConfig(env);
  if (roleForMember(uid, config) !== role) throw new Error('Untrusted room role');
  const actor = await chat.user(uid);
  if (actor.role !== role) throw new Error('Provider role mismatch');
  if (role === 'student') {
    // Validate every contact before any write. A stale/demoted staff ID cannot
    // accidentally become an allowed peer-history friendship.
    for (const id of ids) {
      const staff = await chat.user(id);
      if (staff.role !== roleForMember(id, config)) throw new Error('Staff role mismatch');
    }
    const checkFriends = rows => {
      if (rows.some(row => !ids.includes(row.uid) || row.role !== roleForMember(row.uid, config))) {
        throw new Error('Unexpected private contacts require review');
      }
    };
    const before = await chat.friends(uid);
    checkFriends(before);
    const missing = ids.filter(id => !before.some(row => row.uid === id));
    await chat.addFriends(uid, missing);
    const after = await chat.friends(uid);
    checkFriends(after);
    if (ids.some(id => !after.some(row => row.uid === id))) throw new Error('Staff contacts verification failed');
    return { contacts: ids };
  }
  const scope = role === 'super_moderator' ? 'admin' : 'moderator';
  const before = await chat.memberships(uid);
  // Do not silently promote/demote existing memberships, or alter unrelated groups.
  for (const room of ROOMS) {
    const current = before.find(row => row.guid === room.guid);
    if (current && current.scope !== scope) throw new Error('Existing staff scope requires review');
    if (await chat.isBanned(room.guid, uid)) throw new Error('Staff ban requires review');
  }
  for (const room of ROOMS) {
    if (!before.some(row => row.guid === room.guid)) await chat.addStaff(room.guid, uid, scope);
  }
  const after = await chat.memberships(uid);
  if (ROOMS.some(room => !after.some(row => row.guid === room.guid && row.scope === scope))) {
    throw new Error('Staff memberships verification failed');
  }
  return { contacts: [] };
}
module.exports = { trustedStaffConfig, prepareRoomAccess };
