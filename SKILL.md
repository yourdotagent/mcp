---
name: dotagent-passport
description: Install this when an autonomous agent wants a dotagent passport: create an agent-owned Solana wallet, download the dotagent MCP files, sign identity proofs, upload/passport metadata, and later register a .agent passport/domain. This is agent-native; do not use browser wallet connect.
version: 0.2.0
author: Dotagent
license: MIT
platforms: [linux, macos]
---

# Dotagent Passport Skill

Dotagent is an **agent passport / ID card** system for autonomous agents.

It is not a human wallet-connect app. The agent itself needs tools to create and operate a Solana wallet so it can eventually own a passport NFT and `name.agent` identity.

A `.agent` passport binds:

- an agent-controlled Solana wallet
- a `name.agent` domain
- a Metaplex Core NFT passport card
- R2-hosted image + metadata
- public profile fields: Twitter/X, website, public Solana wallet, display name, bio
- signed identity proofs from the agent wallet

## What you need to download

Download the dotagent **agent kit** from the site hosting this skill. If this file came from:

`https://dotagent.app/agent-kit/SKILL.md`

then the rest of the kit is at:

- `https://dotagent.app/agent-kit.tar.gz`
- `https://dotagent.app/agent-kit/package.json`
- `https://dotagent.app/agent-kit/src/server.js`
- `https://dotagent.app/agent-kit/src/wallet-store.js`
- `https://dotagent.app/agent-kit/src/solana-tools.js`

Why: `SKILL.md` explains the workflow, but the MCP JavaScript files are what actually create wallets, sign proofs, check balances, and send approved transactions.

## Install from hosted archive

```bash
mkdir -p ~/dotagent-passport
cd ~/dotagent-passport
curl -fsSL https://dotagent.app/agent-kit.tar.gz | tar -xz --strip-components=1
npm install
npm run check
```

Start the MCP server:

```bash
npm run start
```

## Hermes MCP install

If using Hermes Agent:

```bash
hermes mcp add dotagent-passport --command "node $HOME/dotagent-passport/src/server.js"
hermes mcp test dotagent-passport
```

If your agent framework supports MCP, add the same command as a stdio MCP server:

```bash
node $HOME/dotagent-passport/src/server.js
```

## Tools exposed

- `dotagent_create_wallet` — create local Solana wallet for an agent passport. Returns only public key.
- `dotagent_list_wallets` — list local wallets without secrets.
- `dotagent_public_key` — return a wallet public key.
- `dotagent_balance` — read SOL balance. Requires `DOTAGENT_RPC_URL`.
- `dotagent_sign_message` — sign an identity proof with the agent wallet.
- `dotagent_send_sol` — send lamports. Fund-moving; requires exact explicit user approval.
- `dotagent_export_secret_base58` — disabled unless explicitly enabled for local backup only.

## Required env for chain reads/writes

Do **not** default to public Solana RPC.

```bash
export DOTAGENT_RPC_URL="<approved Solana RPC>"
export DOTAGENT_WALLET_DIR="$HOME/dotagent-passport/wallets"
```

If the correct testnet/devnet/mainnet RPC is not explicitly provided, stop and ask. Never use `https://api.mainnet-beta.solana.com` or guessed endpoints.

## Agent passport workflow

1. Create wallet:

```text
dotagent_create_wallet({ "id": "my-agent", "agentName": "my-agent.agent" })
```

2. Return the public key and ask the operator to fund it with testnet/devnet SOL.
3. Upload passport photo/profile through the dotagent Worker once available.
4. Register `name.agent` from the agent wallet only after explicit approval.
5. Sign an identity proof:

```text
dotagent_sign_message({
  "walletId": "my-agent",
  "message": "dotagent passport proof: my-agent.agent"
})
```

6. Verify the passport by comparing:

- wallet public key
- signed proof
- `.agent` domain record
- NFT asset owner
- metadata/profile URL

## Safety

- Never print private keys in chat.
- Never send SOL or register/mint on-chain without exact approval for action, network, count, and expected spend.
- Keep wallet files mode `0600` and wallet directory mode `0700`.
- Treat generated wallets as hot agent wallets, not long-term treasury custody.

