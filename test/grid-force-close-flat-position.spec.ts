import { describe, it, before } from 'mocha'
import { expect } from 'chai'

import GRIDBacktesting from '../src/grid'
import { ExchangeEnum, ExchangeIntervals } from '../src/types'
import type { FullBar, Settings, Symbols } from '../src/types'

/**
 * spec 006 — a force close that lands on a flat position contributes no
 * profit, instead of dividing by an entry price of 0 and turning every
 * reported figure into NaN.
 *
 * Settings are the reporter's, verbatim from the attached
 * `backtest-ARKUSDT.json` (binanceUsdm futures grid, geometric, 21 levels,
 * range 0.12231-0.20859, `tpSl`+`sl` both `priceReached`, both `stopAndSell`,
 * LONG / NEUTRAL). Only `tpTopPrice`/`slLowPrice` move between runs, to steer
 * *when* the stop fires; the grid itself is identical throughout.
 */

const PAIR = 'ARKUSDT'

const symbol: Symbols = {
  pair: PAIR,
  exchange: ExchangeEnum.binanceUsdm,
  baseAsset: { minAmount: 0.1, maxAmount: 1e9, step: 0.1, name: 'ARK' },
  quoteAsset: { minAmount: 5, name: 'USDT' },
  maxOrders: 200,
  priceAssetPrecision: 5,
} as never

const baseSettings = {
  topPrice: 0.20859,
  lowPrice: 0.12231,
  levels: 21,
  gridStep: '2.68',
  budget: 300,
  useOrderInAdvance: false,
  prioritize: 'level',
  profitCurrency: 'quote',
  orderFixedIn: 'base',
  sellDisplacement: 0.04,
  gridType: 'geometric',
  tpSl: true,
  tpSlCondition: 'priceReached',
  tpPerc: 10,
  slPerc: -100,
  tpTopPrice: '0.20859',
  slLowPrice: '0.12231',
  tpSlAction: 'stopAndSell',
  slCondition: 'priceReached',
  slAction: 'stopAndSell',
  useStartPrice: false,
  marginType: 'isolated',
  leverage: 1,
  futures: true,
  coinm: false,
  newProfit: true,
  strategy: 'LONG',
  futuresStrategy: 'NEUTRAL',
  feeOrder: true,
  ordersInAdvance: 3,
  tpSlLimit: false,
  slLimit: false,
  sl: true,
  startPrice: '',
  skipBalanceCheck: false,
  pair: PAIR,
  name: 'ARK Natural',
}

const T0 = 1789344000000
const MIN = 60000

/** one bar per close, opening at the previous close */
const series = (path: number[]): FullBar[] =>
  path.map((p, i) => {
    const prev = i === 0 ? p : path[i - 1]
    return {
      open: prev,
      high: Math.max(p, prev),
      low: Math.min(p, prev),
      close: p,
      volume: 1000,
      time: T0 + i * MIN,
      symbol: PAIR,
    } as FullBar
  })

/**
 * Dips below the start price so buy levels fill, recovers so those legs are
 * all matched (net position back to 0 from bar 9), then rises. Between 0.136
 * and the first sell level near 0.1385 the bot is flat with profit booked —
 * that is the window spec 006 §1.1 is about.
 */
const dipRecoverRise = series([
  0.1343, 0.133, 0.131, 0.1295, 0.128, 0.1295, 0.131, 0.133, 0.1343, 0.136,
  0.1343, 0.133, 0.1343, 0.136, 0.138, 0.14, 0.142, 0.144, 0.1455, 0.146,
])

type Close = { action: string; price: number; bar: number; qty: number }

/** runs the engine, recording the position as each `closeBot` saw it */
async function run(overrides: Record<string, unknown> = {}) {
  const bt = new GRIDBacktesting({
    exchange: ExchangeEnum.binanceUsdm,
    symbols: [symbol],
    interval: ExchangeIntervals.oneM,
    userFee: 0.0004,
    prices: [
      { symbol: PAIR, price: dipRecoverRise[dipRecoverRise.length - 1].close },
    ],
    settings: { ...baseSettings, ...overrides } as unknown as Settings,
    fullResult: true,
  } as never)
  const strategy = (bt as unknown as { strategy: Record<string, unknown> })
    .strategy
  const closes: Close[] = []
  const original = strategy['closeBot'] as (...a: unknown[]) => unknown
  strategy['closeBot'] = function (
    this: { position: { qty: number } },
    price: number,
    time: number,
    action: string,
  ) {
    closes.push({
      action,
      price,
      bar: (time - T0) / MIN,
      qty: this.position.qty,
    })
    return original.call(this, price, time, action)
  }
  const result = (await bt.test(dipRecoverRise)) as never as {
    transaction: { profit: number | string }[]
    financial: Record<string, string | number>
    numerical: Record<string, number>
  }
  return { closes, result }
}

