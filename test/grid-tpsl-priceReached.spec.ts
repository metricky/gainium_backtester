import { describe, it } from 'mocha'
import { expect } from 'chai'

import GRIDBacktesting from '../src/grid'
import { ExchangeEnum, ExchangeIntervals } from '../src/types'
import type { FullBar, Settings, Symbols } from '../src/types'

/**
 * spec 003 — `priceReached` take-profit and stop-loss are independent rules.
 *
 * Settings are the reporter's, verbatim from the attached
 * `backtest-HEMIUSDT.json` (binanceUsdm grid, geometric, 20 levels,
 * tpTopPrice 0.005392 / slLowPrice 0.004115, both `priceReached`, both
 * `stopAndSell`). The bars are synthetic: they oscillate inside the grid so
 * levels fill, then break out of the range.
 *
 * The runs are `futures:false, leverage:1` so that a liquidation can never be
 * the thing that stops the bot — the only close path exercised here is
 * `tpSl() -> closeBot()`.
 */

const PAIR = 'HEMIUSDT'

const symbol: Symbols = {
  pair: PAIR,
  exchange: ExchangeEnum.binanceUsdm,
  baseAsset: { minAmount: 1, maxAmount: 1e9, step: 1, name: 'HEMI' },
  quoteAsset: { minAmount: 5, name: 'USDT' },
  maxOrders: 200,
  priceAssetPrecision: 6,
}

const TOP = '0.005392'
const LOW = '0.004115'

const baseSettings = {
  topPrice: TOP,
  lowPrice: 0.004115,
  levels: 20,
  gridStep: 1.36,
  budget: 300,
  useOrderInAdvance: true,
  prioritize: 'level',
  profitCurrency: 'quote',
  orderFixedIn: 'base',
  sellDisplacement: 0.04,
  gridType: 'geometric',
  tpSl: true,
  tpSlCondition: 'priceReached',
  tpPerc: 10,
  slPerc: -10,
  tpTopPrice: TOP,
  slLowPrice: LOW,
  tpSlAction: 'stopAndSell',
  slCondition: 'priceReached',
  slAction: 'stopAndSell',
  useStartPrice: true,
  marginType: 'cross',
  leverage: 1,
  futures: false,
  coinm: false,
  newProfit: true,
  strategy: 'LONG',
  futuresStrategy: 'NEUTRAL',
  ordersInAdvance: 3,
  sl: true,
  startPrice: '0.004755',
  pair: PAIR,
  name: 'HEMI Natural',
}

const T0 = 1782950400000
const MIN = 60000

const bar = (i: number, o: number, h: number, l: number, c: number): FullBar =>
  ({
    open: o,
    high: h,
    low: l,
    close: c,
    volume: 1000,
    time: T0 + i * MIN,
    symbol: PAIR,
  }) as FullBar

/** a walk through `path` (one bar per close), then the literal `tail` bars */
function series(start: number, path: number[], tail: number[][]): FullBar[] {
  const data: FullBar[] = []
  let i = 0
  let prev = start
  data.push(bar(i++, prev, prev, prev, prev))
  for (const p of path) {
    data.push(bar(i++, prev, Math.max(prev, p), Math.min(prev, p), p))
    prev = p
  }
  for (const t of tail) {
    data.push(bar(i++, t[0], t[1], t[2], t[3]))
  }
  return data
}

type Close = { action: string; price: number; bar: number }

/**
 * Runs the engine and records every `closeBot` call. `closeBot` is private, so
 * it is shadowed on the instance — that is the only way to see *which* rule
 * stopped the bot, which is exactly what this spec is about.
 */
async function run(
  data: FullBar[],
  overrides: Record<string, unknown> = {},
): Promise<Close[]> {
  const bt = new GRIDBacktesting({
    exchange: ExchangeEnum.binanceUsdm,
    symbols: [symbol],
    interval: ExchangeIntervals.oneM,
    userFee: 0.0005,
    prices: [{ symbol: PAIR, price: data[data.length - 1].close }],
    settings: { ...baseSettings, ...overrides } as unknown as Settings,
    fullResult: true,
  } as never)
  const strategy = (bt as unknown as { strategy: Record<string, unknown> })
    .strategy
  const closes: Close[] = []
  const original = strategy['closeBot'] as (...a: unknown[]) => unknown
  strategy['closeBot'] = function (
    price: number,
    time: number,
    action: string,
  ) {
    closes.push({ action, price, bar: (time - T0) / MIN })
    return original.call(this, price, time, action)
  }
  await bt.test(data)
  return closes
}

