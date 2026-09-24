const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bs58Module = require('bs58');
const {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} = require('@solana/web3.js');
const {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createCloseAccountInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} = require('@solana/spl-token');
const { recordDevTransaction } = require('./record-dev-transaction.cjs');

const bs58 = bs58Module.default || bs58Module;

loadDotEnv(path.join(__dirname, '.env'));
loadDotEnv(path.join(__dirname, '..', '.env'));
loadDotEnv(path.join(process.cwd(), '.env'));
loadDotEnv(path.join(process.cwd(), 'ops', 'pump', '.env'));

const RPC_URL = requiredEnv('RPC_URL');
const PRIVATE_KEY = requiredEnv('PRIVATE_KEY');
const TEST_COIN_MINT = new PublicKey(requiredEnv('PROJECT_TOKEN_MINT'));
const CLAIM_QUOTE_MINT = new PublicKey(process.env.CLAIM_QUOTE_MINT || 'So11111111111111111111111111111111111111112');
const COMMITMENT = 'confirmed';
const SEND = process.argv.includes('--send');
const MODE = getModeArg() || process.env.CLAIM_MODE || 'auto';

const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const PUMP_AMM_PROGRAM = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const PUMP_GLOBAL = new PublicKey('4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf');
const SYSTEM_PROGRAM = SystemProgram.programId;
const PUMP_EVENT_AUTHORITY = new PublicKey('Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1');
const TOKEN_METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
const PUMP_AMM_EVENT_AUTHORITY = new PublicKey('Hh9QcjF14D7QYmTsdzuZJfKHzsTn4xupHzybG8JXifLW');
const PFEE_PROGRAM = new PublicKey('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ');
const GLOBAL_VOLUME_ACCUMULATOR = new PublicKey('GS4CU59F31iL7aR2Q8zVS8DRrcRnXX1yjQ66TqNVQnaR');

const connection = new Connection(RPC_URL, COMMITMENT);
const wallet = keypairFromPrivateKey(PRIVATE_KEY);

