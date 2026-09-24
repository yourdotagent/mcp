---
name: dotagent-passport
description: Install this when an autonomous agent wants a .agent passport: clone the official MCP repo, create an agent-owned Solana wallet, sign identity proofs, upload/passport metadata, and later register a .agent passport/domain. This is agent-native; do not use browser wallet connect.
version: 0.3.1
author: .agent
license: MIT
platforms: [linux, macos, windows]
---

# .agent Passport Skill

.agent is an **agent passport / ID card** system for autonomous agents.

It is not a human wallet-connect app. The agent itself uses an MCP server to create and operate a Solana wallet so it can own a passport NFT and `name.agent` identity.

## Prerequisites

Core setup for Linux, macOS, Windows, and most agent frameworks:

- Node.js 20+ LTS and npm 10+.
- Git, with this repo cloned locally.
- An agent runtime that can run MCP servers over stdio, or framework glue that can call MCP tools.
- Local filesystem access for wallet JSON files.
- Approved Solana RPC in `DOTAGENT_RPC_URL`; never use public/default RPCs.
- Operator approval before any transaction, mint, register, send, relayer submit, Pump op, or other spend.

Framework notes:

- MCP-native agents: Hermes, Claude Desktop, Cursor, Windsurf, VS Code/Copilot-style MCP clients can point at `node .../src/server.js`.
- Code agents: OpenAI/Responses, LangChain, CrewAI, AutoGen, Mastra, ElizaOS, custom Node/Python agents should call this MCP server through their MCP adapter/client rather than reimplementing wallet logic.
- Non-MCP agents need a tiny adapter that sends JSON-RPC/MCP calls to this stdio server.

Windows notes:

- Use PowerShell or Windows Terminal.
- Prefer a simple path like `C:\dotagent-mcp`.
- Use `$env:DOTAGENT_RPC_URL="<approved Solana RPC>"` and `$env:DOTAGENT_WALLET_DIR="C:\dotagent-mcp\wallets"`.
- File mode hardening is enforced on Unix; on Windows, protect the wallet directory with the user account/BitLocker permissions.

## Install

Clone the official MCP repo:

```bash
git clone https://github.com/yourdotagent/mcp.git ~/dotagent-mcp
cd ~/dotagent-mcp
npm install
npm run check
npm run start
```

Windows PowerShell:

```powershell
git clone https://github.com/yourdotagent/mcp.git C:\dotagent-mcp
cd C:\dotagent-mcp
npm install
npm run check
npm run start
```

If using Hermes Agent:

```bash
hermes mcp add dotagent-passport --command "node $HOME/dotagent-mcp/src/server.js"
hermes mcp test dotagent-passport
```

## Why download the repo?

This `SKILL.md` explains the workflow. The repo contains the actual MCP JavaScript tools that let an agent:

- create its own Solana wallet
- list/load local passport wallets
- sign identity proof messages
- check wallet balance with an approved RPC
- send approved transactions
- register and manage a `.agent` passport with a single on-chain registration transaction

Repo:

`https://github.com/yourdotagent/mcp`

## Agent prompt

Send this to your agent:

```text
Install .agent from https://dotagent.app/SKILL.md, clone https://github.com/yourdotagent/mcp.git, create a Solana wallet, and generate a passport.
```

## Required env for chain reads/writes

Do **not** default to public Solana RPC.

```bash
export DOTAGENT_RPC_URL="<approved Solana RPC>"
export DOTAGENT_WALLET_DIR="$HOME/dotagent-mcp/wallets"
```

If the correct devnet/testnet/mainnet RPC is not explicitly provided, stop and ask. Never use `https://api.mainnet-beta.solana.com` or guessed endpoints.

## Tools exposed

- `dotagent_create_wallet` — create local Solana wallet for an agent passport. Returns only public key.
- `dotagent_list_wallets` — list local wallets without secrets.
- `dotagent_public_key` — return a wallet public key.
- `dotagent_balance` — read SOL balance. Requires `DOTAGENT_RPC_URL`.
- `dotagent_sign_message` — sign an identity proof with the agent wallet.
- `dotagent_sign_nfp_proof` — gaslessly sign an NFP ownership statement. No transaction.
- `dotagent_prove_ownership` — one-command proof: generate/sign a site nonce challenge gaslessly and optionally submit through a relayer after exact approval.
- `dotagent_record_nfp_proof` — relayer records that signature on-chain via Ed25519 verification. Fund-moving for relayer gas/rent; requires exact approval.
- `dotagent_send_sol` — send lamports. Fund-moving; requires exact explicit user approval.
- `dotagent_register_passport` — after explicit approval, registers `name.agent` from the agent wallet. Costs `0.2 SOL + gas`; the program uses the 0.2 SOL to pay NFT/domain creation costs and sweeps leftover to treasury.
- `dotagent_export_secret_base58` — disabled unless explicitly enabled for local backup only.
- `dotagent_pump_ops_list` — list bundled Pump ops scripts.
- `dotagent_pump_op` — run bundled Pump ops through MCP. Dry-run/simulation by default; `--send` requires exact approval and `approvedSend: true`.
- `dotagent_stonkfun_ops_list` — list bundled StonkFun LaunchLab ops.
- `dotagent_stonkfun_op` — plan/build/send a StonkFun-compatible Raydium LaunchLab deployment. Plan-only by default; `--send` requires exact approval and `approvedSend: true`.

## Passport workflow

1. Create wallet:

```text
dotagent_create_wallet({ "id": "my-agent", "agentName": "my-agent.agent" })
```

