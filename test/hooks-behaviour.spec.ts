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
  IndicatorAction,
  IndicatorEnum,
  IndicatorSection,
  IndicatorStartConditionEnum,
  IndicatorsLogicEnum,
  OrderSizeTypeEnum,
  OrderTypeEnum,
  StartConditionEnum,
  StrategyEnum,
} from '../src/types'
import type {
  DCABacktestHooks,
  DCABacktestingResult,
  DCABotSettings,
  FullBar,
  Symbols,
} from '../src/types'

/**
 * What the optional host hooks (1.8.0) do when a host answers or acts:
 * refuse an entry, hold a take-profit close signal, see every bar, change one
 * deal's settings, change the bot's settings for new deals only, close one
 * deal at a price.
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

const rsi = (
  id: string,
  action: IndicatorAction,
  condition: IndicatorStartConditionEnum,
  value: string,
  section?: IndicatorSection,
) =>
  ({
    type: IndicatorEnum.rsi,
    indicatorLength: 14,
    indicatorValue: value,
    indicatorCondition: condition,
    indicatorInterval: ExchangeIntervals.oneH,
    indicatorAction: action,
    groupId: `g-${id}`,
    uuid: `u-${id}`,
    ...(section ? { section } : {}),
  }) as never

const signalClose: Partial<DCABotSettings> = {
  startCondition: StartConditionEnum.ti,
  dealCloseCondition: CloseConditionEnum.techInd,
  indicators: [
    rsi('s', IndicatorAction.startDeal, IndicatorStartConditionEnum.lt, '40'),
    rsi(
      'c',
      IndicatorAction.closeDeal,
      IndicatorStartConditionEnum.gt,
      '60',
      IndicatorSection.tp,
    ),
  ],
  indicatorGroups: [
    {
      id: 'g-s',
      logic: IndicatorsLogicEnum.and,
      action: IndicatorAction.startDeal,
    },
    {
      id: 'g-c',
      logic: IndicatorsLogicEnum.and,
      action: IndicatorAction.closeDeal,
      section: IndicatorSection.tp,
    },
  ],
} as Partial<DCABotSettings>

let runNo = 0

function make(
  settings: Partial<DCABotSettings>,
  hooks?: (bt: () => DCABacktesting) => DCABacktestHooks,
) {
  StrategyContextManager.setActiveContext(`behaviour-${++runNo}`)
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
    ...(hooks ? { hooks: hooks(() => bt as DCABacktesting) } : {}),
  } as never)
  return bt
}

const run = async (bt: DCABacktesting) => {
  const r = (await bt.test([
    { bar: bars, interval: ExchangeIntervals.oneH },
  ])) as DCABacktestingResult
  // oldest first (the result lists deals by status / close order)
  r.deals.sort((a, b) => a.startTime - b.startTime)
  return r
}

describe('engine hooks — host answers and actions (1.8.0)', () => {
  it('a refused entry opens nothing; asked with the open price and bar time', async () => {
    const asked: { price: number; time: number; symbol: string }[] = []
    const result = await run(
      make({}, () => ({
        approveNewDeal: (ctx) => {
          asked.push(ctx)
          return false
        },
      })),
    )
    expect(result.deals.length).to.equal(0)
    expect(asked.length).to.be.greaterThan(10)
    const first = bars.find((b) => b.time === asked[0].time)
    expect(first, 'asked on a bar time').to.not.equal(undefined)
    expect(asked[0].price).to.be.closeTo(first!.close, 1e-3)
    expect(asked[0].symbol).to.equal(PAIR)
  })

  it('refusing every other entry opens fewer deals than the plain bot', async () => {
    const plain = await run(make({}))
    let n = 0
    const filtered = await run(
      make({}, () => ({ approveNewDeal: () => n++ % 2 === 1 })),
    )
    expect(filtered.deals.length).to.be.greaterThan(0)
    expect(filtered.deals.length).to.be.lessThan(plain.deals.length)
  })

  it('a held take-profit signal keeps the deal open; approvals close as usual', async () => {
    const plain = await run(make(signalClose))
    let asked = 0
    const held = await run(
      make(signalClose, () => ({
        approveDealClose: (ctx) => {
          asked++
          expect(ctx.trigger).to.equal('indicator')
          expect(ctx.dealId).to.be.a('string')
          return false
        },
      })),
    )
    expect(
      plain.deals.filter((d) => d.status === 'closed').length,
    ).to.be.greaterThan(2)
    expect(asked).to.be.greaterThan(0)
    // the only deal is never closed by its signal (no stop loss on this bot)
    expect(held.deals.filter((d) => d.status === 'closed').length).to.equal(0)
  })

  it('afterBar sees every bar time once, in order, after the engine processed it', async () => {
    const times: number[] = []
    await run(
      make({}, () => ({
        afterBar: (ctx) => {
          times.push(ctx.time)
          expect(ctx.interval).to.equal(ExchangeIntervals.oneH)
        },
      })),
    )
    expect(times.length).to.be.greaterThan(bars.length - 5)
    for (let i = 1; i < times.length; i++)
      expect(times[i]).to.be.greaterThan(times[i - 1])
  })

  it('hostSetDealSettings: a lower take profit on one deal closes it at that level', async () => {
    let target: string | null = null
    const result = await run(
      make({ useDca: false }, (bt) => ({
        afterBar: (ctx) => {
          if (target) return
          const open = bt().hostOpenDeals()[0]
          if (!open) return
          target = open.id
          expect(
            bt().hostSetDealSettings(open.id, { tpPerc: '0.5' }, ctx.time),
          ).to.equal(true)
          const tp = bt()
            .hostOpenDeals()[0]
            .activeOrders.find((o) => o.type === DCAOrderTypeEnum.tp)
          expect(tp!.price).to.be.lessThan(open.avgPrice * 1.008)
        },
      })),
    )
    const deal = result.deals.find((d) => d.status === 'closed')!
    expect(deal.profit.perc).to.be.lessThan(1)
    expect(deal.profit.perc).to.be.greaterThan(0)
    // the next deal is back on the bot's 2 %
    const next = result.deals.filter((d) => d.status === 'closed')[1]
    expect(next.profit.perc).to.be.greaterThan(1.5)
  })

  it('hostSetDealSettings: switching a stop on for one deal (bot stop off) closes it at the stop', async () => {
    let done = false
    const result = await run(
      make({ useDca: false, tpPerc: '30' }, (bt) => ({
        afterBar: (ctx) => {
          if (done) return
          const open = bt().hostOpenDeals()[0]
          if (!open) return
          done = true
          bt().hostSetDealSettings(
            open.id,
            { useSl: true, slPerc: '-1' },
            ctx.time,
          )
        },
      })),
    )
    const first = result.deals[0]
    expect(first.status).to.equal('closed')
    expect(first.profit.perc).to.be.lessThan(-0.9)
    expect(first.profit.perc).to.be.greaterThan(-2)
  })

  it("hostSetDealSettings: a deal's stop switched on as a price stop fires even when the bot's stop condition is not price", async () => {
    // the bot's stop is off and its stored close condition is 'manual' (what a
    // form keeps while the stop is off); the host sets the deal's own condition
    const switchOn = (override: Record<string, unknown>) => {
      let done = false
      return run(
        make(
          {
            useDca: false,
            tpPerc: '30',
            dealCloseConditionSL: CloseConditionEnum.manual,
          },
          (bt) => ({
            afterBar: (ctx) => {
              if (done) return
              const open = bt().hostOpenDeals()[0]
              if (!open) return
              done = true
              bt().hostSetDealSettings(open.id, override, ctx.time)
            },
          }),
        ),
      )
    }
    const priced = await switchOn({
      useSl: true,
      slPerc: '-1',
      dealCloseConditionSL: CloseConditionEnum.tp,
    })
    expect(priced.deals[0].status).to.equal('closed')
    expect(priced.deals[0].profit.perc).to.be.lessThan(-0.9)
    // the deal's condition still says manual: its percent stop does not fire
    const manual = await switchOn({ useSl: true, slPerc: '-1' })
    expect(manual.deals[0].profit.perc).to.not.be.lessThan(-0.9)
  })

  it('hostSetBotSettings changes new deals only; the open deal keeps its take profit', async () => {
    let changedAt = 0
    let openTp = 0
    let openId = ''
    const result = await run(
      make({ useDca: false }, (bt) => ({
        afterBar: (ctx) => {
          if (changedAt) return
          const open = bt().hostOpenDeals()[0]
          if (!open) return
          changedAt = ctx.time
          openId = open.id
          openTp = open.activeOrders.find(
            (o) => o.type === DCAOrderTypeEnum.tp,
          )!.price
          bt().hostSetBotSettings({ tpPerc: '4' })
          const after = bt()
            .hostOpenDeals()[0]
            .activeOrders.find((o) => o.type === DCAOrderTypeEnum.tp)!.price
          expect(after).to.equal(openTp)
          expect(bt().hostSettings().tpPerc).to.equal('4')
        },
      })),
    )
    const closed = result.deals.filter((d) => d.status === 'closed')
    expect(closed[0].profit.perc).to.be.lessThan(2.5)
    expect(closed[1].profit.perc).to.be.greaterThan(3.5)
    expect(openId).to.not.equal('')
  })

  it('hostCloseDeal closes one deal at the given price', async () => {
    let closedAt = 0
    let price = 0
    const result = await run(
      make({ useDca: false, tpPerc: '30' }, (bt) => ({
        afterBar: (ctx) => {
          if (closedAt) return
          const open = bt().hostOpenDeals()[0]
          if (!open || ctx.time < open.startTime + 5 * HOUR) return
          closedAt = ctx.time
          price = bars.find((b) => b.time === ctx.time)!.close
          expect(bt().hostCloseDeal(open.id, price, ctx.time + HOUR)).to.equal(
            true,
          )
          expect(bt().hostOpenDeals().length).to.equal(0)
        },
      })),
    )
    const first = result.deals[0]
    expect(first.status).to.equal('closed')
    // rounded to the pair's price precision, like any close
    expect(first.closePrice).to.be.closeTo(price, 1e-4)
  })
})
