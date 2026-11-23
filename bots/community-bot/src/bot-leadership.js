// Session locks are released automatically when a process/connection dies.
// This key MUST stay identical across releases that share this database.
export function createBotLeadership({
  pool,
  key = "community-bot:gateway-owner",
  pollMs = 1000,
  onAcquired = async () => {},
  onReady = () => {},
  onStandby = () => {},
  onLost = () => {},
}) {
  let connection, timer, checking, closing;
  let owned = false, active = false, closed = false, failed = false, notified = false;
  function lose(error) {
    if (failed) return;
    failed = true;
    active = false;
    clearInterval(timer);
    if (!closed) onLost(error);
  }
  function attempt() {
    if (closed || failed || owned) return Promise.resolve();
    if (checking) return checking;
    checking = (async () => {
      const { rows } = await connection.query(
        "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired", [key],
      );
      if (!rows[0].acquired) {
        if (!notified && !closed) { notified = true; await onStandby(); }
        return;
      }
      owned = true;
      if (closed) return;
      await onAcquired();
      if (!closed && !failed) {
        active = true;
        onReady();
      }
    })().finally(() => { checking = null; });
    return checking;
  }
  const leadership = {
    isLeader: () => active && !closed && !failed,
    async start() {
      try {
        connection = await pool.connect();
        connection.on("error", lose);
        await attempt();
        if (!closed && !failed) {
          timer = setInterval(() => { void attempt().catch(lose); }, pollMs);
          timer.unref?.();
        }
      } catch (error) {
        await leadership.close();
        throw error;
      }
    },
    close() {
      if (closing) return closing;
      closed = true;
      active = false;
      clearInterval(timer);
      closing = (async () => {
        await checking?.catch(() => {});
        if (!connection) return;
        let discard = failed;
        if (owned && !discard) {
          try {
            await connection.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [key]);
          } catch { discard = true; }
        }
        connection.off("error", lose);
        connection.release(discard);
      })();
      return closing;
    },
  };
  return leadership;
}
