const fs = require('fs');
const path = require('path');

const LOG_PATH = process.env.DEV_TRANSACTION_LOG_PATH || path.resolve(__dirname, '..', 'data', 'dev-transactions.ndjson');

async function recordDevTransaction(entry) {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, JSON.stringify({
      recorded_at: new Date().toISOString(),
      ...normalize(entry),
    }) + '\n');
  } catch (error) {
    console.warn('[record-dev-transaction] failed:', error.message);
  }
}

function normalize(entry) {
  if (!entry || typeof entry !== 'object') return { value: entry };
  const out = {};
  for (const [key, value] of Object.entries(entry)) {
    out[key] = typeof value === 'bigint' ? value.toString() : value;
  }
  return out;
}

module.exports = { recordDevTransaction };