describe('spec 006 — grid force close on a flat position', () => {
  describe('the stop lands on a flat position mid-run (§1.1)', () => {
    let closes: Close[]
    let result: Awaited<ReturnType<typeof run>>['result']

    before(async () => {
      // 0.1375 sits in the flat window: above the 0.136 that matched the last
      // open leg, below the sell level near 0.1385 that would open a new one.
      ;({ closes, result } = await run({ tpTopPrice: '0.1375' }))
    })

    it('stops with no open position', () => {
      expect(closes).to.have.lengthOf(1)
      expect(closes[0].action).to.equal('tp')
      expect(closes[0].qty).to.equal(0)
    })

    it('keeps the profit the run earned before the stop', () => {
      expect(result.transaction.length).to.be.greaterThan(0)
      const booked = result.transaction.reduce((a, t) => a + +t.profit, 0)
      expect(booked).to.be.greaterThan(0)
      expect(+result.financial.profitTotal).to.be.closeTo(booked, 0.05)
    })

    it('reports finite figures, not NaN rounded to zero', () => {
      for (const key of [
        'profitTotal',
        'profitTotalUsd',
        'valueChange',
        'currentBalances',
        'currentBalancesUsd',
      ]) {
        expect(Number.isNaN(+result.financial[key]), `${key} is NaN`).to.equal(
          false,
        )
      }
      expect(+result.financial.currentBalances).to.be.greaterThan(
        +result.financial.initialBalances,
      )
    })

    it('books no transaction for the flat close', () => {
      const closeRows = result.transaction.filter(
        (t) =>
          (t as { idBuy?: string }).idBuy === 'position price' ||
          (t as { idSell?: string }).idSell === 'position price',
      )
      expect(closeRows).to.have.lengthOf(0)
      expect(result.numerical.all).to.equal(result.transaction.length)
    })
  })

  describe('the stop fires before any order fills (§1.2)', () => {
    let closes: Close[]
    let result: Awaited<ReturnType<typeof run>>['result']

    before(async () => {
      // the reporter's own mistake: take-profit set to the grid's LOW price,
      // which the 0.1343 start price is already above, so it fires on bar 1.
      ;({ closes, result } = await run({
        tpTopPrice: '0.12231',
        slLowPrice: '0.20859',
      }))
    })

    it('stops on the first bar with nothing filled', () => {
      expect(closes).to.have.lengthOf(1)
      expect(closes[0].bar).to.equal(1)
      expect(result.transaction).to.have.lengthOf(0)
    })

    it('reports the untouched budget rather than a zero balance', () => {
      expect(Number.isNaN(+result.financial.currentBalances)).to.equal(false)
      expect(+result.financial.currentBalances).to.be.closeTo(
        +result.financial.initialBalances,
        0.05,
      )
      expect(+result.financial.profitTotal).to.equal(0)
    })
  })

  describe('a close with an open position is unchanged (§1.3)', () => {
    it('still accrues the force-close P&L and books its row', async () => {
      // 0.145 is above the sell levels, so the bot is short when it stops.
      const { closes, result } = await run({ tpTopPrice: '0.145' })
      expect(closes).to.have.lengthOf(1)
      expect(closes[0].qty).to.be.greaterThan(0)
      const closeRows = result.transaction.filter(
        (t) =>
          (t as { idBuy?: string }).idBuy === 'position price' ||
          (t as { idSell?: string }).idSell === 'position price',
      )
      expect(closeRows).to.have.lengthOf(1)
      const booked = result.transaction.reduce((a, t) => a + +t.profit, 0)
      expect(+result.financial.profitTotal).to.be.closeTo(booked, 0.05)
    })
  })
})
