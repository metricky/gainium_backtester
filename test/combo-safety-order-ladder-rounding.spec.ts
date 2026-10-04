import { describe, it } from 'mocha'
import { expect } from 'chai'

import ComboBotFunctions from '../src/helper/comboBotFunctions'
import {
  DCAOrderTypeEnum,
  StrategyEnum,
  OrderSizeTypeEnum,
  CloseConditionEnum,
  DCAConditionEnum,
  ScaleDcaTypeEnum,
} from '../src/types'
import type { DCABotSettings, DCAGrid, Symbols } from '../src/types'

/**
 * spec 008 — a combo bot's safety-order ladder must not accumulate rounding
 * error across levels (the combo copy of spec 007).
 *
 * Level `i` is configured at `step × Σ scale^k` (k < i) of the start price
 * beyond it. Stepping each level off the ROUNDED previous level carried every
 * level's rounding into all the levels after it; on a 0.001 tick near 0.25 a
 * 30 × 1% ladder ended 24.10-35.43% away instead of 30%.
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
  baseStep: '1',
  stepScale: '1',
  volumeScale: '1',
  gridLevel: '2',
  baseGridLevels: '2',
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

const build = (s: Partial<DCABotSettings>, start: number) =>
  new ComboBotFunctions(
    { ...settings, ...s } as DCABotSettings,
    symbol,
    0.001,
  ).createOrders(1, start, true)

const safetyOrders = (all: DCAGrid[]) =>
  all
    .filter((o) => o.type === DCAOrderTypeEnum.dca)
    .sort((a, b) => a.levelNumber! - b.levelNumber!)

/** Where level `i` belongs before any rounding. */
const target = (start: number, step: number, scale: number, i: number) => {
  let cumulative = 0
  for (let k = 0; k < i; k++) cumulative += scale ** k
  return start * (1 - step * cumulative)
}

describe('combo safety-order ladder rounding', () => {
  // §1.1 — the reported case: 30 × 1% at tick 0.001.
  it('keeps every level of 30 × 1% within one tick of its configured price', () => {
    const drift: string[] = []

    for (const start of [0.249, 0.25, 0.2503, 0.2512, 0.252, 0.2535, 0.254]) {
      const orders = safetyOrders(build({}, start))
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
    const orders = safetyOrders(
      build({ ordersCount: 20, stepScale: '1.05' }, 0.254),
    )
    orders.forEach((o, idx) =>
      expect(o.price, `SO${idx + 1}`).to.be.closeTo(
        target(0.254, 0.01, 1.05, idx + 1),
        TICK + 1e-12,
      ),
    )
  })

  // §1.1 — mirrored for a short ladder above the start.
  it('keeps a short ladder within one tick', () => {
    const orders = safetyOrders(build({ strategy: StrategyEnum.short }, 0.254))
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
        build({ step: '0.1', ordersCount: 10, strategy }, 0.25),
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
  // §1.3 — each mini-grid keeps its width, `step × scale^(i-1)` of the start
  // price, and starts from its own (now correctly placed) level.
  it('spans each mini-grid step × scale^(i-1) of the start from its own level', () => {
    for (const strategy of [StrategyEnum.long, StrategyEnum.short]) {
      const bot = new ComboBotFunctions(
        { ...settings, ordersCount: 10, stepScale: '1.05', strategy },
        symbol,
        0.001,
      )
      const ranges: { low: number; top: number }[] = []
      type CreateGridOrders = typeof bot.utils.createGridOrders
      const createGridOrders = bot.utils.createGridOrders.bind(
        bot.utils,
      ) as CreateGridOrders
      bot.utils.createGridOrders = ((
        s: Parameters<CreateGridOrders>[0],
        ...rest: unknown[]
      ) => {
        ranges.push({ low: +s.lowPrice, top: +s.topPrice })
        return (createGridOrders as (...a: unknown[]) => unknown)(s, ...rest)
      }) as CreateGridOrders
      const orders = safetyOrders(bot.createOrders(1, 0.254, true))
      expect(orders.length).to.equal(10)
      orders.forEach((o, idx) => {
        const width = 0.254 * 0.01 * 1.05 ** idx
        const [low, top] =
          strategy === StrategyEnum.long
            ? [o.price, o.price + width]
            : [o.price - width, o.price]
        expect(
          ranges.some(
            (r) =>
              Math.abs(r.low - low) < 1e-12 && Math.abs(r.top - top) < 1e-12,
          ),
          `${strategy} SO${idx + 1} mini-grid [${low}, ${top}]`,
        ).to.equal(true)
      })
    }
  })
})
