# Pump standalone ops scripts

Extracted Pump components. These scripts intentionally require `RPC_URL` from env; they do not default to a public Solana RPC.

Load env from `ops/pump/.env`, the MCP repo `.env`, or explicit MCP tool env. No `.env` is committed. Default mode is simulation/dry-run. Add `--send` only after exact approval.

## Scripts

- `buy-bonding-curve.cjs` — direct Pump.fun bonding-curve buy.
- `buy-migrated.cjs` — migrated-token Jupiter/Pump AMM buy path.
- `buy.cjs` — auto-detects bonding curve completion and dispatches to bonding/migrated buy.
- `add-liquidity.cjs` — Pump AMM add liquidity.
- `claim-fees.cjs` — auto claim Pump v2, AMM, and redirect/share fees. Use `--mode auto|pump-v2|amm|redirect|sharing-amm`.
- `airdrop.cjs` — random-holder airdrop helper copied out as standalone.
- `deploy.cjs` — Pump token deploy helper copied out as standalone.
- `burn-tokens.cjs` — burn the signer's token balance or `--amount-raw`.

## Common args/env

```bash
RPC_URL=... PRIVATE_KEY=... PROJECT_TOKEN_MINT=... node ops/pump/buy.cjs --amount-sol 0.1
node ops/pump/buy.cjs --amount-lamports 100000000 --send
node ops/pump/buy-migrated.cjs --amount-raw 100000000 --send
node ops/pump/add-liquidity.cjs --send
node ops/pump/claim-fees.cjs --mode auto --send
```

Notes:

- `buy-bonding-curve.cjs` requires `--amount-sol`, `--amount-lamports`, `BUY_SOL`, or `BUY_LAMPORTS`.
- `buy-migrated.cjs` uses `SWAP_AMOUNT_RAW`, `--amount-raw`, or `--all`, same as the previous rotate buy script.
- `claim-fees.cjs` supports `--mode auto|pump-v2|amm|redirect|sharing-amm`.
