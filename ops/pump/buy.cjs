#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');
const { Connection, PublicKey } = require('@solana/web3.js');
const { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } = require('@solana/spl-token');
const { loadEnv, requiredEnv, argValue, tokenProgramForMint, bondingCurvePda, getBondingCurveState } = require('./lib/common.cjs');

loadEnv();
main().catch((err) => { console.error('\nbuy auto-dispatch failed:', err.message); process.exit(1); });
async function main() {
  const rpcUrl = requiredEnv('RPC_URL');
  requiredEnv('PRIVATE_KEY');
  const mint = new PublicKey(argValue('--mint') || process.env.PROJECT_TOKEN_MINT || requiredEnv('PROJECT_TOKEN_MINT'));
  const connection = new Connection(rpcUrl, process.env.COMMITMENT || 'confirmed');
  const tokenProgram = await tokenProgramForMint(connection, mint);
  const bc = bondingCurvePda(mint);
  const bcAta = getAssociatedTokenAddressSync(mint, bc, true, tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
  const curve = await getBondingCurveState(connection, mint, bcAta);
  const target = curve && !curve.complete ? 'buy-bonding-curve.cjs' : 'buy-migrated.cjs';
  console.log(`Auto buy path: ${target}${curve ? ` (bonding curve complete=${curve.complete})` : ' (no bonding curve found)'}`);
  const res = spawnSync(process.execPath, [path.join(__dirname, target), ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
  process.exit(res.status ?? 1);
}