2. Return the public key and ask the operator to fund it with at least `0.2 SOL + gas`.
3. Check balance with `dotagent_balance`.
4. Only after exact human approval for network, name, and spend, register `name.agent`:

```text
dotagent_register_passport({
  "walletId": "my-agent",
  "name": "my-agent.agent",
  "metadataUri": "https://api.dotagent.app/meta/my-agent.agent",
  "profile": {
    "displayName": "My Agent",
    "bio": "Autonomous .agent passport",
    "publicSolanaWallet": "<agent wallet public key>"
  }
})
```

This sends one registration/mint transaction signed by the agent wallet and a new NFT asset keypair. The contract charges `0.2 SOL`, mints the Core NFT directly to the agent wallet, creates the `.agent` domain record owned by that wallet, then sweeps leftover lamports to treasury.

5. Sign an identity proof:

```text
dotagent_sign_message({
  "walletId": "my-agent",
  "message": ".agent passport proof: my-agent.agent"
})
```

6. Verify the passport by comparing wallet public key, signed proof, `.agent` domain record, NFT asset owner, and metadata URL.

## Challenge flow

1. Site generates a nonce/challenge.
2. Agent signs it gaslessly.
3. Relayer records proof.
4. Nonce PDA prevents replay; expiry/audience in the signed challenge prevents stale-proof confusion.

## MCP one-command proof

Use `dotagent_prove_ownership` for agent-friendly proof flow. It signs locally by default and can optionally ask a user/relayer to submit the proof on-chain.

```text
dotagent_prove_ownership({
  "walletId": "my-agent",
  "name": "my-agent.agent",
  "challenge": "<site nonce/challenge>"
})
```

## NFP signature proofs

Agents can also sign a gasless ownership statement, then a relayer can record it on-chain:

```text
dotagent_sign_nfp_proof({
  "walletId": "my-agent",
  "name": "my-agent.agent",
  "statement": "yes, i own this, i just signed this"
})
```

The on-chain record path verifies the Ed25519 signature against the passport owner and stores a proof PDA with the message, signature, NFT asset, domain record, nonce, and timestamp.

## Pump ops

This MCP bundles the working Pump scripts under `ops/pump/` so agents can operate Pump/Pump AMM flows from their MCP runtime. The scripts are copied into the repo; no secrets are included.

Available ops:

- `buy` — auto-detect bonding vs migrated path.
- `buy_bonding_curve` — direct Pump bonding-curve buy.
- `buy_migrated` — migrated token buy path.
- `add_liquidity` — Pump AMM liquidity add.
- `claim_fees` — fee claims. Use args like `["--mode", "pump-v2"]`, `["--mode", "amm"]`, or `["--mode", "redirect"]`.
- `deploy_pump_token` — Pump token deploy helper.
- `airdrop` — holder airdrop helper.
- `burn_tokens` — burn signer token balance or amount.

Use `dotagent_pump_ops_list` to inspect available ops.

Example dry-run/simulation:

```text
dotagent_pump_op({
  "op": "buy",
  "args": ["--mint", "<mint>", "--amount-sol", "0.01"],
  "env": {
    "RPC_URL": "<approved Solana RPC>",
    "PRIVATE_KEY": "<agent wallet secret, never paste in public chat>",
    "PROJECT_TOKEN_MINT": "<mint>"
  }
})
```

Live execution requires exact approval for the action/network/spend and must pass `--send` plus `approvedSend: true`:

```text
dotagent_pump_op({
  "op": "add_liquidity",
  "args": ["--send"],
  "approvedSend": true,
  "env": { "RPC_URL": "<approved RPC>", "PRIVATE_KEY": "<secret>", "PROJECT_TOKEN_MINT": "<mint>" }
})
```

There is no dedicated sell script in the copied Pump folder yet; add a known-good sell script before exposing sell as an MCP op.

## StonkFun LaunchLab ops

This MCP also bundles a StonkFun deployment helper under `ops/stonkfun/deploy.cjs`.

It follows the public StonkFun developer docs:

- reads `GET /pairs?launchable=true&launchLabReady=true`
- reads `GET /launchlab/pricing?quoteMint=<mint>`
- uses `pricing.raise.raw` for `totalFundRaisingB`
- uses StonkFun's published platform id and curve-rule account
- supports standard launches by default and reward/taxed launches with `--tax-bps`
- patches the quote token program slot to Token-2022 when the selected quote pair requires it

Plan-only example, no signing or transaction:

```text
dotagent_stonkfun_op({
  "op": "deploy_launchlab_token",
  "args": ["--quote-mint", "<launchable quote mint>"]
})
```

Build but do not broadcast:

```text
dotagent_stonkfun_op({
  "op": "deploy_launchlab_token",
  "args": [
    "--quote-mint", "<launchable quote mint>",
    "--name", "My Token",
    "--symbol", "MYTKN",
    "--uri", "https://example.com/metadata.json",
    "--build"
  ],
  "env": {
    "RPC_URL": "<approved Solana RPC>",
    "PRIVATE_KEY": "<creator wallet secret, never paste in public chat>"
  }
})
```

Live `--send` is an irreversible on-chain LaunchLab deployment. It requires exact approval for network, quote mint, token metadata, tax mode, and expected spend, plus `approvedSend: true`.

## Safety

- Never print private keys in chat.
- Never send SOL or register/mint on-chain without exact approval for action, network, count, and expected spend.
- Keep wallet files mode `0600` and wallet directory mode `0700`.
- Treat generated wallets as hot agent wallets, not long-term treasury custody.

