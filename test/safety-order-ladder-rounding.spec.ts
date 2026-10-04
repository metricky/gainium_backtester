import { describe, it } from 'mocha'
import { expect } from 'chai'

import DCABotFunctions from '../src/helper/dcaBotFunctions'
import {
  DCAOrderTypeEnum,
  StrategyEnum,
  OrderSizeTypeEnum,
  CloseConditionEnum,
  DCAConditionEnum,
  ScaleDcaTypeEnum,
} from '../src/types'
import type { DCABotSettings, Symbols } from '../src/types'

/**
 * spec 007 — a percentage safety-order ladder must not accumulate rounding
 * error across levels.
 *
 * Level `i` is configured at `step × Σ scale^k` (k < i) of the start price
 * below it. Rounding each level to the tick and then stepping the next one off
 * the ROUNDED price carries every level's rounding into all the levels after
 * it; on a coarse tick (0.001 at a price near 0.25) a 30 × 1% ladder ended
 * 24-36% below the start instead of 30%.
 */

const settings = {
  strategy: StrategyEnum.long,
  futures: false,
  coinm: false,
  leverage: 1,
  orderSizeType: OrderSizeTypeEnum.quote,
  baseOrderSize: '10',
  orderSize: '10',
  ordersCount: 30,
  activeOrdersCount: 30,
  step: '1',
  stepScale: '1',
  volumeScale: '1',
  tpPerc: '1',
  slPerc: '-10',
  useTp: true,
  useSl: false,
  useDca: true,
  dcaCondition: DCAConditionEnum.percentage,
  scaleDcaType: ScaleDcaTypeEnum.percentage,
  dealCloseCondition: CloseConditionEnum.tp,
  dealCloseConditionSL: CloseConditionEnum.tp,
  indicators: [],
  indicatorGroups: [],
} as unknown as DCABotSettings

// Kraken 0G/USD shape: price tick 0.001, a price near 0.25.
const TICK = 0.001
const symbol = {
  pair: '0G-USD',
  baseAsset: { name: '0G', minAmount: 0, maxAmount: 1e9, step: 0.01 },
  quoteAsset: { name: 'USD', minAmount: 0, maxAmount: 1e9, step: 0.01 },
  priceAssetPrecision: 3,
} as unknown as Symbols

const safetyOrders = (s: Partial<DCABotSettings>, start: number) =>
  new DCABotFunctions({ ...settings, ...s } as DCABotSettings, symbol, 0.001)
    .createOrders(1, start, true)
    .filter((o) => o.type === DCAOrderTypeEnum.dca)
    .sort((a, b) => a.levelNumber! - b.levelNumber!)

/** Where level `i` belongs before any rounding. */
const target = (start: number, step: number, scale: number, i: number) => {
  let cumulative = 0
  for (let k = 0; k < i; k++) cumulative += scale ** k
  return start * (1 - step * cumulative)
}

describe('percentage safety-order ladder rounding', () => {
  // §1.1 — the reported case: 30 × 1% at tick 0.001. Before the fix the
  // 30th level sat 24.10% below at 0.249 and ~35.4% below at 0.2503-0.254.
  it('keeps every level of 30 × 1% within one tick of its configured price', () => {
    const drift: string[] = []

    for (const start of [0.249, 0.25, 0.2503, 0.2512, 0.252, 0.2535, 0.254]) {
      const orders = safetyOrders({}, start)
      expect(orders.length, `levels built at ${start}`).to.equal(30)
      orders.forEach((o, idx) => {
        const want = target(start, 0.01, 1, idx + 1)
        if (Math.abs(o.price - want) > TICK + 1e-12) {
          drift.push(`${start} SO${idx + 1}: ${o.price} vs ${want.toFixed(5)}`)
        }
      })
    }

    expect(drift, drift.slice(0, 6).join(' | ')).to.deep.equal([])
  })

  // §1.1 — step scale compounds the distance; the level still has to land on it.
  it('keeps a scaled ladder (1% × 1.05) within one tick', () => {
    const orders = safetyOrders({ ordersCount: 20, stepScale: '1.05' }, 0.254)
    orders.forEach((o, idx) =>
      expect(o.price, `SO${idx + 1}`).to.be.closeTo(
        target(0.254, 0.01, 1.05, idx + 1),
        TICK + 1e-12,
      ),
    )
  })

  // §1.1 — mirrored for a short ladder above the start.
  it('keeps a short ladder within one tick', () => {
    const orders = safetyOrders({ strategy: StrategyEnum.short }, 0.254)
    expect(orders.length).to.equal(30)
    orders.forEach((o, idx) =>
      expect(o.price, `SO${idx + 1}`).to.be.closeTo(
        0.254 * (1 + 0.01 * (idx + 1)),
        TICK + 1e-12,
      ),
    )
  })

  // §1.2 — a step smaller than one tick must still give strictly separated
  // levels, each one tick beyond the last, never one that climbs back.
  it('still separates levels when the step is under one tick', () => {
    for (const strategy of [StrategyEnum.long, StrategyEnum.short]) {
      const orders = safetyOrders(
        { step: '0.1', ordersCount: 10, strategy },
        0.25,
      )
      const dir = strategy === StrategyEnum.long ? -1 : 1
      let prev = 0.25
      for (const o of orders) {
        expect(
          dir * (o.price - prev),
          `${strategy} ${o.price} after ${prev}`,
        ).to.be.greaterThan(TICK / 2)
        prev = o.price
      }
    }
  })
})
