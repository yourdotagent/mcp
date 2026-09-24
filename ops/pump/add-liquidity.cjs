const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bs58Module = require('bs58');
const {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} = require('@solana/web3.js');
const {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
} = require('@solana/spl-token');

const bs58 = bs58Module.default || bs58Module;

loadDotEnv(path.join(__dirname, '.env'));
loadDotEnv(path.join(__dirname, '..', '.env'));
loadDotEnv(path.join(process.cwd(), '.env'));
loadDotEnv(path.join(process.cwd(), 'ops', 'pump', '.env'));

const RPC_URL = requiredEnv('RPC_URL');
const PRIVATE_KEY = requiredEnv('PRIVATE_KEY');
const BASE_MINT = new PublicKey(requiredEnv('PROJECT_TOKEN_MINT'));
const QUOTE_MINT = new PublicKey(process.env.CLAIM_QUOTE_MINT || NATIVE_MINT.toBase58());
const SEND = process.argv.includes('--send');
const COMMITMENT = 'confirmed';
const LP_OUT_BUFFER_BPS = Number(process.env.LP_OUT_BUFFER_BPS || Math.max(Number(process.env.SWAP_SLIPPAGE_BPS || 100), 300));
const SOL_WRAP_RESERVE_LAMPORTS = BigInt(process.env.ADDLIQ_SOL_WRAP_RESERVE_LAMPORTS || '5000000');
const PUMP_AMM = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const IS_NATIVE_SOL_QUOTE = QUOTE_MINT.equals(NATIVE_MINT);

const connection = new Connection(RPC_URL, COMMITMENT);
const wallet = keypairFromPrivateKey(PRIVATE_KEY);

main().catch((err) => {
  console.error('\nadd-liquidity failed:', err.message);
  if (err.logs) {
    console.error('\nProgram logs:');
    for (const log of err.logs) console.error(log);
  }
  process.exitCode = 1;
});

