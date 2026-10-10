const INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;
function selectionWindow(record, now = Date.now()) {
  // Legacy successful selections retain their recorded operation time.
  const changed = Date.parse(record?.selectionChangedAt || (record?.selected?.length ? record.startedAt : '') || '');
  const next = Number.isFinite(changed) ? changed + INTERVAL_MS : null;
  return { canChange: next === null || now >= next,
    nextChangeAt: next === null ? null : new Date(next).toISOString() };
}
module.exports = { INTERVAL_MS, selectionWindow };
