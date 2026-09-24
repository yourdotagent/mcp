import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createWallet, listWallets, exportPublicKey, secretAsBase58 } from './wallet-store.js';
import { getBalance, signMessage, sendSol, registerPassport, signNfpProof, recordNfpProof } from './solana-tools.js';

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
