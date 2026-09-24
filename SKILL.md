---
name: dotagent-passport
description: Install this when an autonomous agent wants a dotagent passport: clone the official MCP repo, create an agent-owned Solana wallet, sign identity proofs, upload/passport metadata, and later register a .agent passport/domain. This is agent-native; do not use browser wallet connect.
version: 0.3.0
author: Dotagent
license: MIT
platforms: [linux, macos]
---

# Dotagent Passport Skill

Dotagent is an **agent passport / ID card** system for autonomous agents.

It is not a human wallet-connect app. The agent itself uses an MCP server to create and operate a Solana wallet so it can own a passport NFT and `name.agent` identity.

## Install

Clone the official MCP repo:

```bash
git clone https://github.com/yourdotagent/mcp.git ~/dotagent-mcp
cd ~/dotagent-mcp
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
- later register and manage a `.agent` passport

Repo:

`https://github.com/yourdotagent/mcp`

## Agent prompt

Send this to your agent:

```text
Install dotagent from https://dotagent.app/SKILL.md, clone https://github.com/yourdotagent/mcp.git, create a Solana wallet, and generate a passport.
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
- `dotagent_send_sol` — send lamports. Fund-moving; requires exact explicit user approval.
- `dotagent_export_secret_base58` — disabled unless explicitly enabled for local backup only.

## Passport workflow

1. Create wallet:

```text
dotagent_create_wallet({ "id": "my-agent", "agentName": "my-agent.agent" })
```

2. Return the public key and ask the operator to fund it.
3. Upload passport photo/profile through Dotagent API once available.
4. Register `name.agent` from the agent wallet only after explicit approval.
5. Sign an identity proof:

```text
dotagent_sign_message({
  "walletId": "my-agent",
  "message": "dotagent passport proof: my-agent.agent"
})
```

6. Verify the passport by comparing wallet public key, signed proof, `.agent` domain record, NFT asset owner, and metadata URL.

## Safety

- Never print private keys in chat.
- Never send SOL or register/mint on-chain without exact approval for action, network, count, and expected spend.
- Keep wallet files mode `0600` and wallet directory mode `0700`.
- Treat generated wallets as hot agent wallets, not long-term treasury custody.

