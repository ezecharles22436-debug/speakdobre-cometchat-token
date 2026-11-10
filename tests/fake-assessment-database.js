function createFakeAssessmentDatabase(hooks = {}) {
  const documents = new Map();
  let version = 0;
  const clone = value => value == null ? value : structuredClone(value);
  const conflict = () => Object.assign(new Error("Concurrent document change"), { status: 409 });

  return {
    documents,
    async createDocument(collection, id, fields) {
      const path = collection + "/" + id;
      await hooks.beforeCreate?.({ path, fields: clone(fields) });
      if (documents.has(path)) throw conflict();
      const record = { ...clone(fields), _updateTime: String(++version) };
      documents.set(path, record);
      await hooks.afterCreate?.({ path, record: clone(record) });
      return clone(record);
    },
    async getDocument(path) {
      await hooks.beforeRead?.({ path });
      return clone(documents.get(path) || null);
    },
    async patchDocument(path, fields, options) {
      await hooks.beforePatch?.({ path, fields: clone(fields), options: clone(options) });
      const previous = documents.get(path);
      if (!previous || !options?.updateTime || options.updateTime !== previous._updateTime) throw conflict();
      const record = { ...previous, ...clone(fields), _updateTime: String(++version) };
      documents.set(path, record);
      await hooks.afterPatch?.({ path, fields: clone(fields), record: clone(record) });
      return clone(record);
    }
  };
}

module.exports = { createFakeAssessmentDatabase };

