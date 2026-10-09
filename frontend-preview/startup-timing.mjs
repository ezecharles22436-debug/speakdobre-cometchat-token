// Temporary diagnostics: fixed labels and durations only, never payloads.
// Not part of production origin replacement; always restricted to staging.
const labels = new Set(['manifest', 'assets', 'interface', 'navigation', 'authorization', 'sdk-login', 'group-render']);
export function phaseTimer(label) {
  const enabled = typeof location !== 'undefined' && location.origin === 'https://speakdobre.webflow.io' && labels.has(label);
  const start = Date.now();
  return () => { if (enabled) console.info('[sd-perf]', label, Date.now() - start); };
}
