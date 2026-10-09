const { validateSelection, SelectionError } = require('./_chat-room-policy');

// Same authoritative inputs as GET /chat-rooms, without a second authentication.
async function startupSelection({ uid, memberships, store }) {
  const record = await store.read(uid);
  if (record && record.state !== 'idle') return { ready: false, pending: true };
  try {
    validateSelection(memberships.map(room => room.guid));
    return { ready: true, pending: false };
  } catch (error) {
    if (!(error instanceof SelectionError)) throw error;
    return { ready: false, pending: false };
  }
}
module.exports = { startupSelection };
