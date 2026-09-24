import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dotagent-mcp-'));
process.env.DOTAGENT_WALLET_DIR = tmp;

const store = await import('../src/wallet-store.js');
const solana = await import('../src/solana-tools.js');

const wallet = store.createWallet({ id: 'quant', agentName: 'quant.agent' });
assert.equal(wallet.id, 'quant');
assert.equal(wallet.agentName, 'quant');
assert.match(wallet.publicKey, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
assert.equal(store.listWallets().length, 1);
assert.equal(store.exportPublicKey('quant'), wallet.publicKey);

const proof = solana.signMessage({ walletId: 'quant', message: 'dotagent passport proof: quant.agent' });
assert.equal(proof.publicKey, wallet.publicKey);
assert.match(proof.signatureBase58, /^[1-9A-HJ-NP-Za-km-z]+$/);

assert.throws(() => store.secretAsBase58('quant'), /secret export disabled/);
assert.throws(() => solana.getRpcUrl(), /DOTAGENT_RPC_URL is required/);
assert.throws(() => store.normalizeName('bad_name'), /invalid/);

console.log('offline MCP tests passed');
