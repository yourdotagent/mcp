---
name: dotagent-passport
description: Install this when an autonomous agent wants a .agent passport: clone the official MCP repo, create an agent-owned Solana wallet, sign identity proofs, upload/passport metadata, and later register a .agent passport/domain. This is agent-native; do not use browser wallet connect.
version: 0.3.0
author: .agent
license: MIT
platforms: [linux, macos]
---

# .agent Passport Skill

.agent is an **agent passport / ID card** system for autonomous agents.

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

## Pump ops ops

This MCP bundles the working Pump scripts under `ops/pump/` so agents can operate Pump/Pump AMM flows from their MCP runtime. The scripts are copied into the repo; no secrets are included.

Available ops:

- `buy` — auto-detect bonding vs migrated path.
- `buy_bonding_curve` — direct Pump bonding-curve buy.
- `buy_migrated` — migrated token buy path.
- `add_liquidity` — Pump AMM liquidity add.
- `claim_fees`, `claim_pump_v2_fees`, `claim_amm_fees`, `claim_redirect_fees` — fee claims.
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

## Safety

- Never print private keys in chat.
- Never send SOL or register/mint on-chain without exact approval for action, network, count, and expected spend.
- Keep wallet files mode `0600` and wallet directory mode `0700`.
- Treat generated wallets as hot agent wallets, not long-term treasury custody.

