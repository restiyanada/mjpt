// ── Constant-time secret comparison ──
// Used to gate the Telegram webhook, admin panel, and CSV importer.

const crypto = require("crypto");

function safeEquals(provided, expected) {
  if (!provided || !expected) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { safeEquals };
