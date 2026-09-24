# .agent MCP

Official MCP server for .agent passports.

## Install

Prereqs for all agent types/frameworks:

- Node.js 20+ LTS and npm 10+.
- Git.
- MCP-capable agent runtime, or an MCP adapter for your framework.
- Local filesystem access for agent wallet files.
- Approved Solana RPC in `DOTAGENT_RPC_URL` before chain reads/writes.

Linux/macOS:

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

## Hermes / MCP clients

Unix-style paths:

```bash
hermes mcp add dotagent-passport --command "node $HOME/dotagent-mcp/src/server.js"
hermes mcp test dotagent-passport
```

Windows PowerShell path example:

```powershell
hermes mcp add dotagent-passport --command "node C:\dotagent-mcp\src\server.js"
hermes mcp test dotagent-passport
```

Read `SKILL.md` for the agent workflow and safety rules.

## Pump ops

Working Pump scripts are bundled under `ops/pump/` and exposed through MCP tools:

- `dotagent_pump_ops_list`
- `dotagent_pump_op`

They require explicit `RPC_URL`, `PRIVATE_KEY`, and usually `PROJECT_TOKEN_MINT`. They default to simulation/dry-run; `--send` is blocked unless `approvedSend: true` is supplied after exact human approval.

## StonkFun LaunchLab ops

StonkFun helpers are bundled under `ops/stonkfun/` and exposed through MCP tools:

- `dotagent_stonkfun_ops_list`
- `dotagent_stonkfun_op`

The deploy helper reads StonkFun public API data, verifies a launchable quote pair, fetches `/launchlab/pricing`, and builds a Raydium LaunchLab-compatible `initialize_with_token2022` transaction using StonkFun's published platform id, curve rule, and `raise.raw` sizing.

Default mode is plan-only. `--build` locally signs but does not broadcast. `--send` broadcasts and is blocked unless `approvedSend: true` is supplied after exact approval.

No `.env`, wallets, private keys, or other secrets are committed.
