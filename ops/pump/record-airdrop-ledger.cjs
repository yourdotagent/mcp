'use strict';
const fs = require('fs');
const path = require('path');

const LEDGER_PATH = path.resolve(__dirname, '..', 'data', 'airdrop-ledger.jsonl');

async function recordAirdropRows(rows) {
  if (!rows || rows.length === 0) return;
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  const lines = rows.map(r => JSON.stringify({ ...r, recorded_at: new Date().toISOString() }));
  fs.appendFileSync(LEDGER_PATH, lines.join('\n') + '\n', 'utf8');
}

module.exports = { recordAirdropRows };
