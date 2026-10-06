# Changelog

All notable changes to the Gainium Backtester library will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.11.0] - 2026-10-06

### Added

- Indicator condition `bw` ("between"): a value-type indicator (RSI, CCI, MFI, Williams %R, ADX, …) matches while its value is strictly between `indicatorValue` and the new optional `indicatorValue2` (bounds in either order). Same result as two indicators with "greater than" and "lower than" in one AND group. Without a numeric `indicatorValue2` the condition never matches.

## [1.10.0] - 2026-10-05

### Added

- `approveNewDeal` may answer `sizeScope: 'base'` with a size multiplier: only the base order scales and the DCA orders keep their configured size (`'whole'`, the default, scales both). The deal records `sizeScope`.

## [1.9.0] - 2026-10-05

### Added

- **Size multiplier on an approved entry.** `approveNewDeal` may answer `{approve, sizeMultiplier}` (a boolean still works). The multiplier (0.1–3) scales the new deal's base order and every safety order, on top of compound / risk-reduction sizes, for base, quote and USD size types on DCA and Combo; % of balance sizes and risk/reward sizing keep the configured size. The deal records `sizeMultiplier`.
- **`hostRequestEntry(symbol, time)`.** A host may attempt an entry on a pair at a later bar; every engine gate (max deals, cooldowns, range …) and the entry hook run as for the bot's own start condition.

### Fixed

- USD-sized orders now honour per-deal size deltas (`sizes`) like base and quote sizes. Nothing set them for USD sizes before, so results are unchanged.

## [1.8.1] - 2026-10-03

### Fixed

- A deal's own stop-loss close condition (set through `hostSetDealSettings`) now decides whether its percentage stop fires; it used to follow the bot's condition only, so a host that switched a stop on for one deal of a bot whose stop was off (and stored a non-price condition) got a stop that never fired.

## [1.8.0] - 2026-10-02

### Added

- **Optional host hooks for server-side runners.** `DCABacktestingInput.hooks` takes three synchronous callbacks: `approveNewDeal` (asked after every engine gate passed, right where a deal would open — `false` refuses it), `approveDealClose` (asked for an indicator take-profit close signal after the minimum-profit check — `false` keeps the deal open) and `afterBar` (called once every bar of the lowest interval at a time has been processed). A hook that throws approves. Without `hooks` the engine runs exactly as before; a parity test compares six configurations with golden results from 1.7.1, with and without approve-all hooks.
- **Host control of a running backtest.** `hostOpenDeals`, `hostAllDeals`, `hostLastPrice`, `hostSetDealSettings` (per-deal take profit, stop loss and trailing values — a deal settings override; the take-profit orders and the stop line follow at once), `hostSetBotSettings` (for deals opened from then on; open deals keep their values) and `hostCloseDeal` (a market close of one deal). Every take-profit / stop-loss read of a deal goes through the deal's effective settings, which are the bot's settings object itself when the deal has no override.

## [1.7.1] - 2026-10-01

### Fixed

- **An ATR/ADR stop loss no longer stops a DCA backtest from opening deals.** When the bot did not start on indicators and its only indicator need was an ATR/ADR stop loss (`dealCloseConditionSL: 'dynamicAr'` with `useSl`), the engine decided whether to evaluate indicators by checking the take-profit condition instead of the stop-loss one. No indicator was evaluated, the ATR/ADR level the deal needs was never available, and every deal was refused, so the backtest reported 0 deals. The stop-loss condition is now checked, and the stop is placed from the ATR/ADR value. Bots that use ATR/ADR for take profit or for safety orders were not affected.

## [1.7.0] - 2026-09-25

### Added

- **Stop the bot after X consecutive winning or losing deals.** Two new bot-controller settings, `useCloseAfterXconsecutiveWin` / `closeAfterXconsecutiveWin` and `useCloseAfterXconsecutiveLoss` / `closeAfterXconsecutiveLoss`, stop a DCA or combo bot from opening further deals once its closed deals end in a run of that many wins or losses. Unlike the existing `closeAfterXwin` / `closeAfterXloss` totals, the run resets on the first opposite outcome. Deals are read in `closedTime` order so a multi-pair bot's interleaved closes are counted in the order they actually finished, and a breakeven deal counts as a loss — the same split the cumulative counters use. Both settings are off by default and change nothing for existing backtests.

## [1.6.14] - 2026-09-24

### Fixed

- **Combo safety-order prices no longer accumulate rounding error across levels.** The combo ladder measured each level from the previous level's rounded price, so on a coarse tick a 30 × 1% ladder ended 24–36% from the start instead of 30%. Each level is now computed from the unrounded distance to the start and rounded once, matching the live combo engine. Mini-grid widths are unchanged.

## [1.6.13] - 2026-09-24

### Fixed

