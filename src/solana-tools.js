import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as anchor from '@coral-xyz/anchor';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { ensureWalletDir, loadWallet, isPubkey, normalizeName } from './wallet-store.js';

export function getRpcUrl() {
  const rpc = process.env.DOTAGENT_RPC_URL || process.env.SOLANA_RPC_URL;
  if (!rpc) throw new Error('DOTAGENT_RPC_URL is required; do not default to public Solana RPC');
  return rpc;
}

export function getConnection() {
  return new Connection(getRpcUrl(), 'confirmed');
}

export async function getBalance({ walletId, publicKey }) {
  const key = publicKey || loadWallet(walletId).publicKey.toBase58();
  if (!isPubkey(key)) throw new Error('invalid public key');
  const lamports = await getConnection().getBalance(new PublicKey(key));
  return { publicKey: key, lamports, sol: lamports / LAMPORTS_PER_SOL };
}

export function signMessage({ walletId, message }) {
  const kp = loadWallet(walletId);
  const bytes = new TextEncoder().encode(String(message || ''));
  const sig = nacl.sign.detached(bytes, kp.secretKey);
  return { publicKey: kp.publicKey.toBase58(), message, signatureBase58: bs58.encode(sig) };
}

export async function sendSol({ walletId, to, lamports }) {
  if (!isPubkey(to)) throw new Error('invalid recipient public key');
  const amount = BigInt(lamports);
  if (amount <= 0n) throw new Error('lamports must be positive');
  const kp = loadWallet(walletId);
  const tx = new Transaction().add(SystemProgram.transfer({
    fromPubkey: kp.publicKey,
    toPubkey: new PublicKey(to),
    lamports: Number(amount),
  }));
  const signature = await sendAndConfirmTransaction(getConnection(), tx, [kp], { commitment: 'confirmed' });
  return { signature, from: kp.publicKey.toBase58(), to, lamports: Number(amount) };
}


const REGISTRATION_FEE_LAMPORTS = 200_000_000;
const DEFAULT_PROGRAM_ID = '69y12nkHQFaWUxtnrQ5kMccS5ZBZFJq9RQWqAsWaZJAM';
const MPL_CORE_PROGRAM_ID = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d';
const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function idlPath() {
  return process.env.DOTAGENT_IDL_PATH || path.join(__dirname, 'dotagent_registrar.idl.json');
}

function loadIdl() {
  return JSON.parse(fs.readFileSync(idlPath(), 'utf8'));
}

function assetPath(walletId, name) {
  const dir = path.join(ensureWalletDir(), 'assets');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  return path.join(dir, `${walletId}-${name}-asset.json`);
}

function loadOrCreateAsset(walletId, name) {
  const file = assetPath(walletId, name);
  if (fs.existsSync(file)) {
    return { keypair: Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, 'utf8')))), path: file, created: false };
  }
  const keypair = Keypair.generate();
  fs.writeFileSync(file, JSON.stringify(Array.from(keypair.secretKey)), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return { keypair, path: file, created: true };
}

export async function registerPassport({ walletId, name, metadataUri, profile = {}, programId }) {
  const normalized = normalizeName(name);
  const payer = loadWallet(walletId);
  const connection = getConnection();
  const balance = await connection.getBalance(payer.publicKey);
  if (balance < REGISTRATION_FEE_LAMPORTS) {
    throw new Error(`wallet needs at least 0.2 SOL plus gas; current balance ${balance / LAMPORTS_PER_SOL} SOL`);
  }

  const idl = loadIdl();
  const resolvedProgramId = new PublicKey(programId || process.env.DOTAGENT_PROGRAM_ID || idl.address || DEFAULT_PROGRAM_ID);
  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const program = new anchor.Program({ ...idl, address: resolvedProgramId.toBase58() }, provider);

  const [registry] = PublicKey.findProgramAddressSync([Buffer.from('registry'), Buffer.from('agent')], resolvedProgramId);
  const [domainRecord] = PublicKey.findProgramAddressSync([Buffer.from('domain'), Buffer.from(normalized)], resolvedProgramId);
  const [feeVault] = PublicKey.findProgramAddressSync([Buffer.from('fee-vault'), Buffer.from(normalized)], resolvedProgramId);

  const existing = await connection.getAccountInfo(domainRecord);
  if (existing) {
    const account = await program.account.domainRecord.fetch(domainRecord);
    return {
      alreadyRegistered: true,
      name: account.name,
      fullName: `${account.name}.agent`,
      owner: account.owner.toBase58(),
      domainRecord: domainRecord.toBase58(),
      nftAsset: account.nftAsset.toBase58(),
      collection: account.collection.toBase58(),
      metadataUri: account.metadataUri,
    };
  }

  const registryAccount = await program.account.registryConfig.fetch(registry);
  const asset = loadOrCreateAsset(walletId, normalized);
  const uri = metadataUri || `${String(process.env.DOTAGENT_METADATA_BASE_URI || 'https://api.dotagent.app/meta/').replace(/\/$/, '')}/${normalized}.agent`;
  const inputProfile = {
    twitter: profile.twitter ?? null,
    website: profile.website ?? null,
    publicSolanaWallet: profile.publicSolanaWallet ? new PublicKey(profile.publicSolanaWallet) : payer.publicKey,
    displayName: profile.displayName ?? null,
    bio: profile.bio ?? null,
  };
  const collection = registryAccount.collection?.toBase58?.() === SYSTEM_PROGRAM_ID
    ? SystemProgram.programId
    : registryAccount.collection;

  const signature = await program.methods
    .registerAgent(normalized, uri, inputProfile)
    .accounts({
      payer: payer.publicKey,
      registry,
      feeVault,
      treasury: registryAccount.treasury,
      mplCoreProgram: new PublicKey(MPL_CORE_PROGRAM_ID),
      agentNftAsset: asset.keypair.publicKey,
      collection,
      domainRecord,
      systemProgram: SystemProgram.programId,
    })
    .signers([asset.keypair])
    .rpc();

  const account = await program.account.domainRecord.fetch(domainRecord);
  return {
    signature,
    name: account.name,
    fullName: `${account.name}.agent`,
    owner: account.owner.toBase58(),
    domainRecord: domainRecord.toBase58(),
    nftAsset: account.nftAsset.toBase58(),
    collection: account.collection.toBase58(),
    metadataUri: account.metadataUri,
    registrationFeeLamports: REGISTRATION_FEE_LAMPORTS,
    assetKeypairPath: asset.path,
  };
}
