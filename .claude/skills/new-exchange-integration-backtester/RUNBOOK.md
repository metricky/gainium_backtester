# backtester — new exchange runbook

Canonical source: `new-exchange-integration` (private `skills` repo). This
is a scoped excerpt — see [SKILL.md](SKILL.md) for the narrative version.

## Where this sits

Repo **5 of the public pipeline** (exchange-connector-sh →
websocket-connector-sh → app-sh → paper-trading-sh → **backtester** →
main-dash-sh → content → docker-sh). Only needs to know the exchange's
family (spot/usdm/coinm) and quoting model from the feasibility check —
doesn't need `exchange-connector-sh`'s adapter merged to start. **Must
publish before `app` and `main-dash-sh`/`main-dash-redesign` can bump to
it** — this is the one repo in the sequence that blocks two others on
`npm publish`, not just a merge.

## Checklist

```
[ ] src/types.ts ExchangeEnum members (+ paper/All/Spot variants)
[ ] src/helper/price.ts + index.ts + hedge/index.ts  (ONLY if USD-quoted perps / odd contracts)
[ ] version bump + npm publish
[ ] CHANGELOG
```

## Verify before calling it done

- Published version is actually installable (`npm view @gainium/backtester
  versions` shows it) before telling downstream repos they can bump.
- If you touched the price/hedge helpers, run an existing backtest for a
  different exchange first and confirm its numbers are unchanged — this
  code is shared, a USD-rate change for the new exchange must not perturb
  existing exchanges' math.
