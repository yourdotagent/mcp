const fs = require('fs');
const path = require('path');
const bs58Module = require('bs58');
const {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
} = require('@solana/web3.js');
const {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} = require('@solana/spl-token');

const bs58 = bs58Module.default || bs58Module;
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const SOL_RESERVE_LAMPORTS = BigInt(process.env.SWAP_SOL_RESERVE_LAMPORTS || '5000000');
const SOL_SWAP_OVERHEAD_LAMPORTS = BigInt(process.env.SWAP_SOL_OVERHEAD_LAMPORTS || '2000000');

loadDotEnv(path.join(__dirname, '.env'));
loadDotEnv(path.join(__dirname, '..', '.env'));
loadDotEnv(path.join(process.cwd(), '.env'));
loadDotEnv(path.join(process.cwd(), 'ops', 'pump', '.env'));

const RPC_URL = requiredEnv('RPC_URL');
const PRIVATE_KEY = requiredEnv('PRIVATE_KEY');
const INPUT_MINT = new PublicKey(argValue('--input-mint') || process.env.SWAP_INPUT_MINT || process.env.CLAIM_QUOTE_MINT || WSOL_MINT);
const TARGET_MINT = new PublicKey(argValue('--output-mint') || process.env.SWAP_OUTPUT_MINT || requiredEnv('PROJECT_TOKEN_MINT'));
const JUPITER_SWAP_API_BASE = (process.env.JUPITER_SWAP_API_BASE || 'https://lite-api.jup.ag/swap/v1').replace(/\/$/, '');
const JUPITER_API_KEY = process.env.JUPITER_API_KEY || '';
const SLIPPAGE_BPS = Number(process.env.SWAP_SLIPPAGE_BPS || 100);
const SEND = process.argv.includes('--send');
const ALL = process.argv.includes('--all');

const connection = new Connection(RPC_URL, 'confirmed');
const wallet = keypairFromPrivateKey(PRIVATE_KEY);

main().catch((err) => {
  console.error('\nbuy-target-token failed:', err.message);
  if (err.logs) {
    console.error('\nProgram logs:');
    for (const log of err.logs) console.error(log);
  }
  process.exitCode = 1;
});

async function main() {
  const inputUsesNativeSol = INPUT_MINT.toBase58() === WSOL_MINT;
  const inputTokenProgram = await tokenProgramForMint(INPUT_MINT);
  const outputTokenProgram = await tokenProgramForMint(TARGET_MINT);
  const inputDecimals = inputUsesNativeSol ? 9 : await mintDecimals(INPUT_MINT);
  const outputDecimals = await mintDecimals(TARGET_MINT);
  const inputAta = getAssociatedTokenAddressSync(INPUT_MINT, wallet.publicKey, false, inputTokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
  const targetAta = getAssociatedTokenAddressSync(TARGET_MINT, wallet.publicKey, false, outputTokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID);

  const inputBalanceRaw = inputUsesNativeSol
    ? await getSpendableSolLamports(wallet.publicKey)
    : await getTokenBalanceRaw(inputAta);
  const amountRaw = resolveAmountRaw(inputBalanceRaw);

  console.log('Mode:', SEND ? 'SEND' : 'SIMULATE');
  console.log('Wallet:', wallet.publicKey.toBase58());
  console.log('Input mint:', INPUT_MINT.toBase58());
  console.log('Input uses native SOL:', inputUsesNativeSol);
  console.log('Input ATA:', inputAta.toBase58());
  console.log('Input balance:', formatTokenAmount(inputBalanceRaw, inputDecimals));
  console.log('Target mint:', TARGET_MINT.toBase58());
  console.log('Target ATA:', targetAta.toBase58());
  console.log('Swap amount:', formatTokenAmount(amountRaw, inputDecimals), `(${amountRaw} raw)`);
  console.log('Slippage bps:', SLIPPAGE_BPS);

  if (amountRaw <= 0n) throw new Error('Swap amount must be greater than zero');
  if (amountRaw > inputBalanceRaw) {
    throw new Error(`Insufficient input balance: need ${amountRaw}, have ${inputBalanceRaw}`);
  }

  const quote = await fetchQuote({ inputMint: INPUT_MINT, outputMint: TARGET_MINT, amountRaw, slippageBps: SLIPPAGE_BPS });

  console.log('\nQuote:');
  console.log('Route count:', quote.routePlan?.length || 0);
  console.log('Expected out:', formatTokenAmount(BigInt(quote.outAmount), outputDecimals), `(${quote.outAmount} raw)`);
  console.log('Minimum out:', formatTokenAmount(BigInt(quote.otherAmountThreshold), outputDecimals), `(${quote.otherAmountThreshold} raw)`);
  console.log('Price impact pct:', quote.priceImpactPct);
  if (quote.routePlan?.length) {
    console.log('Route:', quote.routePlan.map((step) => step.swapInfo?.label || step.swapInfo?.ammKey || 'unknown').join(' -> '));
  }

  const swap = await fetchSwapTransaction(quote);
  const tx = VersionedTransaction.deserialize(Buffer.from(swap.swapTransaction, 'base64'));
  tx.sign([wallet]);

  const sim = await connection.simulateTransaction(tx, {
    commitment: 'confirmed',
    replaceRecentBlockhash: false,
    sigVerify: true,
  });

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
    console.log('\nSimulation passed. Rerun with --send to submit the swap.');
    return;
  }

  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 5,
  });

  if (swap.lastValidBlockHeight) {
    await connection.confirmTransaction({
      signature: sig,
      blockhash: tx.message.recentBlockhash,
      lastValidBlockHeight: swap.lastValidBlockHeight,
    }, 'confirmed');
  } else {
    await connection.confirmTransaction(sig, 'confirmed');
  }

  console.log('\nSwap signature:', sig);
  console.log('Solscan:', `https://solscan.io/tx/${sig}`);
}

