import { describe, it } from 'mocha'
import { expect } from 'chai'

import GRIDBacktesting from '../src/grid'
import { ExchangeEnum, ExchangeIntervals } from '../src/types'
import type {
  FullBar,
  GridBacktestingResult,
  PreparedTransaction,
  Settings,
  Symbols,
} from '../src/types'

/**
 * spec 002 — a grid bot that stops on `priceReached` with
 * `tpSlAction: stopAndSell` force-closes its position; that close is a real
 * trade and must appear in the Transactions list.
 *
 * Settings are the reporter's, verbatim from the attached
 * `backtest-HEMIUSDT.json` (binanceUsdm futures, geometric, 20 levels,
 * tpTopPrice 0.005392). The bars are synthetic: they oscillate inside the grid
 * so levels fill and a position builds, then break out above `tpTopPrice`.
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

const baseSettings = {
  topPrice: '0.005392',
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
  tpTopPrice: '0.005392',
  slLowPrice: '0.004115',
  tpSlAction: 'stopAndSell',
  slCondition: 'priceReached',
  slAction: 'stopAndSell',
  useStartPrice: true,
  marginType: 'cross',
  leverage: 10,
  futures: true,
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
const BREAKOUT = 0.0055 // > tpTopPrice 0.005392

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

function bars(): FullBar[] {
  const data: FullBar[] = []
  let i = 0
  let prev = 0.004755
  data.push(bar(i++, prev, prev, prev, prev))
  const path = [
    0.00504, 0.005108, 0.005178, 0.00525, 0.005178, 0.005108, 0.00504, 0.005108,
    0.005178, 0.00525, 0.005178, 0.005108, 0.005178, 0.00525, 0.005322, 0.00525,
    0.005178, 0.00525, 0.005322,
  ]
  for (const p of path) {
    data.push(bar(i++, prev, Math.max(prev, p), Math.min(prev, p), p))
    prev = p
  }
  // price leaves the grid range upward -> tp priceReached -> stopAndSell
  data.push(bar(i++, prev, BREAKOUT, prev, BREAKOUT))
  data.push(bar(i++, BREAKOUT, 0.0056, 0.0054, 0.0056))
  return data
}

async function run(
  overrides: Partial<typeof baseSettings> = {},
): Promise<GridBacktestingResult> {
  const data = bars()
  const bt = new GRIDBacktesting({
    exchange: ExchangeEnum.binanceUsdm,
    symbols: [symbol],
    interval: ExchangeIntervals.oneM,
    userFee: 0.0005,
    prices: [{ symbol: PAIR, price: data[data.length - 1].close }],
    settings: { ...baseSettings, ...overrides } as unknown as Settings,
    fullResult: true,
  } as never)
  const result = (await bt.test(data)) as GridBacktestingResult
  expect(result, 'engine returned no result').to.not.equal(undefined)
  return result
}

const sumProfit = (r: GridBacktestingResult) =>
  r.transaction.reduce(
    (acc: number, t: PreparedTransaction) => acc + +t.profit,
    0,
  )

describe('grid — stopAndSell force close (spec 002)', () => {
  describe('futures (§1.1, §1.2, §3.1)', () => {
    it('emits a transaction for the force close, and the ledger reconciles with profitTotal', async () => {
      const r = await run()

      // the run must actually end on a force close, or the test proves nothing
      expect(
        r.position.count,
        'no position was force-closed',
      ).to.be.greaterThan(0)

      const closeRow = r.transaction.find(
        (t: PreparedTransaction) =>
          +t.priceSell === BREAKOUT || +t.priceBuy === BREAKOUT,
      )
      expect(
        closeRow,
        'no transaction recorded at the force-close price',
      ).to.not.equal(undefined)

      // §1.1 — the list reconciles with the reported total
      expect(sumProfit(r)).to.be.closeTo(+r.financial.profitTotal, 0.05)
    })

    it('records the force close as a loss carrying the accrued close P&L (§3.4)', async () => {
      const r = await run()
      const closeRow = r.transaction.find(
        (t: PreparedTransaction) =>
          +t.priceSell === BREAKOUT || +t.priceBuy === BREAKOUT,
      )
      expect(closeRow).to.not.equal(undefined)
      // grid was stopped above its range with a long position underwater
      // relative to the levels it filled: the close realizes a loss
      expect(+(closeRow as { profit: string }).profit).to.be.lessThan(0)
      // it is the last row of the ledger
      const maxIndex = Math.max(
        ...r.transaction.map((t: PreparedTransaction) => t.index),
      )
      expect((closeRow as { index: number }).index).to.equal(maxIndex)
    })

    it('leaves profitTotal and freeProfitTotal untouched (§3.3)', async () => {
      const r = await run()
      // these are the values the engine produced before the fix; the fix adds a
      // ledger row, it does not move any total
      expect(+r.financial.profitTotal).to.be.closeTo(-5, 0.2)
      expect(r.financial.freeProfitTotal).to.be.closeTo(1.9588, 0.01)
    })
  })

  describe('spot (§1.3, §3.2)', () => {
    it('does not fabricate a row for the spot close — its ledger already reconciles', async () => {
      const r = await run({ futures: false, leverage: 1 })
      expect(sumProfit(r)).to.be.closeTo(+r.financial.profitTotal, 0.05)
      const closeRow = r.transaction.find(
        (t: PreparedTransaction) =>
          +t.priceSell === BREAKOUT || +t.priceBuy === BREAKOUT,
      )
      expect(closeRow, 'spot close must not be ledgered').to.equal(undefined)
    })
  })
})