// oscillates inside the range, then leaves it downward through slLowPrice
const breaksDown = series(
  0.004755,
  [
    0.00465, 0.004755, 0.00465, 0.00455, 0.00465, 0.00455, 0.00445, 0.00455,
    0.00445, 0.00435, 0.00445, 0.00435, 0.00425, 0.00435, 0.00425,
  ],
  [
    [0.00425, 0.00425, 0.0041, 0.0041],
    [0.0041, 0.0041, 0.00405, 0.00405],
    [0.00405, 0.00405, 0.00404, 0.00404],
  ],
)

// oscillates inside the range, then leaves it upward through tpTopPrice
const breaksUp = series(
  0.004755,
  [0.00504, 0.005108, 0.005178, 0.00525, 0.005178, 0.005108, 0.005178],
  [
    [0.005178, 0.0055, 0.005178, 0.0055],
    [0.0055, 0.0056, 0.0054, 0.0056],
  ],
)

describe('grid — priceReached tp/sl are independent rules (spec 003)', () => {
  describe('long (§1.1)', () => {
    it('evaluates the stop-loss even when a priceReached take-profit is configured', async () => {
      const closes = await run(breaksDown)
      expect(closes.length, 'the bot never stopped').to.be.greaterThan(0)
      expect(closes[0].action).to.equal('sl')
      expect(closes[0].price).to.be.at.most(+LOW)
    })

    it('stops at the same price whether or not the take-profit is switched on', async () => {
      const withTp = await run(breaksDown)
      const withoutTp = await run(breaksDown, { tpSl: false })
      expect(withoutTp.length, 'control run never stopped').to.equal(1)
      expect(withTp).to.deep.equal(withoutTp)
    })

    it('still stops on the take-profit when price leaves the range upward', async () => {
      const closes = await run(breaksUp)
      expect(closes.length).to.be.greaterThan(0)
      expect(closes[0].action).to.equal('tp')
      expect(closes[0].price).to.be.at.least(+TOP)
    })

    it('prefers the take-profit when an inverted config satisfies both rules', async () => {
      // tp at the bottom of the range, sl at the top: every in-range price
      // satisfies both. TP is checked first and must keep winning.
      const closes = await run(breaksUp, {
        tpTopPrice: LOW,
        slLowPrice: TOP,
      })
      expect(closes.length).to.be.greaterThan(0)
      expect(closes[0].action).to.equal('tp')
    })
  })

  describe('short (§1.2)', () => {
    const short = {
      strategy: 'SHORT',
      tpSl: false,
      sl: true,
      slCondition: 'priceReached',
      // for a short the adverse direction is up, so the stop sits above
      slLowPrice: TOP,
    }

    it('stops out when price rises through slLowPrice', async () => {
      const rises = series(
        0.004755,
        [0.004855, 0.004955, 0.005055, 0.004955, 0.005055, 0.005155],
        [
          [0.005155, 0.00545, 0.005155, 0.00545],
          [0.00545, 0.0055, 0.00545, 0.0055],
        ],
      )
      const closes = await run(rises, short)
      expect(closes.length, 'the bot never stopped').to.be.greaterThan(0)
      expect(closes[0].action).to.equal('sl')
      expect(closes[0].price).to.be.at.least(+TOP)
    })

    it('does not stop out while price stays below slLowPrice', async () => {
      const stays = series(
        0.004755,
        [0.004855, 0.004955, 0.005055, 0.004955, 0.005055, 0.004955],
        [],
      )
      const closes = await run(stays, short)
      expect(closes, 'stopped out in the profitable direction').to.deep.equal(
        [],
      )
    })
  })
})
