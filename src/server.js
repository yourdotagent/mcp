import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createWallet, listWallets, exportPublicKey, secretAsBase58 } from './wallet-store.js';
import { getBalance, signMessage, sendSol, registerPassport, signNfpProof, recordNfpProof, proveOwnership } from './solana-tools.js';
import { listPumpOps, runPumpOp } from './pump-tools.js';
import { listStonkfunOps, runStonkfunOp } from './stonkfun-tools.js';

const server = new McpServer({
  name: 'dotagent-passport',
  version: '0.1.0',
});

function text(data) {
  return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] };
}

server.tool(
  'dotagent_create_wallet',
  'Create a local Solana wallet for an autonomous agent passport. Does not print private key.',
  {
    id: z.string().optional().describe('Local wallet id, e.g. quant-agent'),
    agentName: z.string().optional().describe('.agent name, e.g. quant.agent'),
    purpose: z.string().optional(),
  },
  async (args) => text(createWallet(args)),
);

server.tool(
  'dotagent_list_wallets',
  'List local .agent wallets without secrets.',
  {},
  async () => text({ wallets: listWallets() }),
);

server.tool(
  'dotagent_public_key',
  'Return a local wallet public key.',
  { walletId: z.string() },
  async ({ walletId }) => text({ walletId, publicKey: exportPublicKey(walletId) }),
);

server.tool(
  'dotagent_balance',
  'Read SOL balance for a local wallet or public key. Requires DOTAGENT_RPC_URL.',
  { walletId: z.string().optional(), publicKey: z.string().optional() },
  async (args) => text(await getBalance(args)),
);

server.tool(
  'dotagent_sign_message',
  'Sign an identity proof message with the agent wallet.',
  { walletId: z.string(), message: z.string() },
  async (args) => text(signMessage(args)),
);


server.tool(
  'dotagent_sign_nfp_proof',
  'Gaslessly sign a Non-Fungible Passport ownership proof. Does not send a transaction.',
  {
    walletId: z.string(),
    name: z.string().describe('.agent name, e.g. quant.agent'),
    nonce: z.union([z.string(), z.number()]).optional(),
    statement: z.string().optional(),
  },
  async (args) => text(signNfpProof(args)),
);


server.tool(
  'dotagent_prove_ownership',
  'One-command .agent ownership proof: generates/signs a nonce challenge gaslessly and can optionally submit through a relayer after exact approval.',
  {
    walletId: z.string(),
    name: z.string().describe('.agent name, e.g. quant.agent'),
    nonce: z.union([z.string(), z.number()]).optional(),
    challenge: z.string().optional().describe('Optional site-provided challenge. If omitted, MCP creates one.'),
    audience: z.string().optional().describe('Site/relayer audience label.'),
    ttlSeconds: z.number().int().positive().max(3600).optional(),
    submit: z.boolean().optional().describe('Default false. true records on-chain through a relayer.'),
    relayerWalletId: z.string().optional(),
    programId: z.string().optional(),
    explicitApproval: z.boolean().optional().describe('Must be true when submit=true because relayer pays gas/rent.'),
  },
  async (args) => text(await proveOwnership(args)),
);

server.tool(
  'dotagent_record_nfp_proof',
  'Record a gasless NFP signature proof on-chain via relayer. Fund-moving for relayer gas/rent: requires exact approval.',
  {
    relayerWalletId: z.string(),
    name: z.string(),
    nonce: z.union([z.string(), z.number()]),
    message: z.string(),
    signatureBase58: z.string(),
    signerPublicKey: z.string(),
    programId: z.string().optional(),
  },
  async (args) => text(await recordNfpProof(args)),
);


server.tool(
  'dotagent_pump_ops_list',
  'List bundled Pump operation scripts available through this MCP.',
  {},
  async () => text({ ops: listPumpOps() }),
);

server.tool(
  'dotagent_pump_op',
  'Run a bundled Pump op script. Defaults are dry-run/simulation. Passing --send is fund-moving and requires exact human approval plus approvedSend=true.',
  {
    op: z.enum(['buy', 'buy_bonding_curve', 'buy_migrated', 'add_liquidity', 'claim_fees', 'deploy_pump_token', 'airdrop', 'burn_tokens']),
    args: z.array(z.string()).optional().describe('CLI args for the script, e.g. ["--mint", "...", "--amount-sol", "0.01"]. Include --send only after exact approval.'),
    env: z.record(z.string()).optional().describe('Runtime env such as RPC_URL, PRIVATE_KEY, PROJECT_TOKEN_MINT. Do not expose secrets in chat.'),
    approvedSend: z.boolean().optional().describe('Must be true when args includes --send, after exact human approval.'),
    timeoutMs: z.number().int().positive().optional(),
  },
  async (args) => text(await runPumpOp(args)),
);


server.tool(
  'dotagent_stonkfun_ops_list',
  'List bundled StonkFun operation scripts available through this MCP.',
  {},
  async () => text({ ops: listStonkfunOps() }),
);

server.tool(
  'dotagent_stonkfun_op',
  'Run a bundled StonkFun op script. Defaults to plan-only. --send broadcasts an irreversible Solana transaction and requires exact human approval plus approvedSend=true.',
  {
    op: z.enum(['deploy_launchlab_token']),
    args: z.array(z.string()).optional().describe('CLI args, e.g. ["--quote-mint", "...", "--name", "My Token", "--symbol", "MYTKN", "--uri", "https://..."]'),
    env: z.record(z.string()).optional().describe('Runtime env such as RPC_URL and PRIVATE_KEY. Do not expose secrets in chat.'),
    approvedSend: z.boolean().optional().describe('Must be true when args includes --send, after exact human approval.'),
    timeoutMs: z.number().int().positive().optional(),
  },
  async (args) => text(await runStonkfunOp(args)),
);

server.tool(
  'dotagent_send_sol',
  'Send lamports from an agent wallet. Fund-moving: caller must explicitly request exact recipient and lamports.',
  { walletId: z.string(), to: z.string(), lamports: z.number().int().positive() },
  async (args) => text(await sendSol(args)),
);


server.tool(
  'dotagent_register_passport',
  'Register a .agent passport/domain. Fund-moving: requires exact approval for network, name, and 0.2 SOL registration fee plus gas.',
  {
    walletId: z.string(),
    name: z.string().describe('Name without or with .agent suffix, e.g. quant or quant.agent'),
    metadataUri: z.string().optional(),
    programId: z.string().optional(),
    profile: z.object({
      twitter: z.string().nullable().optional(),
      website: z.string().nullable().optional(),
      publicSolanaWallet: z.string().nullable().optional(),
      displayName: z.string().nullable().optional(),
      bio: z.string().nullable().optional(),
    }).optional(),
  },
  async (args) => text(await registerPassport(args)),
);

server.tool(
  'dotagent_export_secret_base58',
  'Disabled by default. Export wallet secret for local backup only when DOTAGENT_ALLOW_SECRET_EXPORT=true.',
  { walletId: z.string() },
  async ({ walletId }) => text({ walletId, secretKeyBase58: secretAsBase58(walletId) }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
