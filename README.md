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