async function main() {
  const quoteTokenProgram = await tokenProgramForMint(QUOTE_MINT);
  const baseTokenProgram = await tokenProgramForMint(BASE_MINT);
  const poolInfo = await resolvePool();
  const lpTokenProgram = await tokenProgramForMint(poolInfo.lpMint);

  const userBaseAta = getAssociatedTokenAddressSync(BASE_MINT, wallet.publicKey, false, baseTokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
  const userQuoteAta = getAssociatedTokenAddressSync(QUOTE_MINT, wallet.publicKey, false, quoteTokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
  const userLpAta = getAssociatedTokenAddressSync(poolInfo.lpMint, wallet.publicKey, false, lpTokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID);

  const baseBalanceRaw = await getTokenBalanceRaw(userBaseAta);
  const quoteAtaBalanceRaw = await getTokenBalanceRaw(userQuoteAta);
  const nativeSolRaw = IS_NATIVE_SOL_QUOTE ? await getSpendableSolLamports(wallet.publicKey) : 0n;
  const quoteBalanceRaw = quoteAtaBalanceRaw > 0n ? quoteAtaBalanceRaw : nativeSolRaw;
  const poolBaseReserveRaw = await getTokenBalanceRaw(poolInfo.poolBaseVlt);
  const poolQuoteReserveRaw = await getTokenBalanceRaw(poolInfo.poolQuoteVlt);
  const lpSupplyRaw = await getMintSupplyRaw(poolInfo.lpMint);
  const lpBasisRaw = resolveAmountRaw('--lp-basis-raw', 'PUMP_AMM_LP_BASIS_RAW', 4447855000000n);
  const inputBufferBps = BigInt(process.env.LP_INPUT_BUFFER_BPS || Math.max(Number(process.env.SWAP_SLIPPAGE_BPS || 100), 1000));

  const requestedQuoteRaw = resolveAmountRaw('--quote-in-raw', 'ADDLIQ_QUOTE_IN_RAW', 0n);
  let lpTokensOut = resolveAmountRaw('--lp-tokens-out-raw', 'ADDLIQ_LP_TOKENS_OUT_RAW', 0n);
  if (lpTokensOut === 0n) {
    const quoteForTarget = requestedQuoteRaw > 0n ? requestedQuoteRaw : quoteBalanceRaw;
    const lpFromQuote = (quoteForTarget * lpBasisRaw) / poolQuoteReserveRaw;
    const lpFromBase = baseBalanceRaw > 0n ? (baseBalanceRaw * lpBasisRaw) / poolBaseReserveRaw : 0n;
    lpTokensOut = lpFromBase > 0n && lpFromBase < lpFromQuote ? lpFromBase : lpFromQuote;
  }

  const neededBaseRaw = (lpTokensOut * poolBaseReserveRaw) / lpBasisRaw;
  const neededQuoteRaw = (lpTokensOut * poolQuoteReserveRaw) / lpBasisRaw;
  const defaultMaxBaseIn = ((neededBaseRaw * (10000n + inputBufferBps)) / 10000n) + 1n;
  const defaultMaxQuoteIn = ((neededQuoteRaw * (10000n + inputBufferBps)) / 10000n) + 1n;
  const maxBaseIn = resolveAmountRaw('--max-base-in-raw', 'ADDLIQ_MAX_BASE_IN_RAW', defaultMaxBaseIn);
  const maxQuoteIn = resolveAmountRaw('--max-quote-in-raw', 'ADDLIQ_MAX_QUOTE_IN_RAW', defaultMaxQuoteIn);

  console.log('Mode:', SEND ? 'SEND' : 'SIMULATE');
  console.log('Wallet:', wallet.publicKey.toBase58());
  console.log('Base mint:', BASE_MINT.toBase58());
  console.log('Quote mint:', QUOTE_MINT.toBase58());
  console.log('Pool:', poolInfo.pool.toBase58());
  console.log('Pool creator:', poolInfo.creator.toBase58());
  console.log('Pool index:', String(poolInfo.index));
  console.log('LP mint:', poolInfo.lpMint.toBase58());
  console.log('User base ATA:', userBaseAta.toBase58());
  console.log('User quote ATA:', userQuoteAta.toBase58());
  console.log('User LP ATA:', userLpAta.toBase58());
  console.log('Pool base vault:', poolInfo.poolBaseVlt.toBase58());
  console.log('Pool quote vault:', poolInfo.poolQuoteVlt.toBase58());
  console.log('Base balance raw:', baseBalanceRaw.toString());
  console.log('Quote ATA balance raw:', quoteAtaBalanceRaw.toString());
  console.log('Native SOL raw:', nativeSolRaw.toString());
  console.log('Pool quote reserve raw:', poolQuoteReserveRaw.toString());
  console.log('LP supply raw:', lpSupplyRaw.toString());
  console.log('LP tokens out raw:', lpTokensOut.toString());
  console.log('Needed base raw:', neededBaseRaw.toString());
  console.log('Needed quote raw:', neededQuoteRaw.toString());
  console.log('Max base in raw:', maxBaseIn.toString());
  console.log('Max quote in raw:', maxQuoteIn.toString());

  if (lpTokensOut <= 0n || maxBaseIn <= 0n || maxQuoteIn <= 0n) {
    throw new Error('Need positive LP output, base cap, and quote cap for liquidity add');
  }

  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 500_000 })
  );

  // Wrap native SOL into wSOL ATA if needed (required by Pump AMM deposit)
  if (IS_NATIVE_SOL_QUOTE && nativeSolRaw > 0n && quoteAtaBalanceRaw < maxQuoteIn) {
    const wrapAmount = maxQuoteIn - quoteAtaBalanceRaw;
    const quoteAtaInfo = await connection.getAccountInfo(userQuoteAta);
    if (!quoteAtaInfo) {
      tx.add(createAssociatedTokenAccountInstruction(wallet.publicKey, userQuoteAta, wallet.publicKey, QUOTE_MINT, quoteTokenProgram));
    }
    assertSafeLamports(wrapAmount, 'wrapAmount');
    tx.add(
      SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: userQuoteAta, lamports: Number(wrapAmount) }),
      createSyncNativeInstruction(userQuoteAta, quoteTokenProgram)
    );
  }

  const userLpAtaInfo = await connection.getAccountInfo(userLpAta);
  if (!userLpAtaInfo) {
    tx.add(createAssociatedTokenAccountInstruction(wallet.publicKey, userLpAta, wallet.publicKey, poolInfo.lpMint, lpTokenProgram));
  }

  const data = Buffer.concat([
    Buffer.from([242, 35, 198, 137, 82, 225, 242, 182]),
    encodeU64LE(lpTokensOut),
    encodeU64LE(maxBaseIn),
    encodeU64LE(maxQuoteIn),
  ]);

  tx.add(new TransactionInstruction({
    programId: PUMP_AMM,
    keys: [
      { pubkey: poolInfo.pool, isSigner: false, isWritable: true },
      { pubkey: poolInfo.globalCfg, isSigner: false, isWritable: false },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: BASE_MINT, isSigner: false, isWritable: false },
      { pubkey: QUOTE_MINT, isSigner: false, isWritable: false },
      { pubkey: poolInfo.lpMint, isSigner: false, isWritable: true },
      { pubkey: userBaseAta, isSigner: false, isWritable: true },
      { pubkey: userQuoteAta, isSigner: false, isWritable: true },
      { pubkey: userLpAta, isSigner: false, isWritable: true },
      { pubkey: poolInfo.poolBaseVlt, isSigner: false, isWritable: true },
      { pubkey: poolInfo.poolQuoteVlt, isSigner: false, isWritable: true },
      { pubkey: quoteTokenProgram, isSigner: false, isWritable: false },
      { pubkey: baseTokenProgram, isSigner: false, isWritable: false },
      { pubkey: new PublicKey('GS4CU59F31iL7aR2Q8zVS8DRrcRnXX1yjQ66TqNVQnaR'), isSigner: false, isWritable: false },
      { pubkey: PUMP_AMM, isSigner: false, isWritable: false },
    ],
    data,
  }));

  // Close wSOL ATA after deposit so any remaining SOL returns to native balance
  if (IS_NATIVE_SOL_QUOTE) {
    tx.add(createCloseAccountInstruction(userQuoteAta, wallet.publicKey, wallet.publicKey, [], quoteTokenProgram));
  }

  const latest = await connection.getLatestBlockhash(COMMITMENT);
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = latest.blockhash;
  tx.sign(wallet);

  const sim = await connection.simulateTransaction(tx, [wallet]);
  console.log('\nSimulation result:', JSON.stringify(sim.value.err || null));
  if (sim.value.logs?.length) {
    console.log('\nSimulation logs:');
    for (const log of sim.value.logs) console.log(log);
  }
  if (sim.value.err) {
    const err = new Error('Simulation failed; not sending transaction.');
    err.logs = sim.value.logs || [];
    throw err;
  }

  if (!SEND) {
    console.log('\nSimulation passed. Rerun with --send to submit the add-liquidity transaction.');
    return;
  }

  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 5 });
  await connection.confirmTransaction({ signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, COMMITMENT);
  console.log('\nAdd liquidity signature:', sig);
  console.log('Solscan: https://solscan.io/tx/' + sig);
}

