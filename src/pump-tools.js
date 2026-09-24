import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUMP_DIR = path.resolve(__dirname, '..', 'ops', 'pump');

const OPS = {
  buy: { script: 'buy.cjs', needsApprovalForSend: true },
  buy_bonding_curve: { script: 'buy-bonding-curve.cjs', needsApprovalForSend: true },
  buy_migrated: { script: 'buy-migrated.cjs', needsApprovalForSend: true },
  add_liquidity: { script: 'add-liquidity.cjs', needsApprovalForSend: true },
  claim_fees: { script: 'claim-fees.cjs', needsApprovalForSend: true },
  claim_pump_v2_fees: { script: 'claim-pump-v2-fees.cjs', needsApprovalForSend: true },
  claim_amm_fees: { script: 'claim-amm-fees.cjs', needsApprovalForSend: true },
  claim_redirect_fees: { script: 'claim-redirect-fees.cjs', needsApprovalForSend: true },
  deploy_pump_token: { script: 'deploy.cjs', needsApprovalForSend: true },
  airdrop: { script: 'airdrop.cjs', needsApprovalForSend: true },
  burn_tokens: { script: 'burn-tokens.cjs', needsApprovalForSend: true },
};

function cleanArgs(args = []) {
  if (!Array.isArray(args)) throw new Error('args must be an array');
  return args.map((value) => String(value));
}

function hasSend(args) {
  return cleanArgs(args).includes('--send');
}

export function listPumpOps() {
  return Object.entries(OPS).map(([name, op]) => ({
    name,
    script: op.script,
    defaultMode: 'simulation/dry-run unless --send is passed',
    exactApprovalRequiredForSend: op.needsApprovalForSend,
  }));
}

export async function runPumpOp({ op, args = [], env = {}, approvedSend = false, timeoutMs = 120000 }) {
  const spec = OPS[op];
  if (!spec) throw new Error(`Unknown Pump op: ${op}`);
  const finalArgs = cleanArgs(args);
  if (hasSend(finalArgs) && !approvedSend) {
    throw new Error('Refusing --send without approvedSend=true. Exact human approval is required for the action/network/spend.');
  }
  const safeEnv = { ...process.env, ...env };
  if (safeEnv.DOTAGENT_RPC_URL && !safeEnv.RPC_URL) safeEnv.RPC_URL = safeEnv.DOTAGENT_RPC_URL;
  if (!safeEnv.RPC_URL) throw new Error('RPC_URL is required. Do not use public Solana RPC defaults.');
  if (!safeEnv.PRIVATE_KEY) throw new Error('PRIVATE_KEY is required in env for Pump ops. Never print it.');

  const script = path.join(PUMP_DIR, spec.script);
  return await spawnNode(script, finalArgs, safeEnv, timeoutMs);
}

function spawnNode(script, args, env, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: PUMP_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Pump op timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, ok: code === 0, stdout: redact(stdout), stderr: redact(stderr) });
    });
  });
}

function redact(text) {
  return String(text || '').replace(/PRIVATE_KEY=\S+/g, 'PRIVATE_KEY=[REDACTED]');
}
