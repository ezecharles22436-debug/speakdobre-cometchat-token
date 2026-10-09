function createRoomProvider(fetcher = fetch, env = process.env) {
  if (!/^[a-zA-Z0-9]+$/.test(env.COMETCHAT_APP_ID || '') || !/^[a-z]+$/.test(env.COMETCHAT_REGION || '') ||
      !(env.COMETCHAT_API_KEY || env.COMETCHAT_REST_API_KEY)) throw new Error('Chat provider configuration required');
  const base = `https://${env.COMETCHAT_APP_ID}.api-${env.COMETCHAT_REGION}.cometchat.io/v3`;
  const enc = encodeURIComponent;
  async function request(path, method = 'GET', body, uid) {
    const response = await fetcher(base + path, {
      method, headers: { 'Content-Type': 'application/json',
        apikey: env.COMETCHAT_API_KEY || env.COMETCHAT_REST_API_KEY, ...(uid ? { onBehalfOf: uid } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error('Chat provider request failed');
    const payload = await response.json();
    if (payload.error) throw new Error('Chat provider returned an error');
    return payload;
  }
  async function list(path, uid) {
    const result = [];
    for (let page = 1; page <= 100; page++) {
      const payload = await request(`${path}${path.includes('?') ? '&' : '?'}perPage=100&page=${page}`, 'GET', undefined, uid);
      const totalPages = Number(payload.meta?.pagination?.total_pages);
      if (!Array.isArray(payload.data) || !Number.isInteger(totalPages) || totalPages < 0 || totalPages > 100) {
        throw new Error('Cannot verify complete chat provider list');
      }
      result.push(...payload.data);
      if (page >= totalPages) return result;
    }
    throw new Error('Chat provider pagination limit');
  }
  return {
    flushTokens: uid => request(`/users/${enc(uid)}/auth_tokens`, 'DELETE'),
    deactivate: uid => request('/users', 'DELETE', { uidsToDeactivate: [uid] }),
    async user(uid) {
      const payload = await request(`/users/${enc(uid)}`);
      if (payload.data?.uid !== uid || !payload.data.role) throw new Error('Invalid staff identity response');
      return payload.data;
    },
    async friends(uid) {
      const rows = await list(`/users/${enc(uid)}/friends`);
      if (rows.some(row => !row.uid || !row.role)) throw new Error('Invalid friends response');
      return rows.map(({ uid, role }) => ({ uid, role }));
    },
    async addFriends(uid, ids) {
      if (!ids.length) return;
      const payload = await request(`/users/${enc(uid)}/friends`, 'POST', { accepted: ids, addToConversations: false });
      if (ids.some(id => payload.data?.accepted?.[id]?.success !== true)) throw new Error('Staff contacts not confirmed');
    },
    async addStaff(guid, uid, scope) {
      const key = scope === 'admin' ? 'admins' : scope === 'moderator' ? 'moderators' : null;
      if (!key) throw new Error('Invalid staff scope');
      const payload = await request(`/groups/${enc(guid)}/members`, 'POST', { [key]: [uid] });
      if (payload.data?.[key]?.[uid]?.success !== true) throw new Error('Staff membership not confirmed');
    },
    async memberships(uid) {
      const rows = await list('/groups?hasJoined=true', uid);
      if (rows.some(row => !row.guid || row.hasJoined !== true || !row.scope)) throw new Error('Invalid membership response');
      return rows.map(({ guid, scope }) => ({ guid, scope }));
    },
    async isBanned(guid, uid) {
      return (await list(`/groups/${enc(guid)}/bannedusers`)).some(user => user.uid === uid);
    },
    async remove(guid, uid) {
      await request(`/groups/${enc(guid)}/members/${enc(uid)}`, 'DELETE');
    },
    async addParticipant(guid, uid) {
      const payload = await request(`/groups/${enc(guid)}/members`, 'POST', { participants: [uid] });
      if (payload.data?.participants?.[uid]?.success !== true) throw new Error('Chat membership addition not confirmed');
    }
  };
}
module.exports = { createRoomProvider };
