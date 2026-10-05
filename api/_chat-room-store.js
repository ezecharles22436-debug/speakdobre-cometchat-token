const { randomUUID } = require('node:crypto');
const firestore = require('./_trial-booking-shared');

function createRoomStore(db = firestore, namespace = process.env.CHAT_ROOMS_DATA_NAMESPACE) {
  if (!/^[A-Za-z0-9_-]{1,48}$/.test(namespace || '')) throw new Error('Explicit chat namespace required');
  if (process.env.VERCEL_ENV === 'preview' && !namespace.startsWith('preview_')) throw new Error('Preview namespace required');
  const collection = `${namespace}_chatRoomSelections`;
  async function finish(lock, fields) {
    // CAS prevents old workers from completing a different operation.
    return db.patchDocument(`${collection}/${lock.memberId}`, fields, { updateTime: lock.updateTime });
  }
  return {
    read: memberId => db.getDocument(`${collection}/${memberId}`),
    async acquire(memberId, desired) {
      const previous = await db.getDocument(`${collection}/${memberId}`);
      if (previous && previous.state !== 'idle') return null;
      const fields = { state: 'working', operationId: randomUUID(), desired, startedAt: new Date().toISOString() };
      try {
        const record = previous
          ? await db.patchDocument(`${collection}/${memberId}`, fields, { updateTime: previous._updateTime })
          : await db.createDocument(collection, memberId, fields);
        if (!record?._updateTime) throw new Error('Missing lock version');
        return { memberId, updateTime: record._updateTime };
      } catch (error) {
        if (error.status === 409) return null;
        throw error;
      }
    },
    complete: (lock, selected) => finish(lock, { state: 'idle', selected, reason: null }),
    release: lock => finish(lock, { state: 'idle' }),
    flagForReconciliation: (lock, reason) => finish(lock, { state: 'reconcile', reason })
  };
}
module.exports = { createRoomStore };
