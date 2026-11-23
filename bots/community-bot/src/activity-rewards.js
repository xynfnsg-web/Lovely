// Only skip writes after a confirmed award. PostgreSQL still decides whether an
// award is due, so restarts and overlapping workers cannot mint extra points.
export function createActivityRewards({ award, now = Date.now, intervalMs = 60_000, maxEntries = 10_000 }) {
  const entries = new Map();
  return async function reward(guildId, userId, ...args) {
    const key = `${guildId}:${userId}`;
    const current = entries.get(key);
    if (current?.pending) return current.pending;
    if (current?.nextAt > now()) return false;
    const entry = {};
    entries.delete(key);
    entries.set(key, entry);
    // Evict only completed entries; in-flight calls must remain coalesced.
    if (entries.size > maxEntries) {
      for (const [id, value] of entries) {
        if (entries.size <= maxEntries) break;
        if (value !== entry && !value.pending) entries.delete(id);
      }
    }
    entry.pending = Promise.resolve().then(() => award(guildId, userId, ...args)).then((awarded) => {
      if (awarded) {
        entry.nextAt = now() + intervalMs;
        delete entry.pending;
      } else {
        entries.delete(key);
      }
      return awarded;
    }, (error) => {
      entries.delete(key);
      throw error;
    });
    return entry.pending;
  };
}
