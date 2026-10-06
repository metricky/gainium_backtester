import { describe, it } from 'mocha'
import { expect } from 'chai'

import DCABacktesting from '../src/dca'
import { StrategyContextManager } from '../src/dca/strategy/context'
import {
  CloseConditionEnum,
  DCAConditionEnum,
  DCAOrderTypeEnum,
  ExchangeEnum,
  ExchangeIntervals,
  OrderSizeTypeEnum,
  OrderTypeEnum,
  StartConditionEnum,
  StrategyEnum,
} from '../src/types'
import type {
  DCABacktestHooks,
  DCABacktestingResult,
  DCABotSettings,
  Deal,
  FullBar,
  Symbols,
} from '../src/types'

/**
 * 1.9.0 host hooks: a size multiplier on an approved entry scales the new
 * deal's base order and every safety order (base / quote / usd size types,
 * DCA and Combo); `hostRequestEntry` lets a host attempt an entry at a later
 * bar through every engine gate.
 */

const HOUR = 3600e3
const FROM = Date.UTC(2026, 0, 1)
const PAIR = 'AAA_USDT'

const symbol: Symbols = {
  pair: PAIR,
  exchange: ExchangeEnum.binance,
  baseAsset: { name: 'AAA', minAmount: 0.0001, maxAmount: 1e9, step: 0.0001 },
  quoteAsset: { name: 'USDT', minAmount: 1 },
  maxOrders: 200,
  priceAssetPrecision: 4,
}

const bars: FullBar[] = Array.from({ length: 600 }, (_, i) => {
  const p = (k: number) =>
    100 + 12 * Math.sin(k / 23) + 4 * Math.sin(k / 5) + k * 0.01
  const open = p(i - 1)
  const close = p(i)
  return {
    time: FROM + i * HOUR,
    open,
    close,
    high: Math.max(open, close) + 0.6,
    low: Math.min(open, close) - 0.6,
    volume: 1000,
    symbol: PAIR,
  }
})

const base = {
  name: 'hooks',
  pair: [PAIR],
  strategy: StrategyEnum.long,
  futures: false,
  coinm: false,
  leverage: 1,
  profitCurrency: 'quote',
  orderSizeType: OrderSizeTypeEnum.quote,
  orderFixedIn: 'quote',
  baseOrderSize: '100',
  orderSize: '100',
  startOrderType: OrderTypeEnum.market,
  startCondition: StartConditionEnum.asap,
  dcaCondition: DCAConditionEnum.percentage,
  scaleDcaType: 'percentage',
  useDca: true,
  ordersCount: 4,
  activeOrdersCount: 4,
  step: '1.5',
  stepScale: '1.2',
  volumeScale: '1.3',
  minimumDeviation: '0',
  useTp: true,
  tpPerc: '2',
  useSl: false,
  slPerc: '-12',
  dealCloseCondition: CloseConditionEnum.tp,
  dealCloseConditionSL: CloseConditionEnum.tp,
  closeDealType: 'closeByMarket',
  maxNumberOfOpenDeals: '1',
  maxDealsPerPair: '1',
  indicators: [],
  indicatorGroups: [],
} as unknown as DCABotSettings

let runNo = 0
function make(
  settings: Partial<DCABotSettings>,
  hooks?: (bt: () => DCABacktesting) => DCABacktestHooks,
  combo = false,
) {
  StrategyContextManager.setActiveContext(`size-${++runNo}`)
  let bt: DCABacktesting | null = null
  bt = new DCABacktesting({
    exchange: ExchangeEnum.binance,
    symbols: [symbol],
    interval: ExchangeIntervals.oneH,
    userFee: 0.001,
    prices: [{ symbol: PAIR, price: 100 }],
    balances: [{ asset: 'USDT', free: '1000000', locked: '0' }] as never,
    from: FROM,
    to: FROM + bars.length * HOUR,
    settings: { ...base, ...settings } as DCABotSettings,
    fullResult: true,
    ...(combo ? { combo: true } : {}),
    ...(hooks ? { hooks: hooks(() => bt as DCABacktesting) } : {}),
  } as never)
  return bt
}

const run = async (bt: DCABacktesting) => {
  const r = (await bt.test([
    { bar: bars, interval: ExchangeIntervals.oneH },
  ])) as DCABacktestingResult
  r.deals.sort((a, b) => a.startTime - b.startTime)
  return r
}

const boQty = (d: Deal) =>
  d.filledOrders.find((o) => o.type === DCAOrderTypeEnum.bo)?.qty ?? 0
const dcaQtys = (d: Deal) =>
  d.initialOrders
    .filter((o) => o.type === DCAOrderTypeEnum.dca)
    .map((o) => o.qty)

const first = async (
  settings: Partial<DCABotSettings>,
  answer?: DCABacktestHooks['approveNewDeal'],
  combo = false,
) => {
  const seen = new Map<string, Deal>()
  const bt = make(
    settings,
    (get) => ({
      ...(answer ? { approveNewDeal: answer } : {}),
      afterBar: () => {
        for (const d of get().hostAllDeals())
          if (!seen.has(d.id)) seen.set(d.id, d)
      },
    }),
    combo,
  )
  await run(bt)
  return [...seen.values()].sort((a, b) => a.startTime - b.startTime)[0]
}