async function fetchQuote({ inputMint, outputMint, amountRaw, slippageBps }) {
  const params = new URLSearchParams({
    inputMint: inputMint.toBase58(),
    outputMint: outputMint.toBase58(),
    amount: amountRaw.toString(),
    slippageBps: String(slippageBps),
  });
  if (process.env.JUPITER_DEXES) params.set('dexes', process.env.JUPITER_DEXES);
  const res = await fetch(`${JUPITER_SWAP_API_BASE}/quote?${params.toString()}`, { headers: jupiterHeaders() });
  if (!res.ok) throw new Error(`Jupiter quote failed: ${res.status} ${await res.text()}`);
  const quote = await res.json();
  if (!quote.outAmount) throw new Error(`Jupiter returned no route: ${JSON.stringify(quote)}`);
  return quote;
}

async function fetchSwapTransaction(quoteResponse) {
  const res = await fetch(`${JUPITER_SWAP_API_BASE}/swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...jupiterHeaders() },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey: wallet.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: {
        priorityLevelWithMaxLamports: { maxLamports: 100000, priorityLevel: 'medium' },
      },
    }),
  });
  if (!res.ok) throw new Error(`Jupiter swap build failed: ${res.status} ${await res.text()}`);
  const swap = await res.json();
  if (!swap.swapTransaction) throw new Error(`Jupiter returned no swap transaction: ${JSON.stringify(swap)}`);
  return swap;
}

function resolveAmountRaw(balanceRaw) {
  const rawArg = argValue('--amount-raw');
  if (rawArg) return BigInt(rawArg);
  if (ALL) return balanceRaw;
  if (process.env.SWAP_AMOUNT_RAW) return BigInt(process.env.SWAP_AMOUNT_RAW);
  throw new Error('Set SWAP_AMOUNT_RAW, pass --amount-raw, or pass --all');
}

async function getSpendableSolLamports(pubkey) {
  const lamports = BigInt(await connection.getBalance(pubkey, 'confirmed'));
  const totalReserve = SOL_RESERVE_LAMPORTS + SOL_SWAP_OVERHEAD_LAMPORTS;
  return lamports > totalReserve ? lamports - totalReserve : 0n;
}

async function getTokenBalanceRaw(ata) {
  const balance = await connection.getTokenAccountBalance(ata).catch(() => null);
  return BigInt(balance?.value?.amount || '0');
}

async function tokenProgramForMint(mint) {
  const info = await connection.getAccountInfo(mint);
  if (!info) throw new Error(`Mint not found: ${mint.toBase58()}`);
  if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  throw new Error(`Unsupported mint owner: ${info.owner.toBase58()}`);
}

async function mintDecimals(mint) {
  const parsed = await connection.getParsedAccountInfo(mint);
  const decimals = parsed.value?.data?.parsed?.info?.decimals;
  if (typeof decimals !== 'number') throw new Error(`Unable to read mint decimals: ${mint.toBase58()}`);
  return decimals;
}

function keypairFromPrivateKey(pk) {
  const trimmed = pk.trim();
  if (trimmed.startsWith('[')) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(trimmed)));
  return Keypair.fromSecretKey(bs58.decode(trimmed));
}

function jupiterHeaders() {
  return JUPITER_API_KEY ? { 'x-api-key': JUPITER_API_KEY } : {};
}

function formatTokenAmount(raw, decimals) {
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const fraction = raw % base;
  const fractionText = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
  return fractionText ? `${whole}.${fractionText}` : whole.toString();
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}