async function main() {
  console.log('Mode:', SEND ? 'SEND' : 'DRY RUN');
  console.log('Claim path:', MODE);
  console.log('Creator wallet:', wallet.publicKey.toBase58());
  console.log('Creator SOL:', lamportsToSol(await connection.getBalance(wallet.publicKey)));

  const creatorVault = deriveCreatorVaultPda(wallet.publicKey);
  const creatorVaultSolBefore = await connection.getBalance(creatorVault).catch(() => 0);
  console.log('Creator vault:', creatorVault.toBase58());
  console.log('Creator vault SOL:', lamportsToSol(creatorVaultSolBefore));

  const quoteProgram = await tokenProgramForMint(CLAIM_QUOTE_MINT);
  const creatorVaultQuoteAta = getAssociatedTokenAddressSync(CLAIM_QUOTE_MINT, creatorVault, true, quoteProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
  const creatorVaultQuoteBefore = await getTokenBalanceRaw(creatorVaultQuoteAta);
  console.log('Creator vault quote ATA:', creatorVaultQuoteAta.toBase58());
  console.log('Creator vault quote raw:', creatorVaultQuoteBefore.toString());
  console.log('AMM quote mint:', CLAIM_QUOTE_MINT.toBase58());
  console.log('AMM quote token program:', quoteProgram.toBase58());

  const ammCreatorVaultAuthority = deriveCreatorVaultAuthorityPda(wallet.publicKey);
  const ammCreatorVaultQuoteAta = getAssociatedTokenAddressSync(CLAIM_QUOTE_MINT, ammCreatorVaultAuthority, true, quoteProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
  const ammCreatorVaultQuoteBefore = await getTokenBalanceRaw(ammCreatorVaultQuoteAta);
  console.log('AMM creator vault authority:', ammCreatorVaultAuthority.toBase58());
  console.log('AMM creator vault quote ATA:', ammCreatorVaultQuoteAta.toBase58());
  console.log('AMM creator vault quote raw:', ammCreatorVaultQuoteBefore.toString());

  const creatorQuoteAta = getAssociatedTokenAddressSync(CLAIM_QUOTE_MINT, wallet.publicKey, false, quoteProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
  const creatorQuoteBefore = await getTokenBalanceRaw(creatorQuoteAta);
  console.log('Creator quote ATA:', creatorQuoteAta.toBase58());
  console.log('Creator quote raw:', creatorQuoteBefore.toString());

  const sharingConfig = deriveCreatorFeeSharingConfig(TEST_COIN_MINT);
  const sharingConfigInfo = await connection.getAccountInfo(sharingConfig);
  console.log('Sharing config:', sharingConfig.toBase58());
  console.log('Sharing config exists:', Boolean(sharingConfigInfo));

  const sharingPumpCreatorVault = sharingConfigInfo ? deriveSharingPumpVault(sharingConfig) : null;
  const sharingPumpCreatorVaultSolBefore = sharingPumpCreatorVault ? await connection.getBalance(sharingPumpCreatorVault).catch(() => 0) : 0;
  const sharingPumpCreatorVaultQuoteAta = sharingPumpCreatorVault ? getAssociatedTokenAddressSync(CLAIM_QUOTE_MINT, sharingPumpCreatorVault, true, quoteProgram, ASSOCIATED_TOKEN_PROGRAM_ID) : null;
  const sharingPumpCreatorVaultQuoteBefore = sharingPumpCreatorVaultQuoteAta ? await getTokenBalanceRaw(sharingPumpCreatorVaultQuoteAta) : 0n;
  console.log('Sharing Pump creator vault:', sharingPumpCreatorVault ? sharingPumpCreatorVault.toBase58() : 'n/a');
  console.log('Sharing Pump creator vault SOL:', lamportsToSol(sharingPumpCreatorVaultSolBefore));
  console.log('Sharing Pump creator vault quote ATA:', sharingPumpCreatorVaultQuoteAta ? sharingPumpCreatorVaultQuoteAta.toBase58() : 'n/a');
  console.log('Sharing Pump creator vault quote raw:', sharingPumpCreatorVaultQuoteBefore.toString());

  const sharingAmmCreatorVaultAuthority = sharingConfigInfo ? deriveSharingAmmVaultAuthority(sharingConfig) : null;
  const sharingAmmCreatorVaultQuoteAta = sharingAmmCreatorVaultAuthority ? getAssociatedTokenAddressSync(CLAIM_QUOTE_MINT, sharingAmmCreatorVaultAuthority, true, quoteProgram, ASSOCIATED_TOKEN_PROGRAM_ID) : null;
  const sharingAmmCreatorVaultQuoteBefore = sharingAmmCreatorVaultQuoteAta ? await getTokenBalanceRaw(sharingAmmCreatorVaultQuoteAta) : 0n;
  console.log('Sharing AMM creator vault authority:', sharingAmmCreatorVaultAuthority ? sharingAmmCreatorVaultAuthority.toBase58() : 'n/a');
  console.log('Sharing AMM creator vault quote ATA:', sharingAmmCreatorVaultQuoteAta ? sharingAmmCreatorVaultQuoteAta.toBase58() : 'n/a');
  console.log('Sharing AMM creator vault quote raw:', sharingAmmCreatorVaultQuoteBefore.toString());

  const testCoinBondingCurve = deriveBondingCurve(TEST_COIN_MINT);
  const bondingCurveInfo = await connection.getParsedAccountInfo(testCoinBondingCurve);
  const parsedCreator = parseCreatorFromBondingCurve(bondingCurveInfo.value?.data);
  console.log('Test coin mint:', TEST_COIN_MINT.toBase58());
  console.log('Bonding curve:', testCoinBondingCurve.toBase58());
  console.log('Parsed creator:', parsedCreator ? parsedCreator.toBase58() : 'n/a');
  console.log('Wallet matches parsed creator:', Boolean(parsedCreator?.equals(wallet.publicKey)));

  const plan = selectClaimPlan({
    creatorVaultSolBefore,
    creatorVaultQuoteBefore,
    ammCreatorVaultQuoteBefore,
    sharingConfigExists: Boolean(sharingConfigInfo),
    sharingPumpCreatorVaultSolBefore,
    sharingPumpCreatorVaultQuoteBefore,
    sharingAmmCreatorVaultQuoteBefore,
  });

  if (!plan.length) {
    console.log('Nothing claimable — no claim instruction selected.');
    return;
  }

  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200_000 }),
  );

  const needsCreatorQuoteAta = plan.some((item) => ['pump-v2', 'amm'].includes(item.label));
  if (needsCreatorQuoteAta) {
    const creatorQuoteAtaExists = creatorQuoteBefore > 0n || (await connection.getAccountInfo(creatorQuoteAta)) !== null;
    if (!creatorQuoteAtaExists) {
      tx.add(createAssociatedTokenAccountInstruction(wallet.publicKey, creatorQuoteAta, wallet.publicKey, CLAIM_QUOTE_MINT, quoteProgram, ASSOCIATED_TOKEN_PROGRAM_ID));
    }
  }

  for (const item of plan) tx.add(item.instruction);
  if (needsCreatorQuoteAta && CLAIM_QUOTE_MINT.equals(new PublicKey('So11111111111111111111111111111111111111112'))) {
    tx.add(createCloseAccountInstruction(creatorQuoteAta, wallet.publicKey, wallet.publicKey, [], quoteProgram));
  }

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(COMMITMENT);
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = blockhash;
  tx.sign(wallet);

  const simulation = await connection.simulateTransaction(tx);
  console.log('\nSimulation result:', simulation.value.err);
  if (simulation.value.logs?.length) {
    console.log('\nSimulation logs:');
    for (const line of simulation.value.logs) console.log(line);
  }

  let signature = null;
  if (simulation.value.err) {
    console.log('Simulation failed — skipping send.');
  } else if (SEND) {
    const raw = tx.serialize();
    signature = await connection.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: COMMITMENT, maxRetries: 3 });
    await connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature }, COMMITMENT);
    console.log('\nClaim signature:', signature);
    await recordDevTransaction({
      kind: 'claim',
      mint: TEST_COIN_MINT.toBase58(),
      wallet: wallet.publicKey.toBase58(),
      signature,
      metadata: { mode: MODE, steps: plan.map((p) => p.label) },
    });
  }

  const creatorVaultSolAfter = await connection.getBalance(creatorVault).catch(() => 0);
  const creatorVaultQuoteAfter = await getTokenBalanceRaw(creatorVaultQuoteAta);
  const ammCreatorVaultQuoteAfter = await getTokenBalanceRaw(ammCreatorVaultQuoteAta);
  const sharingPumpCreatorVaultSolAfter = sharingPumpCreatorVault ? await connection.getBalance(sharingPumpCreatorVault).catch(() => 0) : 0;
  const sharingPumpCreatorVaultQuoteAfter = sharingPumpCreatorVaultQuoteAta ? await getTokenBalanceRaw(sharingPumpCreatorVaultQuoteAta) : 0n;
  const sharingAmmCreatorVaultQuoteAfter = sharingAmmCreatorVaultQuoteAta ? await getTokenBalanceRaw(sharingAmmCreatorVaultQuoteAta) : 0n;

  console.log('Bonding vault SOL before:', lamportsToSol(creatorVaultSolBefore));
  console.log('Bonding vault SOL after:', lamportsToSol(creatorVaultSolAfter));
  console.log('Bonding claimed SOL estimate:', lamportsToSol(Math.max(0, creatorVaultSolBefore - creatorVaultSolAfter)));
  console.log('Pump v2 vault quote raw before:', creatorVaultQuoteBefore.toString());
  console.log('Pump v2 vault quote raw after:', creatorVaultQuoteAfter.toString());
  console.log('Pump v2 claimed quote raw estimate:', drainDelta(creatorVaultQuoteBefore, creatorVaultQuoteAfter).toString());
  console.log('AMM vault quote raw before:', ammCreatorVaultQuoteBefore.toString());
  console.log('AMM vault quote raw after:', ammCreatorVaultQuoteAfter.toString());
  console.log('AMM claimed quote raw estimate:', drainDelta(ammCreatorVaultQuoteBefore, ammCreatorVaultQuoteAfter).toString());
  if (sharingConfigInfo) {
    console.log('Sharing Pump vault SOL before:', lamportsToSol(sharingPumpCreatorVaultSolBefore));
    console.log('Sharing Pump vault SOL after:', lamportsToSol(sharingPumpCreatorVaultSolAfter));
    console.log('Sharing Pump claimed SOL estimate:', lamportsToSol(Math.max(0, sharingPumpCreatorVaultSolBefore - sharingPumpCreatorVaultSolAfter)));
    console.log('Sharing Pump vault quote raw before:', sharingPumpCreatorVaultQuoteBefore.toString());
    console.log('Sharing Pump vault quote raw after:', sharingPumpCreatorVaultQuoteAfter.toString());
    console.log('Sharing Pump claimed quote raw estimate:', drainDelta(sharingPumpCreatorVaultQuoteBefore, sharingPumpCreatorVaultQuoteAfter).toString());
    console.log('Sharing AMM vault quote raw before:', sharingAmmCreatorVaultQuoteBefore.toString());
    console.log('Sharing AMM vault quote raw after:', sharingAmmCreatorVaultQuoteAfter.toString());
    console.log('Sharing AMM claimed quote raw estimate:', drainDelta(sharingAmmCreatorVaultQuoteBefore, sharingAmmCreatorVaultQuoteAfter).toString());
  }
}