describe('engine hooks — deal size multiplier (1.9.0)', () => {
  for (const [label, s] of [
    ['quote', { orderSizeType: OrderSizeTypeEnum.quote }],
    [
      'base',
      {
        orderSizeType: OrderSizeTypeEnum.base,
        baseOrderSize: '1',
        orderSize: '1',
      },
    ],
    ['usd', { orderSizeType: OrderSizeTypeEnum.usd }],
  ] as [string, Partial<DCABotSettings>][]) {
    it(`DCA ${label}: ×2 doubles the base order and every safety order`, async () => {
      const plain = await first(s)
      const sized = await first(s, () => ({ approve: true, sizeMultiplier: 2 }))
      expect(plain, 'a deal opens').to.not.equal(undefined)
      expect(boQty(sized)).to.be.closeTo(2 * boQty(plain), 2e-4)
      const p = dcaQtys(plain)
      const q = dcaQtys(sized)
      expect(q.length).to.equal(p.length)
      expect(p.length).to.be.greaterThan(0)
      q.forEach((x, i) => expect(x).to.be.closeTo(2 * p[i], 2e-4))
      expect(sized.sizeMultiplier).to.equal(2)
      expect(sized.sizeScope).to.equal('whole')
      expect(plain.sizeMultiplier).to.equal(undefined)
    })
  }

  it('×0.5 halves the deal; a plain true / {approve:true} is the configured size', async () => {
    const plain = await first({})
    const half = await first({}, () => ({ approve: true, sizeMultiplier: 0.5 }))
    expect(boQty(half)).to.be.closeTo(0.5 * boQty(plain), 2e-4)
    const same = await first({}, () => ({ approve: true }))
    expect(boQty(same)).to.equal(boQty(plain))
    const bool = await first({}, () => true)
    expect(boQty(bool)).to.equal(boQty(plain))
  })

  it('outside 0.1–3, % of balance sizes and risk/reward sizing keep the configured size', async () => {
    const plain = await first({})
    const tooBig = await first({}, () => ({ approve: true, sizeMultiplier: 4 }))
    expect(boQty(tooBig)).to.equal(boQty(plain))
    expect(tooBig.sizeMultiplier).to.equal(undefined)
    const perc = {
      orderSizeType: OrderSizeTypeEnum.percFree,
      baseOrderSize: '1',
      orderSize: '1',
    }
    const pPlain = await first(perc)
    const pSized = await first(perc, () => ({
      approve: true,
      sizeMultiplier: 2,
    }))
    expect(boQty(pSized)).to.equal(boQty(pPlain))
  })

  it("scope 'base': only the base order scales, DCA orders keep their size", async () => {
    const plain = await first({})
    const sized = await first({}, () => ({
      approve: true,
      sizeMultiplier: 2,
      sizeScope: 'base',
    }))
    expect(boQty(sized)).to.be.closeTo(2 * boQty(plain), 2e-4)
    expect(dcaQtys(sized)).to.deep.equal(dcaQtys(plain))
    expect(sized.sizeScope).to.equal('base')
  })

  it('{approve:false} refuses like false', async () => {
    const r = await run(
      make({}, () => ({
        approveNewDeal: () => ({ approve: false, sizeMultiplier: 2 }),
      })),
    )
    expect(r.deals.length).to.equal(0)
  })

  it('Combo: ×2 doubles the base order and the safety levels', async () => {
    const combo = {
      gridLevel: '3',
      baseGridLevels: '3',
      comboTpBase: 'full',
    } as Partial<DCABotSettings>
    const plain = await first(combo, undefined, true)
    const sized = await first(
      combo,
      () => ({ approve: true, sizeMultiplier: 2 }),
      true,
    )
    expect(plain, 'a combo deal opens').to.not.equal(undefined)
    // Combo adds its fee allowance to the base order after sizing (not scaled)
    expect(boQty(sized) / boQty(plain)).to.be.closeTo(2, 0.005)
    const p = dcaQtys(plain)
    const q = dcaQtys(sized)
    expect(q.length).to.equal(p.length)
    q.forEach((x, i) => expect(x / p[i]).to.be.closeTo(2, 0.005))
    expect(sized.sizeMultiplier).to.equal(2)
  })
})

describe('engine hooks — hostRequestEntry (1.9.0)', () => {
  it('an entry the host requests at a later bar opens there, through the gates', async () => {
    const LATER = FROM + 30 * HOUR
    let requested = false
    const asked: number[] = []
    const r = await run(
      make(
        {
          startCondition: StartConditionEnum.ti,
          indicators: [],
          indicatorGroups: [],
        } as never,
        (bt) => ({
          approveNewDeal: (ctx) => {
            asked.push(ctx.time)
            return ctx.time >= LATER
          },
          afterBar: (ctx) => {
            if (!requested && ctx.time >= LATER) {
              requested = true
              expect(bt().hostRequestEntry(PAIR, ctx.time)).to.equal(true)
              // max deals 1: a second request is refused by the engine's own gate
              expect(bt().hostRequestEntry(PAIR, ctx.time)).to.equal(false)
            }
          },
        }),
      ),
    )
    expect(r.deals.length).to.be.greaterThan(0)
    expect(r.deals[0].startTime).to.equal(LATER)
  })
})
