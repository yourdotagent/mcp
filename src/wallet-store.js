import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

const DEFAULT_DIR = path.resolve(process.cwd(), 'wallets');

export function walletDir() {
  return path.resolve(process.env.DOTAGENT_WALLET_DIR || DEFAULT_DIR);
}

export function ensureWalletDir() {
  const dir = walletDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  safeChmod(dir, 0o700);
  return dir;
}

export function normalizeName(name) {
  const normalized = String(name || '').trim().toLowerCase().replace(/\.agent$/, '');
  if (!/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(normalized)) {
    throw new Error('invalid .agent name');
  }
  return normalized;
}

function safeId(label) {
  const clean = String(label || '').trim().toLowerCase().replace(/\.agent$/, '').replace(/[^a-z0-9_-]/g, '-');
  return clean || crypto.randomUUID();
}

function walletPath(id) {
  return path.join(ensureWalletDir(), `${safeId(id)}.json`);
}

export function createWallet({ id, agentName, purpose = '.agent passport wallet' } = {}) {
  const name = agentName ? normalizeName(agentName) : undefined;
  const walletId = safeId(id || name || `agent-${crypto.randomUUID()}`);
  const file = walletPath(walletId);
  if (fs.existsSync(file)) throw new Error(`wallet already exists: ${walletId}`);
  const kp = Keypair.generate();
  const payload = {
    id: walletId,
    agentName: name,
    purpose,
    publicKey: kp.publicKey.toBase58(),
    secretKey: Array.from(kp.secretKey),
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), { mode: 0o600 });
  safeChmod(file, 0o600);
  return publicWallet(payload);
}

export function listWallets() {
  const dir = ensureWalletDir();
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => publicWallet(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))));
}

export function loadWallet(id) {
  const file = walletPath(id);
  if (!fs.existsSync(file)) throw new Error(`wallet not found: ${id}`);
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(payload.secretKey));
}

function safeChmod(target, mode) {
  if (process.platform === 'win32') return;
  try {
    fs.chmodSync(target, mode);
  } catch (error) {
    if (error?.code !== 'ENOSYS' && error?.code !== 'EPERM') throw error;
  }
}

export function publicWallet(payload) {
  return {
    id: payload.id,
    agentName: payload.agentName || null,
    purpose: payload.purpose || null,
    publicKey: payload.publicKey,
    createdAt: payload.createdAt,
  };
}

export function exportPublicKey(id) {
  return loadWallet(id).publicKey.toBase58();
}

export function isPubkey(value) {
  try { new PublicKey(value); return true; } catch { return false; }
}

export function secretAsBase58(id) {
  if (process.env.DOTAGENT_ALLOW_SECRET_EXPORT !== 'true') {
    throw new Error('secret export disabled; set DOTAGENT_ALLOW_SECRET_EXPORT=true only for local backup');
  }
  return bs58.encode(loadWallet(id).secretKey);
}
