import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { loadWallet, isPubkey } from './wallet-store.js';

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
