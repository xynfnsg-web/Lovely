# Run one active bot

Keep the workspace bot workflow stopped while the hosted bot is in use. Development and production have different databases, so a production lock cannot prevent a separately running development copy from using the same Discord token.

## Hosted replicas and publishing

Each hosted instance verifies its Discord connection and database before becoming eligible to process events. Only the instance holding the shared PostgreSQL session advisory lock processes commands, AI mentions, buttons, joins, departures, and game expiry.

Other instances remain silent standbys. Their health endpoint explicitly returns `standby`, not `ok`. This allows a rolling publish to finish without the new instance replying alongside the existing active worker. When the active worker stops, a standby can take over. Losing the ownership connection stops the worker immediately; it must not reconnect and continue without reacquiring ownership.

The lock key must stay the same across releases using the same database. No extra tables or production migration scripts are needed for this guard.

The first publish introducing this protection can still briefly overlap an older version that does not have it. Wait until publishing has completed before testing. A successful build-history record does not mean an old instance is still active; use runtime termination logs to determine that.

For continuous 24/7 operation, use the Reserved VM hosting choice in Publishing rather than relying on Autoscale activity.

## Command-level replay protection

Every incoming member message is atomically claimed in PostgreSQL before spam handling, moderation, commands, trivia, AI, or activity rewards run. The receipt survives worker restarts and prevents the same Discord message from executing twice. Receipts contain only a message ID and receipt time, not message contents or member details. They expire after seven days; incoming events over 24 hours old are ignored.

An uncertain or failed action retains its receipt rather than automatically executing again. Send a new command if necessary. A database outage stops processing rather than bypassing the guard. Publish applies the new receipt table through the normal managed database schema flow; the bot never runs startup migrations.

Primary command replies and channel notices use a common stable Discord nonce. This also deduplicates sends from updated copies using different databases. It cannot control an older, unmodified host that sends without that nonce.

Delivery logs record source/response message IDs and whether delivery is a primary reply or replacement; they never log chat contents or credentials.

## One AI reply

AI chat normally edits its initial acknowledgement into the answer. Stable Discord nonces protect repeated sends. If an edit fails and a new reply is necessary, only that worker's previous bot reply is deleted, and only after the replacement is delivered successfully. Failed replacement delivery never deletes the only existing reply. No user messages or unrelated bot history are removed.

## If an unknown older host still replies

One active worker in this deployment does not prove that another project or machine is not using the same token. Neither PostgreSQL claims nor Discord nonces can make an unmodified outside copy cooperate.

The Discord application owner can reset the token in the Discord Developer Portal, then save the new value securely as `DISCORD_TOKEN` in this project's Secrets and republish. Resetting invalidates the old token and prevents other copies using it from sending replies. The bot will be unavailable until the new token is in the published environment. Keep it out of chat, source files, and screenshots. Points and settings are unaffected.