- **DCA safety-order prices no longer accumulate rounding error across levels.** A percentage ladder rounded each level to the price tick and measured the next level from the rounded price, so on a coarse tick (0.001 at a price near 0.25) a 30 × 1% ladder ended 24–36% below the start instead of 30%. Each level is now computed from the unrounded distance to the start and rounded once, matching the live bot engine. Indicator, custom-step and ATR/ADR ladders are unchanged.

## [1.6.12] - 2026-09-22

### Changed

- tsconfig

## [1.6.11] - 2026-09-21

### Fixed

- Grid backtest: a futures bot that stops on a `stopAndSell` take-profit or
  stop-loss while its net position is flat no longer wipes the result. The
  force close computed its P&L from the position's entry price, and with no
  position that price is zero — the division gave `Infinity`, the profit came
  out `NaN`, and every figure derived from it afterwards was `NaN` rounded to
  `0` on the way out. A backtest with booked transactions and real profit
  reported `0` profit, `0` value change and a `0` balance, with no error to say
  so. A flat close now contributes nothing, which is what it is worth, and the
  run reports what it earned up to that point. A neutral grid reaches a flat
  position whenever its open legs are all matched, so any stop landing on one
  of those bars was affected.
- Grid backtest: a run whose take-profit or stop-loss triggers before a single
  grid order fills now reports the budget it never spent, instead of a zero
  balance against a full starting balance. This happens when a `priceReached`
  trigger is set on the wrong side of the start price — the bot correctly stops
  on the first candle, and the result now says so rather than looking like a
  backtest that produced nothing.

Runs whose force close had an open position are unchanged, as are the
transaction rows in every case — a flat close still books no row, because there
is no order to record.

## [1.6.10] - 2026-09-19

### Fixed

- DCA backtest: an indicator that carries no id is evaluated like any other.
  The engine keys each indicator as `<id>@<pair>` and, when it assembles the
  set of indicators to evaluate on a bar, dropped the helper legs of an MA or
  XO crossing by rebuilding what their key would be and comparing the strings.
  An indicator with no id of its own has exactly the key that comparison
  builds, so it matched its own exclusion rule, was never evaluated, and every
  condition group containing it stayed false — the backtest finished with no
  deals and no error, which reads as a strategy that simply never trades. The
  same collision hit any indicator whose own id happened to equal the id of its
  crossing leg. The set is now taken from the flag the engine already sets when
  it registers a helper leg, so the question is asked once instead of
  reconstructed. (The second half of the old comparison was a bare string and
  always true, so it tested nothing; it is gone with it.)
- DCA backtest: two indicators that both arrive without an id no longer share
  one key. Indicator data, statuses and next-bar times are written back by key,
  so the two overwrote each other and an AND of them did not behave as an AND.
  Every indicator is now given an id before the run if it has none, which also
  keeps dynamic average-range levels matching their indicator.

Indicators built in the dashboard always carry an id, so backtest results for
those bots are unchanged. The case that moves is a backtest run on settings
assembled outside the dashboard — it used to come back with zero deals and now
returns the same deals the identical rules give with ids.

## [1.6.9] - 2026-09-19

### Fixed

- Order sizing: an order quantity that is already a whole number of the
  symbol's lot steps is no longer rounded up by another whole lot. The order
  builders tested the quantity against the lot step with a floating-point
  remainder, which does not read an already-aligned quantity as zero
  (`0.145 % 0.001` is `0.000999…`), so the round-up fired on a quantity that
  needed no rounding and the ceil at the step's precision turned that
  fractional hair into a full extra lot — a 10 000 USDT order at 68 571.5 on a
  0.001 lot step was sized 0.146 instead of the 0.145 the budget allows. This
  covers the DCA base order and safety orders, the combo base order and grid
  orders. The live bot engine has always rounded this correctly, so a backtest
  could show a larger position than the same bot would actually open. A
  genuinely off-grid quantity still rounds up to the next step as before.
- Grid order sizing no longer depends on which backtest mode is running. The
  trades-based and candle-based runs used two different remainders for the
  same check and misread different quantities, so the same grid could come out
  with different order quantities in each.

Backtest results move where the defect used to fire: those orders are now one
lot smaller, so the affected deals open slightly smaller positions and report
slightly different profit. Results that were already correct are unchanged.

## [1.6.8] - 2026-09-18

### Fixed

- Grid backtest: a stop-loss set as a reached price is now evaluated on every
  price point, even when a take-profit price is configured on the same bot.
  The two rules were chained, so the take-profit claimed the check and the
  stop-loss was never reached — a grid backtest with both prices set simply
  ran on through its stop-loss price and kept trading. Mixed setups (one rule
  by price, the other by value change) were unreachable the same way. The
  take-profit keeps priority when both apply.
- Grid backtest, short grids: the stop-loss now triggers when price rises
  through the stop price, matching the live bot engine. It was comparing in
  the wrong direction, which would stop a short grid in its profitable
  direction, typically on the first candle.

