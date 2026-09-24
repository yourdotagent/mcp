#!/usr/bin/env node
'use strict';

const { ComputeBudgetProgram, Connection, Keypair, PublicKey, Transaction } = require('@solana/web3.js');
const { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const {
  getPdaLaunchpadAuth,
  getPdaLaunchpadPoolId,
  getPdaLaunchpadVaultId,
  initializeWithToken2022,
} = require('@raydium-io/raydium-sdk-v2');
const BN = require('bn.js');
const bs58 = require('bs58');

const API = 'https://www.stonkfun.xyz/api/public/v1';
const APPROVED_HELIUS = 'https://mainnet.helius-rpc.com/?api-key=843d4b83-14b3-4c83-ad5e-a3d0a7f0fe65';

function arg(name, fallback = '') {
  const i = process.argv.indexOf(name);
  return i >= 0 ? String(process.argv[i + 1] || '') : fallback;
}
function flag(name) { return process.argv.includes(name); }
function die(message) { console.error(message); process.exit(1); }
async function get(path) {
  const res = await fetch(API + path, { headers: { accept: 'application/json' } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || body?.message || `StonkFun HTTP ${res.status}`);
  return body.data ?? body;
}
function keypairFromEnv() {
  const raw = process.env.PRIVATE_KEY || process.env.SOLANA_PRIVATE_KEY || '';
  if (!raw) return null;
  const text = raw.trim();
  if (text.startsWith('[')) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(text)));
  const mod = bs58.default || bs58;
  return Keypair.fromSecretKey(mod.decode(text));
}
function requireApprovedRpc() {
  const rpc = process.env.RPC_URL || process.env.DOTAGENT_RPC_URL || '';
  if (!rpc) die('RPC_URL is required. Use the approved Helius endpoint; no public RPC fallback.');
  if (rpc !== APPROVED_HELIUS) die('Refusing unapproved Solana RPC. Set RPC_URL to the approved Helius endpoint.');
  return rpc;
}

async function main() {
  const quoteMintText = arg('--quote-mint') || process.env.STONKFUN_QUOTE_MINT;
  const name = arg('--name', process.env.STONKFUN_TOKEN_NAME || 'My Token');
  const symbol = arg('--symbol', process.env.STONKFUN_TOKEN_SYMBOL || 'MYTKN');
  const uri = arg('--uri', process.env.STONKFUN_METADATA_URI || '');
  const taxBps = Number(arg('--tax-bps', process.env.STONKFUN_TAX_BPS || '0'));
  const send = flag('--send');
  const buildOnly = flag('--build') || send;
  if (!quoteMintText) die('Missing --quote-mint <mint>');
  if (buildOnly && !uri) die('Missing --uri <metadata json url> for LaunchLab initialize');

  const { pairs } = await get('/pairs?launchable=true&launchLabReady=true');
  const pair = Array.isArray(pairs) ? pairs.find((item) => item.mint === quoteMintText) : null;
  if (!pair) die('Quote mint is not currently launchable with LaunchLab on StonkFun.');
  const pricing = await get(`/launchlab/pricing?quoteMint=${encodeURIComponent(quoteMintText)}`);
  if (taxBps && !pricing?.modes?.reward?.transferFeeBps?.includes(taxBps)) die('Requested tax-bps is not published by StonkFun reward mode.');

  const mode = taxBps ? 'reward' : 'standard';
  const plan = {
    api: API,
    quoteMint: quoteMintText,
    quoteSymbol: pair.symbol,
    quoteTokenProgram: pair.tokenProgram,
    mode,
    taxBps,
    programId: pricing.curve.programId,
    configId: pricing.curve.configId,
    platformId: taxBps ? pricing.platform.reward : pricing.platform.standard,
    curveRule: taxBps ? pricing.curveRule.reward : pricing.curveRule.standard,
    baseDecimals: pricing.curve.baseDecimals,
    supply: pricing.curve.supply,
    totalSellA: pricing.curve.totalSellA,
    totalFundRaisingB: pricing.raise.raw,
    migrateType: 'cpmm',
  };

  if (!buildOnly) {
    console.log(JSON.stringify({ ok: true, action: 'plan', plan, note: 'Pass --build to construct a transaction; pass --send only after exact approval.' }, null, 2));
    return;
  }

  const creator = keypairFromEnv();
  if (!creator) die('PRIVATE_KEY is required for --build/--send so the mint keypair and creator can sign locally.');
  const rpc = requireApprovedRpc();
  const connection = new Connection(rpc, 'confirmed');
  const programId = new PublicKey(pricing.curve.programId);
  const quoteMint = new PublicKey(quoteMintText);
  const platformId = new PublicKey(plan.platformId);
  const mintKeypair = Keypair.generate();
  const mint = mintKeypair.publicKey;
  const { publicKey: poolId } = getPdaLaunchpadPoolId(programId, mint, quoteMint);

  const instruction = initializeWithToken2022(
    programId,
    creator.publicKey,
    creator.publicKey,
    new PublicKey(pricing.curve.configId),
    platformId,
    getPdaLaunchpadAuth(programId).publicKey,
    poolId,
    mint,
    quoteMint,
    getPdaLaunchpadVaultId(programId, poolId, mint).publicKey,
    getPdaLaunchpadVaultId(programId, poolId, quoteMint).publicKey,
    pricing.curve.baseDecimals,
    name,
    symbol,
    uri,
    {
      type: 'ConstantCurve',
      supply: new BN(pricing.curve.supply),
      totalSellA: new BN(pricing.curve.totalSellA),
      totalFundRaisingB: new BN(pricing.raise.raw),
      migrateType: 'cpmm',
    },
    new BN(0), new BN(0), new BN(0),
    pricing.curve.cpmmCreatorFeeOn,
    taxBps ? { transferFeeBasePoints: taxBps, maxinumFee: new BN('1000000000000000') } : undefined,
  );

  if (pair.tokenProgram === TOKEN_2022_PROGRAM_ID.toBase58()) {
    if (!instruction.keys[11]?.pubkey?.equals(TOKEN_PROGRAM_ID)) die('Raydium initialize account layout changed; quote token program slot not at index 11.');
    instruction.keys[11] = { ...instruction.keys[11], pubkey: TOKEN_2022_PROGRAM_ID };
  }
  instruction.keys.push({ pubkey: new PublicKey(plan.curveRule), isSigner: false, isWritable: false });

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 600000 }))
    .add(instruction);
  Object.assign(tx, { recentBlockhash: blockhash, lastValidBlockHeight, feePayer: creator.publicKey });
  tx.sign(creator, mintKeypair);

  const out = { ok: true, action: send ? 'send' : 'build', creator: creator.publicKey.toBase58(), mint: mint.toBase58(), poolId: poolId.toBase58(), plan };
  if (!send) {
    out.transactionBase64 = tx.serialize().toString('base64');
    out.note = 'Signed locally but not broadcast. Re-run with --send only after exact approval.';
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  const signature = await connection.sendRawTransaction(tx.serialize());
  out.signature = signature;
  out.solscan = `https://solscan.io/tx/${signature}`;
  console.log(JSON.stringify(out, null, 2));
}

main().catch((error) => die(error?.stack || error?.message || String(error)));
