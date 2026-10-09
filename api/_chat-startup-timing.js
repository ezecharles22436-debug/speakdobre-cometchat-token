const labels = new Set(['verify', 'member', 'provision', 'contacts', 'memberships', 'selection', 'reactivate', 'token']);
function createStartupTiming(req, env = process.env, now = () => performance.now()) {
  const enabled = env.VERCEL_ENV === 'preview' && env.COMETCHAT_APP_ID === '168437005e7f6fa2a' && req.headers.origin === 'https://speakdobre.webflow.io';
  const elapsed = new Map();
  return {
    async run(label, action) {
      if (!enabled || !labels.has(label)) return action();
      const started = now();
      try { return await action(); }
      finally { elapsed.set(label, Math.max(0, now() - started)); }
    },
    attach(res) {
      if (!enabled) return;
      res.setHeader('Server-Timing', [...elapsed].map(([label, ms]) => `${label};dur=${ms.toFixed(1)}`).join(', '));
      res.setHeader('Access-Control-Expose-Headers', 'Server-Timing');
    },
  };
}
module.exports = { createStartupTiming };
