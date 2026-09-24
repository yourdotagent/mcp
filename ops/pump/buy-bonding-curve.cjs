#!/usr/bin/env node
const { Connection, PublicKey, Transaction, TransactionInstruction, ComputeBudgetProgram } = require('@solana/web3.js');
const { ASSOCIATED_TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction, getAssociatedTokenAddressSync } = require('@solana/spl-token');
const {
  SystemProgram, PUMP_PROGRAM_ID, PUMP_FEE_PROGRAM_ID, PUMP_FEE_RECIPIENT, PUMP_GLOBAL, PUMP_EVENT_AUTHORITY,
  PUMP_GLOBAL_VOLUME_ACCUMULATOR, PUMP_FEE_CONFIG, loadEnv, requiredEnv, argValue, keypairFromPrivateKey,
  anchorDisc, creatorVaultPda, userVolumeAccumulatorPda, tokenProgramForMint, getBondingCurveState, resolveLamports,
} = require('./lib/common.cjs');

loadEnv();
const COMMITMENT = process.env.COMMITMENT || 'confirmed';
const SEND = process.argv.includes('--send');
const RPC_URL = requiredEnv('RPC_URL');
const PRIVATE_KEY = requiredEnv('PRIVATE_KEY');
const MINT = new PublicKey(argValue('--mint') || process.env.PROJECT_TOKEN_MINT || requiredEnv('PROJECT_TOKEN_MINT'));
const SLIPPAGE_BPS = BigInt(argValue('--slippage-bps') || process.env.BUY_SLIPPAGE_BPS || process.env.SWAP_SLIPPAGE_BPS || '500');
const CU_LIMIT = Number(process.env.BUY_CU_LIMIT || 250000);
const CU_PRICE = Number(process.env.BUY_CU_PRICE_MICROLAMPORTS || 500000);

const connection = new Connection(RPC_URL, COMMITMENT);
const user = keypairFromPrivateKey(PRIVATE_KEY);

main().catch((err) => {
  console.error('\nbuy-bonding-curve failed:', err.message);
  if (err.logs) for (const log of err.logs) console.error(log);
  process.exit(1);
});

async function main() {
  const lamportsIn = resolveLamports();
  if (!Number.isSafeInteger(lamportsIn) || lamportsIn <= 0) throw new Error(`Invalid buy lamports: ${lamportsIn}`);
  const tokenProgram = await tokenProgramForMint(connection, MINT);
  const bondingCurve = require('./lib/common.cjs').bondingCurvePda(MINT);
  const bcAta = getAssociatedTokenAddressSync(MINT, bondingCurve, true, tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
  const curve = await getBondingCurveState(connection, MINT, bcAta);
  if (!curve) throw new Error('Bonding curve not found');
  if (curve.complete) throw new Error('Bonding curve is complete/migrated; use buy-migrated.cjs');

  const userAta = getAssociatedTokenAddressSync(MINT, user.publicKey, false, tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
  const tradeLamports = BigInt(lamportsIn);
  const newSol = curve.virtualSolReserves + tradeLamports;
  const newToken = (curve.virtualSolReserves * curve.virtualTokenReserves) / newSol;
  const tokensOut = curve.virtualTokenReserves - newToken;
  const maxSolCost = tradeLamports + (tradeLamports * SLIPPAGE_BPS) / 10000n;

  console.log('Mode:', SEND ? 'SEND' : 'SIMULATE');
  console.log('Wallet:', user.publicKey.toBase58());
  console.log('Mint:', MINT.toBase58());
  console.log('Bonding curve:', curve.bondingCurve.toBase58());
  console.log('Bonding curve ATA:', bcAta.toBase58());
  console.log('User ATA:', userAta.toBase58());
  console.log('Lamports in:', String(lamportsIn));
  console.log('Estimated tokens out raw:', tokensOut.toString());
  console.log('Max SOL cost raw:', maxSolCost.toString());
  console.log('Slippage bps:', SLIPPAGE_BPS.toString());

  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: CU_LIMIT }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: CU_PRICE }),
  );

  if (!(await connection.getAccountInfo(userAta))) {
    tx.add(createAssociatedTokenAccountInstruction(user.publicKey, userAta, user.publicKey, MINT, tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID));
  }
  if (!(await connection.getAccountInfo(bcAta))) {
    tx.add(createAssociatedTokenAccountInstruction(user.publicKey, bcAta, curve.bondingCurve, MINT, tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID));
  }

  const data = Buffer.concat([anchorDisc('buy'), Buffer.alloc(8), Buffer.alloc(8)]);
  data.writeBigUInt64LE(tokensOut, 8);
  data.writeBigUInt64LE(maxSolCost, 16);
  tx.add(new TransactionInstruction({
    programId: PUMP_PROGRAM_ID,
    keys: [
      { pubkey: PUMP_GLOBAL, isSigner: false, isWritable: false },
      { pubkey: PUMP_FEE_RECIPIENT, isSigner: false, isWritable: true },
      { pubkey: MINT, isSigner: false, isWritable: false },
      { pubkey: curve.bondingCurve, isSigner: false, isWritable: true },
      { pubkey: bcAta, isSigner: false, isWritable: true },
      { pubkey: userAta, isSigner: false, isWritable: true },
      { pubkey: user.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
      { pubkey: creatorVaultPda(curve.creator), isSigner: false, isWritable: true },
      { pubkey: PUMP_EVENT_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: PUMP_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: PUMP_GLOBAL_VOLUME_ACCUMULATOR, isSigner: false, isWritable: false },
      { pubkey: userVolumeAccumulatorPda(user.publicKey), isSigner: false, isWritable: true },
      { pubkey: PUMP_FEE_CONFIG, isSigner: false, isWritable: false },
      { pubkey: PUMP_FEE_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  }));

  const latest = await connection.getLatestBlockhash(COMMITMENT);
  tx.feePayer = user.publicKey;
  tx.recentBlockhash = latest.blockhash;
  tx.sign(user);
  const sim = await connection.simulateTransaction(tx, [user]);
  console.log('\nSimulation result:', JSON.stringify(sim.value.err || null));
  if (sim.value.logs?.length) for (const log of sim.value.logs) console.log(log);
  if (sim.value.err) {
    const e = new Error('Simulation failed; not sending.'); e.logs = sim.value.logs || []; throw e;
  }
  if (!SEND) return console.log('\nSimulation passed. Rerun with --send to submit.');
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 5 });
  await connection.confirmTransaction({ signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, COMMITMENT);
  console.log('\nBuy signature:', sig);
  console.log('Solscan: https://solscan.io/tx/' + sig);
}
