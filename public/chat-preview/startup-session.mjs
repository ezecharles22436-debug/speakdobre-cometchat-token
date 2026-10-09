// Share authorization only during this mount, not between visits or actions.
// Revalidate the Memberstack identity on every use; bound the reuse window.
export function createStartupSession({ load, checkIdentity, now = Date.now }) {
  let booting = true, pending, started = 0;
  return {
    async getSession() {
      // load validates identity before and after its authenticated request.
      // Reuse needs one fresh identity read, not another cookie/token workflow.
      if (!booting) return load();
      if (!pending || now() - started >= 10000) {
        started = now();
        pending = Promise.resolve().then(load);
        return pending;
      }
      const session = await pending;
      await checkIdentity();
      return session;
    },
    finish() { booting = false; pending = undefined; },
  };
}
