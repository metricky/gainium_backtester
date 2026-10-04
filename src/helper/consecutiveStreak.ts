/**
 * "Stop the bot after X consecutive winning / losing deals" — the ordering and
 * the streak test, kept apart from the engine so both can be pinned by a spec.
 *
 * This must stay behaviourally identical to the live bot engine's copy
 * (`main-app/core/src/bot/consecutiveStreak.ts`, fed by a `closeTime`-descending
 * read of the bot's closed deals). A backtest that disagrees with the live bot
 * about when a streak limit fires is worse than not having the limit.
 */

/**
 * A closed deal's outcome, `true` for one that closed in profit, ordered NEWEST
 * FIRST by the time the deal actually closed.
 *
 * The ordering is the point. `Strategy.getDeals('closed')` groups deals by
 * symbol, so its order reflects neither the order deals opened nor the order
 * they finished; a bot running several pairs closes them interleaved. A streak
 * only means anything in close order, so sort before reading it.
 *
 * `> 0` is a win and `<= 0` a loss — breakeven counts as a loss — matching the
 * split the cumulative `closeAfterXwin` / `closeAfterXloss` counters use, so a
 * bot with both kinds of limit never disagrees with itself about a deal.
 */
export const closedOutcomesNewestFirst = (
  deals: { closedTime?: number; profit: { totalUsd: number } }[],
): boolean[] =>
  deals
    .slice()
    .sort((a, b) => (b.closedTime ?? 0) - (a.closedTime ?? 0))
    .map((d) => d.profit.totalUsd > 0)

/**
 * Does the trailing run of `outcomes` consist of `target` deals that all went
 * the `win` way?
 *
 * Two things this deliberately does not do:
 *  - it does not fire on a shorter history. A bot whose whole history is 2 wins
 *    never trips a 3-win limit, even though every deal it closed was a win.
 *  - it does not look past `target`. One opposite outcome inside the window
 *    resets the streak — that reset is the whole difference between this and the
 *    cumulative `closeAfterXwin` / `closeAfterXloss` counters.
 *
 * `target <= 0` means the limit is off and never triggers.
 */
export const hasConsecutiveStreak = (
  outcomes: boolean[],
  win: boolean,
  target: number,
): boolean =>
  target > 0 &&
  outcomes.length >= target &&
  outcomes.slice(0, target).every((o) => o === win)
