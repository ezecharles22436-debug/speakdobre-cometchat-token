// Temporary diagnostics: fixed labels and durations only, never payloads.
// Not part of production origin replacement; always restricted to staging.
const labels = new Set(['manifest', 'assets', 'interface', 'navigation', 'authorization', 'sdk-login', 'group-render']);
export function phaseTimer(label) {
  const enabled = typeof location !== 'undefined' && location.origin === 'https://speakdobre.webflow.io' && labels.has(label);
  const start = Date.now();
  return () => { if (enabled) console.info('[sd-perf]', label, Date.now() - start); };
}
export function reportServerTiming(value) {
  if (typeof location === 'undefined' || location.origin !== 'https://speakdobre.webflow.io' || typeof value !== 'string') return;
  for (const item of value.split(',').slice(0, 8)) {
    const match = item.trim().match(/^(verify|member|provision|contacts|memberships|selection|reactivate|token);dur=(\d+(?:\.\d+)?)$/);
    if (match) console.info('[sd-server]', match[1], Number(match[2]));
  }
}
