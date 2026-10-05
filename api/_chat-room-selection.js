const { validateSelection, membershipDelta } = require('./_chat-room-policy');

class RoomChangeError extends Error {
  constructor(code, status, message) { super(message); Object.assign(this, { code, status }); }
}

// Infrastructure adapters are deliberately required: never substitute an in-memory
// lock in a serverless deployment. acquire must be atomic and durable per member.
// An uncertain mutation retains its lock for explicit reconciliation, never a TTL
// takeover: an old worker must not be able to add rooms after another starts.
function createRoomSelectionService({ access, locks, chat }) {
  return async function selectRooms(verifiedMemberId, requestedIds) {
    if (!/^mem_[A-Za-z0-9_-]{1,96}$/.test(verifiedMemberId || '')) {
      throw new RoomChangeError('AUTH_REQUIRED', 401, 'Увійдіть до акаунта.');
    }
    const desired = validateSelection(requestedIds);
    const assertAccess = async () => {
      const state = await access(verifiedMemberId);
      if (!state?.active || state.role !== 'student') {
        throw new RoomChangeError('ACCESS_DENIED', 403, 'Вибір груп недоступний для цього акаунта.');
      }
    };
    await assertAccess();
    const lock = await locks.acquire(verifiedMemberId, desired);
    if (!lock) throw new RoomChangeError('CHANGE_IN_PROGRESS', 409, 'Зміна груп уже обробляється. Спробуйте пізніше.');
    let mutated = false;
    try {
      // Must return ALL memberships, including legacy and non-catalog groups.
      const current = await chat.memberships(verifiedMemberId);
      if (current.some(room => room.scope !== 'participant')) {
        throw new RoomChangeError('ROLE_REVIEW_REQUIRED', 409, 'Потрібна перевірка доступу модератором.');
      }
      // A moderator ban must never be bypassed by leaving/rejoining via chooser.
      for (const guid of desired) {
        if (await chat.isBanned(guid, verifiedMemberId)) {
          throw new RoomChangeError('ROOM_RESTRICTED', 403, 'Доступ до обраної групи обмежено модератором.');
        }
      }
      const delta = membershipDelta(current.map(room => room.guid), desired);
      for (const guid of delta.remove) {
        mutated = true;
        await chat.remove(guid, verifiedMemberId);
      }
      const afterRemoval = await chat.memberships(verifiedMemberId);
      if (afterRemoval.some(room => !desired.includes(room.guid))) {
        throw new Error('Room removal was not confirmed');
      }
      for (const guid of desired.filter(id => !afterRemoval.some(room => room.guid === id))) {
        await assertAccess();
        if (await chat.isBanned(guid, verifiedMemberId)) throw new Error('Room restriction changed');
        mutated = true;
        // Adapter must inspect per-member success, not just HTTP 200.
        await chat.addParticipant(guid, verifiedMemberId);
      }
      await assertAccess();
      const final = await chat.memberships(verifiedMemberId);
      if (final.length !== desired.length || final.some(room => room.scope !== 'participant') ||
          [...new Set(final.map(room => room.guid))].sort().join('|') !== desired.join('|')) {
        throw new Error('Final memberships did not match selection');
      }
      await locks.complete(lock, desired);
      return { rooms: desired };
    } catch (error) {
      if (mutated) {
        // Do not log tokens, email, provider payloads or raw error messages.
        await locks.flagForReconciliation(lock, 'MEMBERSHIP_CHANGE_UNCERTAIN');
      } else {
        await locks.release(lock);
      }
      throw error;
    }
  };
}

module.exports = { createRoomSelectionService, RoomChangeError };