function selectClaimPlan(state) {
  const plan = [];
  if ((MODE === 'auto' || MODE === 'pump-v2') && (state.creatorVaultSolBefore > 890880 || state.creatorVaultQuoteBefore > 0n)) {
    plan.push({ label: 'pump-v2', instruction: buildPumpCreatorClaimInstruction() });
  }
  if ((MODE === 'auto' || MODE === 'amm') && state.ammCreatorVaultQuoteBefore > 0n) {
    plan.push({ label: 'amm', instruction: buildAmmCreatorClaimInstruction() });
  }
  if (state.sharingConfigExists && (MODE === 'auto' || MODE === 'redirect' || MODE === 'sharing-amm')) {
    const hasSharingPumpSol = state.sharingPumpCreatorVaultSolBefore > 890880;
    const hasSharingPumpQuote = state.sharingPumpCreatorVaultQuoteBefore > 0n;
    const hasSharingAmmQuote = state.sharingAmmCreatorVaultQuoteBefore > 0n;

    if (hasSharingAmmQuote) {
      plan.push({ label: 'redirect-transfer', instruction: buildSharingAmmCreatorClaimInstruction() });
    }
    if (hasSharingPumpSol || hasSharingPumpQuote || hasSharingAmmQuote) {
      plan.push({ label: 'redirect-distribute', instruction: buildSharingPumpCreatorClaimInstruction() });
    }
  }
  return plan;
}

