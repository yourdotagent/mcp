const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bs58Module = require('bs58');
const {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} = require('@solana/web3.js');
const {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} = require('@solana/spl-token');
const { recordAirdropRows } = require('./record-airdrop-ledger.cjs');

const bs58 = bs58Module.default || bs58Module;

loadDotEnv(path.join(__dirname, '.env'));
loadDotEnv(path.join(__dirname, '..', '.env'));
loadDotEnv(path.join(process.cwd(), '.env'));
loadDotEnv(path.join(process.cwd(), 'ops', 'pump', '.env'));

const RPC_URL = requiredEnv('RPC_URL');
const PRIVATE_KEY = requiredEnv('PRIVATE_KEY');
const HOLDER_MINT = new PublicKey(argValue('--holder-mint') || requiredEnv('PROJECT_TOKEN_MINT'));
const AIRDROP_MINT = new PublicKey(argValue('--airdrop-mint') || requiredEnv('PROJECT_TOKEN_MINT'));
const RECIPIENT_COUNT = Number(argValue('--count') || process.env.AIRDROP_RECIPIENT_COUNT || 25);
const BATCH_SIZE = Number(argValue('--batch-size') || process.env.AIRDROP_BATCH_SIZE || 4);
const MIN_HOLDER_BALANCE_UI = Number(argValue('--min-ui') || process.env.MIN_HOLDER_BALANCE || 100000);
const SEND = process.argv.includes('--send');

const connection = new Connection(RPC_URL, 'confirmed');
const sender = keypairFromPrivateKey(PRIVATE_KEY);

main().catch((err) => {
  console.error('\nairdrop-random-holders failed:', err.message);
  if (err.logs) {
    console.error('\nProgram logs:');
    for (const log of err.logs) console.error(log);
  }
  process.exitCode = 1;
});

async function main() {
  const holderTokenProgram = await tokenProgramForMint(HOLDER_MINT);
  const airdropTokenProgram = await tokenProgramForMint(AIRDROP_MINT);
  const holderDecimals = await mintDecimals(HOLDER_MINT);
  const airdropDecimals = await mintDecimals(AIRDROP_MINT);
  const minHolderRaw = uiToRaw(MIN_HOLDER_BALANCE_UI, holderDecimals);
  const senderAta = getAssociatedTokenAddressSync(
    AIRDROP_MINT,
    sender.publicKey,
    false,
    airdropTokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const senderBalance = await getTokenBalanceRaw(senderAta);

  console.log('Mode:', SEND ? 'SEND' : 'SIMULATE');
  console.log('Sender:', sender.publicKey.toBase58());
  console.log('Holder mint:', HOLDER_MINT.toBase58());
  console.log('Airdrop mint:', AIRDROP_MINT.toBase58());
  console.log('Sender airdrop ATA:', senderAta.toBase58());
  console.log('Sender airdrop balance:', formatTokenAmount(senderBalance, airdropDecimals), `(${senderBalance} raw)`);
  console.log('Min holder balance:', MIN_HOLDER_BALANCE_UI, `(${minHolderRaw} raw)`);
  console.log('Recipient count:', RECIPIENT_COUNT);
  console.log('Batch size:', BATCH_SIZE);

  if (senderBalance <= 0n) throw new Error('No airdrop token balance to distribute');

  const holders = await fetchTokenHolders({
    mint: HOLDER_MINT,
    tokenProgram: holderTokenProgram,
    minRaw: minHolderRaw,
    excludeOwner: sender.publicKey,
  });

  console.log('Eligible holders:', holders.length);

  // If not enough holders, just skip gracefully instead of throwing
  const actualCount = Math.min(RECIPIENT_COUNT, holders.length);
  if (actualCount === 0) {
    console.log('No eligible holders found, skipping airdrop.');
    return;
  }

  const recipients = shuffle(holders).slice(0, actualCount);

  // Support fixed per-holder amount via AIRDROP_AMOUNT_UI env, otherwise split evenly
  const AIRDROP_AMOUNT_UI = Number(process.env.AIRDROP_AMOUNT_UI || 0);
  let plannedDrops;
  if (AIRDROP_AMOUNT_UI > 0) {
    const perRecipientRaw = uiToRaw(AIRDROP_AMOUNT_UI, airdropDecimals);
    const totalNeeded = perRecipientRaw * BigInt(recipients.length);
    if (senderBalance < totalNeeded) {
      console.log(`Insufficient balance for fixed airdrop: need ${totalNeeded}, have ${senderBalance}. Skipping.`);
      return;
    }
    plannedDrops = recipients.map((r, index) => ({
      ...r,
      index,
      amountRaw: perRecipientRaw,
      recipientAta: getAssociatedTokenAddressSync(
        AIRDROP_MINT, r.wallet, false, airdropTokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID
      ),
    }));
  } else {
    plannedDrops = splitEvenly(senderBalance, recipients).map((drop, index) => ({
      ...drop,
      index,
      recipientAta: getAssociatedTokenAddressSync(
        AIRDROP_MINT, drop.wallet, false, airdropTokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID
      ),
    }));
  }

  console.log('\nSelected recipients:');
  for (const drop of plannedDrops) {
    console.log(`${drop.index + 1}. ${drop.wallet.toBase58()} holder=${formatTokenAmount(drop.holderBalance, holderDecimals)} drop=${formatTokenAmount(drop.amountRaw, airdropDecimals)}`);
  }

  const batches = chunk(plannedDrops, BATCH_SIZE);
  const runId = `airdrop_${new Date().toISOString().replace(/[-:.TZ]/g, '')}_${crypto.randomUUID().slice(0, 8)}`;
  const ledgerRows = [];

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
    const tx = buildBatchTransaction({
      batch,
      senderAta,
      mint: AIRDROP_MINT,
      tokenProgram: airdropTokenProgram,
      decimals: airdropDecimals,
    });

    const latest = await connection.getLatestBlockhash('confirmed');
    tx.feePayer = sender.publicKey;
    tx.recentBlockhash = latest.blockhash;
    tx.sign(sender);

    const sim = await connection.simulateTransaction(tx, [sender]);
    console.log(`\nBatch ${batchIndex + 1}/${batches.length} simulation:`, JSON.stringify(sim.value.err || null));
    if (sim.value.err) {
      const err = new Error(`Batch ${batchIndex + 1} simulation failed; not sending.`);
      err.logs = sim.value.logs || [];
      throw err;
    }

    if (!SEND) continue;

    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 5,
    });
    await connection.confirmTransaction({
      signature: sig,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    }, 'confirmed');

    console.log(`Batch ${batchIndex + 1} signature: ${sig}`);
    for (const drop of batch) {
      ledgerRows.push({
        run_id: runId,
        recipient_wallet: drop.wallet.toBase58(),
        holder_balance: formatTokenAmount(drop.holderBalance, holderDecimals),
        token_mint: AIRDROP_MINT.toBase58(),
        token_symbol: process.env.PROJECT_TOKEN_SYMBOL || 'TOKEN',
        amount_raw: drop.amountRaw.toString(),
        amount_display: formatTokenAmount(drop.amountRaw, airdropDecimals),
        tx_signature: sig,
        solscan_url: `https://solscan.io/tx/${sig}`,
        status: 'confirmed',
      });
    }
  }

  if (!SEND) {
    console.log('\nAll batches simulated cleanly. Rerun with --send to submit the airdrop.');
    return;
  }

  await recordAirdropRows(ledgerRows);
  console.log(`\nAirdrop complete. Run id: ${runId}`);
  console.log(`Ledger rows written: ${ledgerRows.length}`);
}

