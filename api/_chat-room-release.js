// Owner accepted this specific residual provider risk on 2026-10-06.
// It is not a substitute for baseline RBAC or end-to-end integration checks.
const ACCEPTED_LOOKUP_RISK = 'peer-conversation-lookup-2026-10-06';
function roomReleaseReady(env = process.env) {
  return env.CHAT_ROOMS_ENABLED === 'true' && (
    env.CHAT_ROOMS_PERMISSIONS_VERIFIED === 'true' || (
      env.CHAT_ROOMS_BASELINE_VERIFIED === 'true' &&
      env.CHAT_ROOMS_ACCEPTED_RISK === ACCEPTED_LOOKUP_RISK
    )
  );
}
module.exports = { roomReleaseReady, ACCEPTED_LOOKUP_RISK };

