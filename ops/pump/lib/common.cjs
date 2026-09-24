const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bs58Module = require('bs58');
const { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } = require('@solana/spl-token');
const bs58 = bs58Module.default || bs58Module;

const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const PUMP_AMM_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const PUMP_FEE_PROGRAM_ID = new PublicKey('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ');
const PUMP_FEE_RECIPIENT = new PublicKey('CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM');
const MPL_TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
const SYSVAR_RENT = new PublicKey('SysvarRent111111111111111111111111111111111');
const NATIVE_SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const PUMP_GLOBAL = PublicKey.findProgramAddressSync([Buffer.from('global')], PUMP_PROGRAM_ID)[0];
const PUMP_EVENT_AUTHORITY = PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], PUMP_PROGRAM_ID)[0];
const PUMP_GLOBAL_VOLUME_ACCUMULATOR = PublicKey.findProgramAddressSync([Buffer.from('global_volume_accumulator')], PUMP_PROGRAM_ID)[0];
const PUMP_FEE_CONFIG = PublicKey.findProgramAddressSync([Buffer.from('fee_config'), PUMP_PROGRAM_ID.toBuffer()], PUMP_FEE_PROGRAM_ID)[0];

function loadEnv() {
  loadDotEnv(path.join(__dirname, '..', '.env'));
  loadDotEnv(path.join(process.cwd(), '.env'));
  loadDotEnv(path.join(process.cwd(), 'ops', 'pump', '.env'));
}
function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}
function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}. Provide an explicitly approved Solana RPC via RPC_URL; this script has no public RPC fallback.`);
  return value;
}
function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}
function keypairFromPrivateKey(pk) {
  const trimmed = String(pk).trim();
  if (trimmed.startsWith('[')) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(trimmed)));
  return Keypair.fromSecretKey(bs58.decode(trimmed));
}
function anchorDisc(name) {
  return crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}
function pda(seeds, programId) { return PublicKey.findProgramAddressSync(seeds, programId)[0]; }
function bondingCurvePda(mintPk) { return pda([Buffer.from('bonding-curve'), mintPk.toBuffer()], PUMP_PROGRAM_ID); }
function creatorVaultPda(creator) { return pda([Buffer.from('creator-vault'), creator.toBuffer()], PUMP_PROGRAM_ID); }
function userVolumeAccumulatorPda(user) { return pda([Buffer.from('user_volume_accumulator'), user.toBuffer()], PUMP_PROGRAM_ID); }
async function tokenProgramForMint(connection, mintPk) {
  if (mintPk.equals(NATIVE_SOL_MINT)) return TOKEN_PROGRAM_ID;
  const info = await connection.getAccountInfo(mintPk);
  if (!info) throw new Error(`Mint not found: ${mintPk.toBase58()}`);
  if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  throw new Error(`Unsupported mint owner for ${mintPk.toBase58()}: ${info.owner.toBase58()}`);
}
async function getBondingCurveState(connection, mintPk, associatedBondingCurve) {
  const bondingCurve = bondingCurvePda(mintPk);
  const info = await connection.getAccountInfo(bondingCurve);
  if (!info) return null;
  const d = info.data;
  if (d.length < 81) throw new Error(`Unexpected bonding curve account length ${d.length}`);
  return {
    bondingCurve,
    associatedBondingCurve,
    virtualTokenReserves: d.readBigUInt64LE(8),
    virtualSolReserves: d.readBigUInt64LE(16),
    realTokenReserves: d.readBigUInt64LE(24),
    realSolReserves: d.readBigUInt64LE(32),
    complete: d[48] === 1,
    creator: new PublicKey(d.subarray(49, 81)),
  };
}
function resolveLamports() {
  const raw = argValue('--amount-lamports') || process.env.BUY_LAMPORTS;
  if (raw) return Number(raw);
  const sol = argValue('--amount-sol') || process.env.BUY_SOL;
  if (!sol) throw new Error('Set BUY_SOL/BUY_LAMPORTS or pass --amount-sol/--amount-lamports');
  return Math.floor(Number(sol) * LAMPORTS_PER_SOL);
}
function assertSafeLamports(value, label) {
  if (!Number.isSafeInteger(Number(value))) throw new Error(`${label} is not a safe JS integer: ${value}`);
}
module.exports = {
  LAMPORTS_PER_SOL, SystemProgram,
  PUMP_PROGRAM_ID, PUMP_AMM_PROGRAM_ID, PUMP_FEE_PROGRAM_ID, PUMP_FEE_RECIPIENT, MPL_TOKEN_METADATA_PROGRAM_ID, SYSVAR_RENT,
  PUMP_GLOBAL, PUMP_EVENT_AUTHORITY, PUMP_GLOBAL_VOLUME_ACCUMULATOR, PUMP_FEE_CONFIG, NATIVE_SOL_MINT,
  loadEnv, requiredEnv, argValue, keypairFromPrivateKey, anchorDisc, bondingCurvePda, creatorVaultPda, userVolumeAccumulatorPda,
  tokenProgramForMint, getBondingCurveState, resolveLamports, assertSafeLamports,
};