function buildPumpCreatorClaimInstruction() {
  const quoteTokenProgram = tokenProgramForMintSync(CLAIM_QUOTE_MINT);
  const creatorVault = deriveCreatorVaultPda(wallet.publicKey);
  const creatorVaultQuoteAta = getAssociatedTokenAddressSync(CLAIM_QUOTE_MINT, creatorVault, true, quoteTokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
  const creatorQuoteAta = getAssociatedTokenAddressSync(CLAIM_QUOTE_MINT, wallet.publicKey, false, quoteTokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
  // collect_creator_fee_v2 accounts, matching Pump.fun current path.
  const accounts = [
    { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
    { pubkey: creatorQuoteAta, isSigner: false, isWritable: true },
    { pubkey: creatorVault, isSigner: false, isWritable: true },
    { pubkey: creatorVaultQuoteAta, isSigner: false, isWritable: true },
    { pubkey: CLAIM_QUOTE_MINT, isSigner: false, isWritable: false },
    { pubkey: quoteTokenProgram, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: PUMP_EVENT_AUTHORITY, isSigner: false, isWritable: false },
    { pubkey: PUMP_PROGRAM, isSigner: false, isWritable: false },
  ];
  return new TransactionInstruction({ programId: PUMP_PROGRAM, keys: accounts, data: anchorDiscriminator('collect_creator_fee_v2') });
}

function buildAmmCreatorClaimInstruction() {
  const creatorVaultAuthority = deriveCreatorVaultAuthorityPda(wallet.publicKey);
  const quoteTokenProgram = tokenProgramForMintSync(CLAIM_QUOTE_MINT);
  const creatorVaultQuoteAta = getAssociatedTokenAddressSync(CLAIM_QUOTE_MINT, creatorVaultAuthority, true, quoteTokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
  const creatorQuoteAta = getAssociatedTokenAddressSync(CLAIM_QUOTE_MINT, wallet.publicKey, false, quoteTokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
  const globalVolumeAccumulator = new PublicKey('GS4CU59F31iL7aR2Q8zVS8DRrcRnXX1yjQ66TqNVQnaR');
  // collect_coin_creator_fee accounts, matching Pump AMM current path.
  const accounts = [
    { pubkey: CLAIM_QUOTE_MINT, isSigner: false, isWritable: false },
    { pubkey: quoteTokenProgram, isSigner: false, isWritable: false },
    { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
    { pubkey: creatorVaultAuthority, isSigner: false, isWritable: true },
    { pubkey: creatorVaultQuoteAta, isSigner: false, isWritable: true },
    { pubkey: creatorQuoteAta, isSigner: false, isWritable: true },
    { pubkey: globalVolumeAccumulator, isSigner: false, isWritable: false },
    { pubkey: PUMP_AMM_PROGRAM, isSigner: false, isWritable: false },
  ];
  return new TransactionInstruction({ programId: PUMP_AMM_PROGRAM, keys: accounts, data: anchorDiscriminator('collect_coin_creator_fee') });
}

function buildSharingPumpCreatorClaimInstruction() {
  const sharingConfig = deriveCreatorFeeSharingConfig(TEST_COIN_MINT);
  const creatorVault = deriveSharingPumpVault(sharingConfig);
  const bondingCurve = deriveBondingCurve(TEST_COIN_MINT);
  const creatorVaultQuoteAta = getAssociatedTokenAddressSync(CLAIM_QUOTE_MINT, creatorVault, true, tokenProgramForMintSync(CLAIM_QUOTE_MINT), ASSOCIATED_TOKEN_PROGRAM_ID);
  const accounts = [
    { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
    { pubkey: TEST_COIN_MINT, isSigner: false, isWritable: false },
    { pubkey: bondingCurve, isSigner: false, isWritable: false },
    { pubkey: sharingConfig, isSigner: false, isWritable: false },
    { pubkey: creatorVault, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: PUMP_EVENT_AUTHORITY, isSigner: false, isWritable: false },
    { pubkey: PUMP_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: creatorVaultQuoteAta, isSigner: false, isWritable: true },
    { pubkey: CLAIM_QUOTE_MINT, isSigner: false, isWritable: false },
    { pubkey: tokenProgramForMintSync(CLAIM_QUOTE_MINT), isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
  ];
  return new TransactionInstruction({ programId: PUMP_PROGRAM, keys: accounts, data: Buffer.from('ffcb134ff444089f01', 'hex') });
}

function buildSharingAmmCreatorClaimInstruction() {
  const sharingConfig = deriveCreatorFeeSharingConfig(TEST_COIN_MINT);
  const creatorVaultAuthority = deriveSharingAmmVaultAuthority(sharingConfig);
  const creatorVaultQuoteAta = getAssociatedTokenAddressSync(CLAIM_QUOTE_MINT, creatorVaultAuthority, true, tokenProgramForMintSync(CLAIM_QUOTE_MINT), ASSOCIATED_TOKEN_PROGRAM_ID);
  const pumpCreatorVault = deriveSharingPumpVault(sharingConfig);
  const pumpCreatorVaultQuoteAta = getAssociatedTokenAddressSync(CLAIM_QUOTE_MINT, pumpCreatorVault, true, tokenProgramForMintSync(CLAIM_QUOTE_MINT), ASSOCIATED_TOKEN_PROGRAM_ID);
  const accounts = [
    { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
    { pubkey: CLAIM_QUOTE_MINT, isSigner: false, isWritable: false },
    { pubkey: tokenProgramForMintSync(CLAIM_QUOTE_MINT), isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: sharingConfig, isSigner: false, isWritable: false },
    { pubkey: creatorVaultAuthority, isSigner: false, isWritable: true },
    { pubkey: creatorVaultQuoteAta, isSigner: false, isWritable: true },
    { pubkey: pumpCreatorVault, isSigner: false, isWritable: true },
    { pubkey: pumpCreatorVaultQuoteAta, isSigner: false, isWritable: true },
    { pubkey: GLOBAL_VOLUME_ACCUMULATOR, isSigner: false, isWritable: false },
    { pubkey: PUMP_AMM_PROGRAM, isSigner: false, isWritable: false },
  ];
  return new TransactionInstruction({ programId: PUMP_AMM_PROGRAM, keys: accounts, data: Buffer.from('01214eb921432c5c', 'hex') });
}

function deriveBondingCurve(mint) {
  return pda([Buffer.from('bonding-curve'), mint.toBuffer()], PUMP_PROGRAM);
}

function deriveCreatorVaultPda(creator) {
  return pda([Buffer.from('creator-vault'), creator.toBuffer()], PUMP_PROGRAM);
}

function deriveCreatorVaultAuthorityPda(creator) {
  return pda([Buffer.from('creator_vault'), creator.toBuffer()], PUMP_AMM_PROGRAM);
}

function deriveAmmGlobalConfig() {
  return pda([Buffer.from('global_config')], PUMP_AMM_PROGRAM);
}

function deriveCreatorFeeSharingConfig(mint) {
  return pda([Buffer.from('sharing-config'), mint.toBuffer()], PFEE_PROGRAM);
}

function deriveSharingPumpVault(sharingConfig) {
  return pda([Buffer.from('creator-vault'), sharingConfig.toBuffer()], PUMP_PROGRAM);
}

function deriveSharingAmmVaultAuthority(sharingConfig) {
  return pda([Buffer.from('creator_vault'), sharingConfig.toBuffer()], PUMP_AMM_PROGRAM);
}

function pda(seeds, programId) {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

function anchorDiscriminator(name) {
  return crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

function parseCreatorFromBondingCurve(data) {
  if (!data) return null;
  if ('parsed' in data) return null;
  const raw = Buffer.isBuffer(data) ? data : data instanceof Uint8Array ? Buffer.from(data) : Buffer.from(data.data || []);
  if (raw.length < 49) return null;
  // layout: 8 discriminator + 5×8 u64 reserves + 1 bool complete = 49 bytes before creator
  try { return new PublicKey(raw.subarray(49, 81)); } catch { return null; }
}

async function tokenProgramForMint(mint) {
  const info = await connection.getAccountInfo(mint);
  if (!info) throw new Error(`Mint not found: ${mint.toBase58()}`);
  if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  throw new Error(`Unsupported mint owner for ${mint.toBase58()}: ${info.owner.toBase58()}`);
}

function tokenProgramForMintSync(mint) {
  if (mint.equals(new PublicKey('So11111111111111111111111111111111111111112'))) return TOKEN_PROGRAM_ID;
  return TOKEN_PROGRAM_ID;
}

async function getTokenBalanceRaw(ata) {
  const balance = await connection.getTokenAccountBalance(ata).catch(() => null);
  return BigInt(balance?.value?.amount || '0');
}

function keypairFromPrivateKey(privateKey) {
  const raw = privateKey.trim();
  if (raw.startsWith('[')) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  return Keypair.fromSecretKey(bs58.decode(raw));
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

function lamportsToSol(lamports) {
  return (Number(lamports) / LAMPORTS_PER_SOL).toFixed(9);
}

function drainDelta(before, after) {
  return before > after ? before - after : 0n;
}

function getModeArg() {
  const index = process.argv.indexOf('--mode');
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});