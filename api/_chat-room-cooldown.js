const INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;
function selectionWindow(record, now = Date.now(), memberships = []) {
  // Legacy successful selections retain their recorded operation time.
  const changed = Date.parse(record?.selectionChangedAt || (record?.selected?.length ? record.startedAt : '') || '');
  // Existing provider memberships do not prove when a student last changed
  // groups. Never treat missing/corrupt history as a new student's first choice.
  const hasHistory = Boolean(record?.selectionChangedAt || record?.selected?.length || memberships.length);
  if (!Number.isFinite(changed) && hasHistory) {
    return { canChange: false, nextChangeAt: null, cooldownReviewRequired: true };
  }
  const next = Number.isFinite(changed) ? changed + INTERVAL_MS : null;
  return { canChange: next === null || now >= next,
    nextChangeAt: next === null ? null : new Date(next).toISOString() };
}
module.exports = { INTERVAL_MS, selectionWindow };
