import { describe, it } from 'mocha'
import { expect } from 'chai'

import {
  closedOutcomesNewestFirst,
  hasConsecutiveStreak,
} from '../src/helper/consecutiveStreak'

/**
 * "Stop the bot after X consecutive winning / losing deals" — the backtest must
 * fire the limit at the same point the live bot does.
 *
 * Two things can go wrong and both are silent:
 *  - counting cumulatively instead of consecutively, which makes the limit fire
 *    far too early (that is what `closeAfterXwin` / `closeAfterXloss` already
 *    do, and the whole point of the new setting is that it resets);
 *  - reading the deals in `Strategy.getDeals('closed')` order, which groups by
 *    symbol. On a multi-pair bot that order is neither open order nor close
 *    order, so the "streak" it reports is an artefact of the pair list.
 */

const deal = (closedTime: number, totalUsd: number) => ({
  closedTime,
  profit: { totalUsd },
})

const W = true
const L = false

describe('consecutive win/loss streak limit', () => {
  describe('ordering', () => {
    it('orders by close time, newest first', () => {
      const outcomes = closedOutcomesNewestFirst([
        deal(1_000, 5),
        deal(3_000, -5),
        deal(2_000, 5),
      ])
      expect(outcomes).to.deep.equal([L, W, W])
    })

    it('ignores the order the deals were handed over', () => {
      // A two-pair bot: BTC's deals are grouped ahead of ETH's regardless of
      // when either closed. In close order the run ends L, W — not W, W.
      const grouped = [
        deal(1_000, 5), // BTC deal 1
        deal(3_000, 5), // BTC deal 2
        deal(2_000, 5), // ETH deal 1
        deal(4_000, -5), // ETH deal 2 — closed last, and lost
      ]
      const outcomes = closedOutcomesNewestFirst(grouped)
      expect(outcomes).to.deep.equal([L, W, W, W])
      expect(hasConsecutiveStreak(outcomes, W, 3)).to.equal(false)
    })

    it('counts a breakeven deal as a loss', () => {
      expect(closedOutcomesNewestFirst([deal(1_000, 0)])).to.deep.equal([L])
    })

    it('does not mutate the array it is given', () => {
      const deals = [deal(1_000, 5), deal(3_000, -5), deal(2_000, 5)]
      const order = deals.map((d) => d.closedTime)
      closedOutcomesNewestFirst(deals)
      expect(deals.map((d) => d.closedTime)).to.deep.equal(order)
    })
  })

  describe('streak test', () => {
    it('fires when the last `target` deals all went the same way', () => {
      expect(hasConsecutiveStreak([W, W, W], W, 3)).to.equal(true)
      expect(hasConsecutiveStreak([L, L, L], L, 3)).to.equal(true)
    })

    it('ignores anything older than the window', () => {
      expect(hasConsecutiveStreak([W, W, W, L, W, L], W, 3)).to.equal(true)
    })

    it('resets on one opposite outcome inside the window', () => {
      expect(hasConsecutiveStreak([L, W, W], W, 3)).to.equal(false)
      expect(hasConsecutiveStreak([W, W, L], W, 3)).to.equal(false)
    })

    it('does not fire on a history shorter than the target', () => {
      expect(hasConsecutiveStreak([W, W], W, 3)).to.equal(false)
      expect(hasConsecutiveStreak([], W, 1)).to.equal(false)
    })

    it('never fires when the limit is off or unparseable', () => {
      expect(hasConsecutiveStreak([W, W, W], W, 0)).to.equal(false)
      expect(hasConsecutiveStreak([W, W, W], W, NaN)).to.equal(false)
    })
  })
})
