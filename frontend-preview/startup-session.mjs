// Share authorization only during this mount, not between visits or actions.
// Revalidate the Memberstack identity on every use; bound the reuse window.
export function createStartupSession({ load, checkIdentity, now = Date.now }) {
  let booting = true, pending, started = 0;
  return {
    async getSession() {
      await checkIdentity();
      if (!booting) return load();
      if (!pending || now() - started >= 10000) {
        started = now();
        pending = Promise.resolve().then(load);
      }
      const session = await pending;
      await checkIdentity();
      return session;
    },
    finish() { booting = false; pending = undefined; },
  };
}
