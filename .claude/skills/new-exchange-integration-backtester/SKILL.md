---
name: new-exchange-integration-backtester
description: This repo's slice of adding a brand-new exchange to Gainium — the shared @gainium/backtester lib's ExchangeEnum, and (for USD-quoted perps) price/hedge helper work. Runs both server-side and client-side, so this is a published-package change, not an app change. Use when scoping or implementing a new-exchange PR in backtester.
---

# New exchange integration — backtester's part

Canonical source: `new-exchange-integration` in Gainium's internal `skills`
repo (private — this file is a scoped copy synced from there; edit the
source, not this copy, if it needs updating).

## Global objective

Gainium supports trading on multiple exchanges through a common internal
`Exchange` interface — one adapter per exchange (in `exchange-connector-sh`)
so the rest of the platform never has to know which exchange it's talking
to. `@gainium/backtester` is the shared library that runs the same
backtest math wherever a backtest happens — server-side in main-app, and
client-side in-browser in the dashboards. The same code must produce
identical results in both, which is why exchange awareness lives here in
one place rather than being reimplemented per consumer.

## This repo's part

**The backtest engine itself is exchange-agnostic.** Fees, precision, and
USD rates are **inputs** passed in per run, not hardcoded per exchange. For
a standard spot/USDT exchange, the whole core change is:

- **`src/types.ts`** — add the `ExchangeEnum` members (this repo is one of
  several places the enum is independently declared). Keep it identical to
  the connector-core enum's naming convention (`<name>`, `<name>Usdm`,
  `paper<Name>`, ...), plus the dashboard's `<name>All`/`<name>Spot`
  selection ids if the dashboards use them.
- A version bump + publish, so consumers can pick it up.

**USD-quoted perps / unusual quoting need more.** If the exchange prices
perps in USD (not USDT) or has odd contract semantics, budget for:
- `src/helper/price.ts` — `$` price / USD-rate handling.
- `src/index.ts` — wiring for the above.
- `src/hedge/index.ts` — futures naming + hedging across different symbols.

A plain spot/USDT exchange doesn't need any of the three files above.

**Publish before anyone can bump to it.** This is a published npm package —
`app` and both dashboards each bump their own `package.json` to the new
version separately, and none of them can do that until this repo's new
version is actually published.

## Sister repos

All public, same repo family as this one:

- **exchange-connector-sh** — defines the adapter and the canonical
  `ExchangeEnum` this repo's enum should mirror.
- **websocket-connector-sh** — the streams; unrelated to this repo's code
  directly, but the live data this repo's server-side consumer ultimately
  displays flows through it.
- **app-sh** — the engine whose GraphQL schema exposes the enum this repo
  also declares.
- **paper-trading-sh** — has its own `paper<Name>` enum, following the same
  convention as this repo's.
- **main-dash-sh** — the dashboard core; its `ExchangeDialog`/entitlement
  work is independent of this repo, but its backtest UI bundles this
  library client-side.
- **content** — the "connect via API keys" guide.
- **docker-sh** — the self-hosted release bundle; not something this repo
  ships inside of directly (it's a library, not a service), but its
  consumers are.

Gainium's cloud SaaS wires a few more pieces on top of this stack
(paid-plan gating, an internal monitoring/admin layer, marketing pages) —
not part of the self-hosted deployment, not this repo's concern.