function buildBatchTransaction({ batch, senderAta, mint, tokenProgram, decimals }) {
  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 500_000 })
  );

  for (const drop of batch) {
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        sender.publicKey,
        drop.recipientAta,
        drop.wallet,
        mint,
        tokenProgram,
        ASSOCIATED_TOKEN_PROGRAM_ID
      ),
      createTransferCheckedInstruction(
        senderAta,
        mint,
        drop.recipientAta,
        sender.publicKey,
        drop.amountRaw,
        decimals,
        [],
        tokenProgram
      )
    );
  }

  return tx;
}

async function fetchTokenHolders({ mint, tokenProgram, minRaw, excludeOwner }) {
  const accounts = await connection.getProgramAccounts(tokenProgram, {
    filters: [
      {
        memcmp: {
          offset: 0,
          bytes: mint.toBase58(),
        },
      },
    ],
  });

  const byOwner = new Map();
  for (const account of accounts) {
    if (account.account.data.length < 72) continue;
    const owner = new PublicKey(account.account.data.subarray(32, 64));
    if (owner.equals(excludeOwner)) continue;
    if (!PublicKey.isOnCurve(owner.toBuffer())) continue;

    const amount = account.account.data.readBigUInt64LE(64);
    if (amount < minRaw) continue;

    const key = owner.toBase58();
    const current = byOwner.get(key) || 0n;
    byOwner.set(key, current + amount);
  }

  return [...byOwner.entries()].map(([wallet, balance]) => ({
    wallet: new PublicKey(wallet),
    holderBalance: balance,
  }));
}

function splitEvenly(totalRaw, recipients) {
  const count = BigInt(recipients.length);
  const base = totalRaw / count;
  let remainder = totalRaw % count;

  return recipients.map((recipient) => {
    const extra = remainder > 0n ? 1n : 0n;
    if (remainder > 0n) remainder -= 1n;
    return {
      ...recipient,
      amountRaw: base + extra,
    };
  });
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
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

function uiToRaw(uiAmount, decimals) {
  const [whole, fraction = ''] = String(uiAmount).split('.');
  const padded = `${fraction}${'0'.repeat(decimals)}`.slice(0, decimals);
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(padded || '0');
}

function keypairFromPrivateKey(pk) {
  const trimmed = pk.trim();
  if (trimmed.startsWith('[')) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(trimmed)));
  }
  return Keypair.fromSecretKey(bs58.decode(trimmed));
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
