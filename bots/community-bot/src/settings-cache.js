// Cache only configuration, never balances, warnings, or moderation records.
export function createSettingsCache({ load, ttlMs = 5000, maxEntries = 1000, now = Date.now }) {
  const entries = new Map();
  function trim() {
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
  }
  return {
    async get(key) {
      let entry = entries.get(key);
      if (entry?.value && entry.expires > now()) return structuredClone(entry.value);
      if (!entry?.pending) {
        entry = {};
        entries.set(key, entry);
        trim();
        entry.pending = Promise.resolve().then(() => load(key));
      }
      try {
        const value = await entry.pending;
        // A successful settings write supersedes a read that was already in flight.
        if (entries.get(key) !== entry) return this.get(key);
        entry.value = value;
        entry.expires = now() + ttlMs;
        delete entry.pending;
        return structuredClone(value);
      } catch (error) {
        if (entries.get(key) === entry) entries.delete(key);
        throw error;
      }
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, { value: structuredClone(value), expires: now() + ttlMs });
      trim();
      return structuredClone(value);
    },
  };
}
