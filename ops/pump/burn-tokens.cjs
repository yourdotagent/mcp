#!/usr/bin/env node
const { Connection, PublicKey, Transaction, ComputeBudgetProgram } = require('@solana/web3.js');
const { ASSOCIATED_TOKEN_PROGRAM_ID, createBurnInstruction, getAssociatedTokenAddressSync } = require('@solana/spl-token');
const { loadEnv, requiredEnv, argValue, keypairFromPrivateKey, tokenProgramForMint } = require('./lib/common.cjs');

loadEnv();
const COMMITMENT = process.env.COMMITMENT || 'confirmed';
const SEND = process.argv.includes('--send');
const connection = new Connection(requiredEnv('RPC_URL'), COMMITMENT);
const signer = keypairFromPrivateKey(requiredEnv('PRIVATE_KEY'));
const MINT = new PublicKey(argValue('--mint') || process.env.PROJECT_TOKEN_MINT || requiredEnv('PROJECT_TOKEN_MINT'));

main().catch((err) => { console.error('\nburn-tokens failed:', err.message); if (err.logs) for (const l of err.logs) console.error(l); process.exit(1); });
async function main() {
  const tokenProgram = await tokenProgramForMint(connection, MINT);
  const ata = getAssociatedTokenAddressSync(MINT, signer.publicKey, false, tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
  const balance = await connection.getTokenAccountBalance(ata).catch(() => null);
  const amount = BigInt(argValue('--amount-raw') || process.env.BURN_AMOUNT_RAW || balance?.value?.amount || '0');
  if (amount <= 0n) throw new Error('No burn amount; set --amount-raw/BURN_AMOUNT_RAW or hold a balance in the ATA');
  console.log('Mode:', SEND ? 'SEND' : 'SIMULATE');
  console.log('Signer:', signer.publicKey.toBase58());
  console.log('Mint:', MINT.toBase58());
  console.log('ATA:', ata.toBase58());
  console.log('Burn raw:', amount.toString());
  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(process.env.BURN_CU_PRICE_MICROLAMPORTS || 200000) }),
    createBurnInstruction(ata, MINT, signer.publicKey, amount, [], tokenProgram),
  );
  const latest = await connection.getLatestBlockhash(COMMITMENT);
  tx.feePayer = signer.publicKey;
  tx.recentBlockhash = latest.blockhash;
  tx.sign(signer);
  const sim = await connection.simulateTransaction(tx, [signer]);
  console.log('\nSimulation result:', JSON.stringify(sim.value.err || null));
  if (sim.value.logs?.length) for (const l of sim.value.logs) console.log(l);
  if (sim.value.err) { const e = new Error('Simulation failed; not sending.'); e.logs = sim.value.logs || []; throw e; }
  if (!SEND) return console.log('\nSimulation passed. Rerun with --send to submit.');
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 5 });
  await connection.confirmTransaction({ signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, COMMITMENT);
  console.log('\nBurn signature:', sig);
  console.log('Solscan: https://solscan.io/tx/' + sig);
}