## [1.6.7] - 2026-09-16

### Fixed

- Grid backtest, futures: when a bot stops on a reached TP/SL price with the
  `stop and sell` action, the resulting position close is now recorded in the
  Transactions list. Its P&L was previously added to the totals without a
  matching transaction row, so the list ended on the last grid fill and did
  not add up to the reported total profit — the closing trade, usually a loss,
  was invisible. Total profit and value change are unchanged; the close now
  also counts toward the transaction counters, the average transaction profit
  and the Sharpe/Sortino ratios. Spot grids are
  unaffected: there the close converts the remaining inventory and was already
  reflected in the value change.

## [1.6.6] - 2026-09-03

### Added

- CI now runs a real `npm test` (mocha) on every PR. This repo had no
  test runner before; `test/placeholder.spec.ts` is a stand-in until
  real engine-math coverage lands.

## [1.6.5] - 2026-07-29

### Fixed
- DCA `periodicStats`: the monthly bucket loop stepped by a fixed 28 days instead of
  advancing to the start of the next calendar month, so the trailing month was dropped
  whenever the range's tail after the last 28-day sample point was shorter than 28 days.
  Affected any DCA/combo/hedge backtest, not only sub-28-day ranges — the deals still
  appeared in the yearly bucket, leaving a yearly total with no matching monthly row.

## [1.6.4] - 2026-06-11

### Fixed
- DIV indicator logic

## [1.6.3] - 2026-06-10

### Changed
- DCA/combo per-bar deal processing performance.

## [1.6.2] - 2026-06-06

### Changed
- Expose order origin. 

## [1.6.1] - 2026-04-06

### Changed
- Long Wick logic

## [1.6.0] - 2026-04-03

### Added
- Long Wick
- Session

## [1.5.2] - 2026-03-02

### Changed 
- Kraken support

## [1.5.1] - 2026-02-09

### Fixed 
- Short required change calculation

## [1.5.0] - 2026-01-15

### Added 
- Separate max deal limits when using dynamic price filter over and under

## [1.4.6] - 2026-01-12

### Fixed 
- Wrong combined profit hedge bot.
- Wrong close time by combined settings. 

## [1.4.5] - 2026-01-06

### Fixed 
- Wrong candle combinations when have multiple exchanges. 

## [1.4.4] - 2025-12-23

### Fixed 
- AVP issue with group and section indicator logic

## [1.4.3] - 2025-12-17

### Fixed 
- AVP ignored when have another SL indicator

## [1.4.2] - 2025-11-12

### Fixed 
- Wrong order of DCA by indicators

## [1.4.1] - 2025-11-06

### Fixed 
- Stop loss with AVP

## [1.4.0] - 2025-11-05

### Added 
- Fixed Stop Loss in Risk Reward

## [1.3.3] - 2025-10-27

### Fixed 
- Trailing TP

## [1.3.2] - 2025-10-20

### Fixed 
- Hyperliquid USD rates

## [1.3.1] - 2025-10-16

### Fixed 
- Multi TP/ Multi SL processing

## [1.3.0] - 2025-10-09

### Added 
- Order Blocks & Fair Value Gaps (FVG only)

## [1.2.2] - 2025-09-30

### Changed 
- DCA settings update

## [1.2.1] - 2025-09-30

### Fixed 
- Find USD rate for USDC pairs

## [1.2.0] - 2025-09-24

### Added
- Hyperliquid integration

## [1.1.3] - 2025-09-23

### Changed
- Indicators update (QFL fix)

## [1.1.2] - 2025-09-22

### Fixed
- Hedge backtest with different symbols
- Load many candles

## [1.1.1] - 2025-09-05

### Changed
- Indicators update (QFL fix)

## [1.1.0] - 2025-09-04

### Changed
- Hedge backtest

## [1.0.10] - 2025-08-19

### Fixed
- Indicators (Donchian Channels offset)

## [1.0.9] - 2025-07-18

### Fixed
- Set maximum size exceeded

## [1.0.8] - 2025-07-02

### Changed
- Updated all dependencies to their latest versions
- Updated package-lock.json with latest dependency versions

### Fixed
- Fixed Prettier configuration and formatting issues

## [1.0.7] - 2025-06-30

### Changed
- Migrated package manager from Yarn to npm
- Removed yarn.lock in favor of package-lock.json
- Updated npm scripts to use npm instead of yarn commands
- Updated dependency management scripts for npm compatibility

## [1.0.6] - 2025-06-30

### Added
- Initial release of Gainium Backtester
- Professional backtesting engine for trading strategies
- Support for DCA (Dollar Cost Averaging) strategies
- Support for Grid trading strategies
- TypeScript support with comprehensive type definitions
- High-performance backtesting capabilities
- Integration with @gainium/indicators library
