# backtester — new indicator runbook

Canonical source: `new-indicator-integration` (private `skills` repo). This
is a scoped excerpt — see [SKILL.md](SKILL.md) and the global
`new-indicator-integration` skill's `RUNBOOK.md` for the full order.

## Where this sits

**Step 2.** Depends on `indicators` (step 1) being published — this repo
imports the class and result type from it. In practice often developed in
parallel with step 1 on a shared feature branch, then released together.
Blocks `app` (step 3b), `main-dash-sh`/`main-dash-redesign` (steps 5–6),
and `dash` (step 8) — none of them can bump to a version of this repo that
doesn't exist yet.

## Checklist

```
[ ] src/types.ts                              (own IndicatorEnum + both config unions + IndicatorHistory + SettingsIndicators fields)
[ ] src/dca/strategy/ti/indicatorLoader.ts     (instance + warmup length — SKIP for a filter)
[ ] src/dca/strategy/ti/index.ts (strategy)    (construct InternalIndicator — SKIP/exclude for a filter)
[ ] src/dca/strategy/ti/index.ts checkIndicators()  (read result into signal, or per-bar filter status)
[ ] version bump + publish
[ ] CHANGELOG
```

## Verify before calling it done

- Run an existing backtest for a *different* indicator first and confirm
  its numbers are unchanged — `src/types.ts` and the strategy files are
  shared code, a mistake here can perturb every other indicator's
  backtest.
- The warmup `this.length` set in `indicatorLoader.ts` matches
  `getWarmupCandles`'s value in the `indicators` package for this type —
  a mismatch means this repo's backtest and main-app's live indicator
  disagree on when the result becomes trustworthy.
- Run a real backtest for the new indicator/filter and sanity-check the
  signal fires where you'd expect from the raw candle data.
