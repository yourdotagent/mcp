import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STONK_DIR = path.resolve(__dirname, '..', 'ops', 'stonkfun');

const OPS = {
  deploy_launchlab_token: { script: 'deploy.cjs', needsApprovalForSend: true },
};

function cleanArgs(args = []) {
  if (!Array.isArray(args)) throw new Error('args must be an array');
  return args.map((value) => String(value));
}
function hasSend(args) { return cleanArgs(args).includes('--send'); }

export function listStonkfunOps() {
  return Object.entries(OPS).map(([name, op]) => ({
    name,
    script: op.script,
    defaultMode: 'plan-only unless --build or --send is passed',
    exactApprovalRequiredForSend: op.needsApprovalForSend,
  }));
}

export async function runStonkfunOp({ op, args = [], env = {}, approvedSend = false, timeoutMs = 120000 }) {
  const spec = OPS[op];
  if (!spec) throw new Error(`Unknown StonkFun op: ${op}`);
  const finalArgs = cleanArgs(args);
  if (hasSend(finalArgs) && !approvedSend) throw new Error('Refusing --send without approvedSend=true. Exact human approval is required.');
  const safeEnv = { ...process.env, ...env };
  if (safeEnv.DOTAGENT_RPC_URL && !safeEnv.RPC_URL) safeEnv.RPC_URL = safeEnv.DOTAGENT_RPC_URL;
  const script = path.join(STONK_DIR, spec.script);
  return await spawnNode(script, finalArgs, safeEnv, timeoutMs);
}

function spawnNode(script, args, env, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: STONK_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`StonkFun op timed out after ${timeoutMs}ms`)); }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, ok: code === 0, stdout: redact(stdout), stderr: redact(stderr) }); });
  });
}

function redact(text) {
  return String(text || '')
    .replace(/PRIVATE_KEY=\S+/g, 'PRIVATE_KEY=[REDACTED]')
    .replace(/SOLANA_PRIVATE_KEY=\S+/g, 'SOLANA_PRIVATE_KEY=[REDACTED]');
}