async function resolvePool() {
  const BASE_MINT_OFFSET = 43;
  const accounts = await connection.getProgramAccounts(PUMP_AMM, {
    filters: [{ memcmp: { offset: BASE_MINT_OFFSET, bytes: BASE_MINT.toBase58() } }],
  });

  let best = null;
  for (const account of accounts) {
    const d = account.account.data;
    const quoteMint = new PublicKey(d.subarray(75, 107));
    if (!quoteMint.equals(QUOTE_MINT)) continue;
    const candidate = {
      pool: account.pubkey,
      index: d.readUInt16LE(9),
      creator: new PublicKey(d.subarray(11, 43)),
      baseMint: new PublicKey(d.subarray(43, 75)),
      quoteMint,
      lpMint: new PublicKey(d.subarray(107, 139)),
      poolBaseVlt: new PublicKey(d.subarray(139, 171)),
      poolQuoteVlt: new PublicKey(d.subarray(171, 203)),
      globalCfg: PublicKey.findProgramAddressSync([Buffer.from('global_config')], PUMP_AMM)[0],
    };
    const quoteReserves = await getTokenBalanceRaw(candidate.poolQuoteVlt);
    candidate.quoteReserves = quoteReserves;
    if (!best || quoteReserves > best.quoteReserves) best = candidate;
  }

  if (!best) {
    throw new Error(`No Pump AMM pool found on-chain for base mint ${BASE_MINT.toBase58()} and quote mint ${QUOTE_MINT.toBase58()}`);
  }
  return best;
}

function keypairFromPrivateKey(pk) {
  const trimmed = String(pk).trim();
  if (trimmed.startsWith('[')) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(trimmed)));
  return Keypair.fromSecretKey(bs58.decode(trimmed));
}

async function tokenProgramForMint(mint) {
  const info = await connection.getAccountInfo(mint);
  if (!info) throw new Error(`Mint not found: ${mint.toBase58()}`);
  if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  throw new Error(`Unsupported mint owner: ${info.owner.toBase58()}`);
}

async function getTokenBalanceRaw(ata) {
  const balance = await connection.getTokenAccountBalance(ata).catch(() => null);
  return BigInt(balance?.value?.amount || '0');
}

async function getMintSupplyRaw(mint) {
  const supply = await connection.getTokenSupply(mint, COMMITMENT);
  return BigInt(supply.value.amount || '0');
}

async function getSpendableSolLamports(pubkey) {
  const lamports = BigInt(await connection.getBalance(pubkey, COMMITMENT));
  return lamports > SOL_WRAP_RESERVE_LAMPORTS ? lamports - SOL_WRAP_RESERVE_LAMPORTS : 0n;
}

function resolveAmountRaw(flagName, envName, fallbackValue) {
  const flagValue = argValue(flagName);
  const envValue = process.env[envName];
  const raw = flagValue || envValue;
  if (!raw) return BigInt(fallbackValue || 0n);
  if (!/^\d+$/.test(String(raw))) throw new Error(`Expected integer raw amount for ${flagName}/${envName}, got: ${raw}`);
  return BigInt(raw);
}

function encodeU64LE(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

function bigintSqrt(value) {
  value = BigInt(value);
  if (value < 0n) throw new Error('bigintSqrt only supports non-negative values');
  if (value < 2n) return value;
  let x0 = value;
  let x1 = (x0 + value / x0) >> 1n;
  while (x1 < x0) {
    x0 = x1;
    x1 = (x0 + value / x0) >> 1n;
  }
  return x0;
}

function assertSafeLamports(value, label) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} too large for JS number conversion: ${value.toString()}`);
  }
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const raw = trimmed.slice(eq + 1).trim();
    const value = raw.replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}
