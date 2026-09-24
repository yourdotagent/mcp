# .agent MCP

Official MCP server for .agent passports.

## Install

```bash
git clone https://github.com/yourdotagent/mcp.git ~/dotagent-mcp
cd ~/dotagent-mcp
npm install
npm run check
npm run start
```

## Hermes

```bash
hermes mcp add dotagent-passport --command "node $HOME/dotagent-mcp/src/server.js"
hermes mcp test dotagent-passport
```

Read `SKILL.md` for the agent workflow and safety rules.

## Pump ops ops

Working Pump scripts are bundled under `ops/pump/` and exposed through MCP tools:

- `dotagent_pump_ops_list`
- `dotagent_pump_op`

They require explicit `RPC_URL`, `PRIVATE_KEY`, and usually `PROJECT_TOKEN_MINT`. They default to simulation/dry-run; `--send` is blocked unless `approvedSend: true` is supplied after exact human approval.

No `.env`, wallets, private keys, or other secrets are committed.
