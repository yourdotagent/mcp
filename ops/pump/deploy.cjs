const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bs58 = require('bs58');
const {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
} = require('@solana/web3.js');
const {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} = require('@solana/spl-token');

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
loadDotEnv(path.join(__dirname, '.env'));
loadDotEnv(path.join(__dirname, '..', '.env'));
loadDotEnv(path.join(process.cwd(), '.env'));
loadDotEnv(path.join(process.cwd(), 'ops', 'pump', '.env'));

const RPC_URL = requiredEnv('RPC_URL');
const connection = new Connection(RPC_URL, 'confirmed');

const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const MPL_TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
const SYSVAR_RENT = new PublicKey('SysvarRent111111111111111111111111111111111');
const PUMP_GLOBAL = PublicKey.findProgramAddressSync([Buffer.from('global')], PUMP_PROGRAM_ID)[0];
const PUMP_EVENT_AUTHORITY = PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], PUMP_PROGRAM_ID)[0];

function anchorDisc(name) {
  return crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

function bondingCurvePda(mintPk) {
  return PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), mintPk.toBuffer()], PUMP_PROGRAM_ID)[0];
}

function mintAuthorityPda() {
  return PublicKey.findProgramAddressSync([Buffer.from('mint-authority')], PUMP_PROGRAM_ID)[0];
}

function metadataPda(mintPk) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), MPL_TOKEN_METADATA_PROGRAM_ID.toBuffer(), mintPk.toBuffer()],
    MPL_TOKEN_METADATA_PROGRAM_ID
  )[0];
}

function creatorVaultPda(creator) {
  return PublicKey.findProgramAddressSync([Buffer.from('creator-vault'), creator.toBuffer()], PUMP_PROGRAM_ID)[0];
}

function userVolumeAccumulatorPda(user) {
  return PublicKey.findProgramAddressSync([Buffer.from('user_volume_accumulator'), user.toBuffer()], PUMP_PROGRAM_ID)[0];
}

function computeUnitPriceMicrolamports(unitLimit, priorityFeeSol = 0.0001) {
  const feeLamports = Math.floor(priorityFeeSol * LAMPORTS_PER_SOL);
  return Math.max(0, Math.floor((feeLamports * 1_000_000) / unitLimit));
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

function keypairFromSecret(input) {
  if (!input) throw new Error('Missing private key input');
  if (typeof input !== 'string') return Keypair.fromSecretKey(Uint8Array.from(input));
  const trimmed = input.trim();
  if (trimmed.startsWith('[')) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(trimmed)));
  if (trimmed.endsWith('.json') || trimmed.includes('/')) {
    const data = JSON.parse(fs.readFileSync(trimmed, 'utf8'));
    const arr = Array.isArray(data) ? data : data.secretKey;
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }
  return Keypair.fromSecretKey(bs58.decode(trimmed));
}

async function deployToken({ privateKey, name, symbol, metadataUri, simulate = false }) {
  const creator = keypairFromSecret(privateKey);
  const mint = Keypair.generate();

  if (!name || name.length > 32) throw new Error('Name must be 1-32 characters');
  if (!symbol || symbol.length > 10) throw new Error('Symbol must be 1-10 characters');
  if (!metadataUri) throw new Error('Metadata URI required');

  const bondingCurve = bondingCurvePda(mint.publicKey);
  const associatedBondingCurve = await getAssociatedTokenAddress(
    mint.publicKey,
    bondingCurve,
    true,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const metadata = metadataPda(mint.publicKey);
  const mintAuthority = mintAuthorityPda();

  const nameBytes = Buffer.from(name, 'utf8');
  const symbolBytes = Buffer.from(symbol, 'utf8');
  const uriBytes = Buffer.from(metadataUri, 'utf8');
  const dataLen = 8 + 4 + nameBytes.length + 4 + symbolBytes.length + 4 + uriBytes.length + 32;
  const data = Buffer.alloc(dataLen);
  let offset = 0;
  anchorDisc('create').copy(data, offset);
  offset += 8;
  data.writeUInt32LE(nameBytes.length, offset);
  offset += 4;
  nameBytes.copy(data, offset);
  offset += nameBytes.length;
  data.writeUInt32LE(symbolBytes.length, offset);
  offset += 4;
  symbolBytes.copy(data, offset);
  offset += symbolBytes.length;
  data.writeUInt32LE(uriBytes.length, offset);
  offset += 4;
  uriBytes.copy(data, offset);
  offset += uriBytes.length;
  creator.publicKey.toBuffer().copy(data, offset);

  const createKeys = [
    { pubkey: mint.publicKey, isSigner: true, isWritable: true },
    { pubkey: mintAuthority, isSigner: false, isWritable: false },
    { pubkey: bondingCurve, isSigner: false, isWritable: true },
    { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
    { pubkey: PUMP_GLOBAL, isSigner: false, isWritable: false },
    { pubkey: MPL_TOKEN_METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: metadata, isSigner: false, isWritable: true },
    { pubkey: creator.publicKey, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT, isSigner: false, isWritable: false },
    { pubkey: PUMP_EVENT_AUTHORITY, isSigner: false, isWritable: false },
    { pubkey: PUMP_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: computeUnitPriceMicrolamports(400_000) }),
    new TransactionInstruction({
      programId: PUMP_PROGRAM_ID,
      keys: createKeys,
      data,
    })
  );

  tx.feePayer = creator.publicKey;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('processed');
  tx.recentBlockhash = blockhash;
  tx.sign(creator, mint);

  if (simulate) {
    const sim = await connection.simulateTransaction(tx, [creator, mint], true);
    return {
      simulated: true,
      mint: mint.publicKey.toBase58(),
      err: sim.value.err,
      logs: sim.value.logs || [],
    };
  }

  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 5,
    preflightCommitment: 'processed',
  });
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  return {
    simulated: false,
    signature: sig,
    mint: mint.publicKey.toBase58(),
    bondingCurve: bondingCurve.toBase58(),
    creator: creator.publicKey.toBase58(),
  };
}

async function main() {
  const privateKey = process.env.PRIVATE_KEY || process.env.WALLET_SECRET_KEY || process.env.WALLET_FILE;
  const name = process.env.NAME || 'Waterfall Test';
  const symbol = process.env.SYMBOL || 'WFALL';
  const metadataUri = process.env.METADATA_URI || 'https://example.com/waterfall-test.json';
  const simulate = /^(1|true|yes)$/i.test(process.env.SIMULATE || '');

  if (!privateKey) throw new Error('Set PRIVATE_KEY or WALLET_FILE');

  const result = await deployToken({ privateKey, name, symbol, metadataUri, simulate });
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.stack || err.message || String(err));
    if (err.logs) console.error('\nLogs:\n' + err.logs.join('\n'));
    process.exit(1);
  });
}

module.exports = { deployToken, main };
