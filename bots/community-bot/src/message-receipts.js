export function createMessageReceipts({ database, now = Date.now, log = () => {} }) {
  let nextCleanup = 0;
  return async function claim(message) {
    const time = now();
    // Reject ancient replays even after the receipt retention period expires.
    if (!/^\d{17,20}$/.test(message.id) || !Number.isFinite(message.createdTimestamp) ||
        time - message.createdTimestamp > 86_400_000 || message.createdTimestamp > time + 300_000) return false;
    const { rowCount } = await database.query(
      `INSERT INTO community_bot_message_receipts (message_id)
       VALUES ($1) ON CONFLICT (message_id) DO NOTHING RETURNING message_id`, [message.id],
    );
    if (!rowCount) log(`[message-dedup] Skipped repeated message ${message.id}.`);
    if (time >= nextCleanup) {
      nextCleanup = time + 3_600_000;
      void database.query(
        "DELETE FROM community_bot_message_receipts WHERE created_at < now() - interval '7 days'",
      ).catch(() => log("[message-receipts] Receipt cleanup failed."));
    }
    return rowCount === 1;
  };
}
