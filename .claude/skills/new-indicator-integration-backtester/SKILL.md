---
name: new-indicator-integration-backtester
description: This repo's slice of adding a brand-new indicator to Gainium — the backtester's own duplicated type set plus indicatorLoader/strategy wiring. Doesn't use the indicators factory; hand-wires each indicator. Use when scoping or implementing a new-indicator PR in backtester.
---

# New indicator integration — backtester's part

Canonical source: `new-indicator-integration` in Gainium's internal
`skills` repo (private — this file is a scoped copy synced from there; edit
the source, not this copy, if it needs updating).

## Global objective

Gainium's indicator math is written once in `@gainium/indicators` and
consumed four times. `@gainium/backtester` is one of those four — a
published library that runs both **server-side (main-app `:7515`) and
client-side in both dashboards**, so the same math must produce identical
results everywhere. Unlike main-app and market-archive, this repo does
**not** use the indicators factory — it hand-wires each indicator and keeps
its own duplicated type set, so a normal indicator needs real per-indicator
work here even though it was "just a factory registration" upstream.

## This repo's part

0. **`src/types.ts` — easy to miss.** This repo does **not** import the
   platform's `IndicatorEnum`/config — it redefines them. Add: the
   `IndicatorEnum` entry; supporting enums; **both** config unions (the
   file carries a runtime `IndicatorConfig` *and* a separate
   backtesting-input union); the `IndicatorHistory` member (importing the
   result type from `@gainium/indicators`); the optional
   `SettingsIndicators` fields. Skipping this file because "the indicators
   package already has the enum" is the most common way this repo's PR
   goes out incomplete.

Under `src/dca/strategy/ti/` (skip all three for a time filter — see below):

1. **`indicatorLoader.ts`** — import the class from `@gainium/indicators`,
   add it to the private `indicator?:` type union, add a constructor
   branch that builds it and sets `this.length` (the warmup window this
   loader requests — computed **by hand here**, it does not call
   `getWarmupCandles`; keep it in sync with the indicators package's
   warmup value or the two will silently disagree).
2. **`index.ts` (strategy)** — in the constructor's indicator-build loop,
   add the branch that passes your config through to build the
   `InternalIndicator`.
3. **`index.ts` `checkIndicators()`** — add a branch mapping the
   indicator's latest/previous `IndicatorHistory` value onto the
   `last / prev / value / prevValue` comparison the strategy uses to fire
   — the same cross/threshold shape as main-app's
   `checkIndicatorConditions`.

**A time/calendar filter is the exception**: no indicator instance, no
`indicatorLoader` branch. Instead `index.ts` carries an exclusion flag,
filters it out when building `InternalIndicator`s, and a per-bar
status-stamping function (called at the top of `checkIndicators`) evaluates
the filter function directly against the current bar's timestamp.

After publishing, this version needs to land in **main-app and both
dashboards** — the whole point is that all three run the same version;
don't consider this repo's PR done until you've confirmed downstream bumps
are planned, even though executing them isn't this repo's job.

## Sister repos

All public, same repo family as this one:

- **indicators** — the source of the class and result type this repo
  imports; also where the "official" warmup length is set, which this
  repo's `indicatorLoader.ts` duplicates by hand.
- **app-sh** — the main-app core; needs the matching `@gainium/backtester`
  bump for its own indicator wiring and `yarn indicators:test` to make
  sense together.
- **main-dash-sh** — the dashboard core; its chart/backtest UI "just
  works" once this repo's version is bumped there, no separate client
  wiring needed on that side.
- **content** — unrelated to this repo's code.

Gainium's main-app and dashboard services (both ship as part of the
self-hosted bundle too, alongside this repo) each bump this library
independently to the version you publish — keeping all three in lockstep
is what prevents diverging backtest results, but that coordination happens
on their side, not in this repo's PR.
