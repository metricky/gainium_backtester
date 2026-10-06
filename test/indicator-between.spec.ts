import { describe, it } from 'mocha'
import { expect } from 'chai'

import DCABacktesting from '../src/dca'
import { StrategyContextManager } from '../src/dca/strategy/context'
import {
  CloseConditionEnum,
  DCAConditionEnum,
  ExchangeEnum,
  ExchangeIntervals,
  IndicatorAction,
  IndicatorEnum,
  IndicatorStartConditionEnum,
  IndicatorsLogicEnum,
  OrderSizeTypeEnum,
  OrderTypeEnum,
  StartConditionEnum,
  StrategyEnum,
} from '../src/types'
import type {
  DCABacktestingResult,
  DCABotSettings,
  FullBar,
  Symbols,
} from '../src/types'

/**
 * The "between" indicator condition (`bw`): one indicator, strictly between
 * indicatorValue and indicatorValue2, must behave exactly like the two-indicator
 * workaround (> lower AND < upper in one AND group).
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
  name: 'between',
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
  groupId: string,
  value2?: string,
) =>
  ({
    type: IndicatorEnum.rsi,
    indicatorLength: 14,
    indicatorValue: value,
    ...(value2 !== undefined ? { indicatorValue2: value2 } : {}),
    indicatorCondition: condition,
    indicatorInterval: ExchangeIntervals.oneH,
    indicatorAction: action,
    groupId,
    uuid: `u-${id}`,
  }) as never

const group = {
  id: 'g',
  logic: IndicatorsLogicEnum.and,
  action: IndicatorAction.startDeal,
}

const entry = (indicators: unknown[]): Partial<DCABotSettings> =>
  ({
    startCondition: StartConditionEnum.ti,
    indicators,
    indicatorGroups: [group],
  }) as Partial<DCABotSettings>

let runNo = 0

const run = async (settings: Partial<DCABotSettings>) => {
  StrategyContextManager.setActiveContext(`between-${++runNo}`)
  const bt = new DCABacktesting({
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
  } as never)
  const r = (await bt.test([
    { bar: bars, interval: ExchangeIntervals.oneH },
  ])) as DCABacktestingResult
  return r.deals.map((d) => d.startTime).sort((a, b) => a - b)
}

const { bw, gt, lt } = IndicatorStartConditionEnum
const start = IndicatorAction.startDeal

describe('indicator condition "between" (bw)', () => {
  it('opens the same deals as > lower AND < upper', async () => {
    const between = await run(entry([rsi('b', start, bw, '40', 'g', '60')]))
    const pair = await run(
      entry([rsi('l', start, gt, '40', 'g'), rsi('u', start, lt, '60', 'g')]),
    )
    expect(between.length).to.be.greaterThan(0)
    expect(between).to.deep.equal(pair)
  })

  it('is narrower than either bound alone', async () => {
    const between = await run(entry([rsi('b', start, bw, '40', 'g', '60')]))
    const above = await run(entry([rsi('l', start, gt, '40', 'g')]))
    const all = await run({})
    expect(between.length).to.be.lessThan(all.length)
    expect(above.length).to.be.at.least(between.length)
  })

  it('accepts the bounds in either order', async () => {
    const a = await run(entry([rsi('b', start, bw, '40', 'g', '60')]))
    const b = await run(entry([rsi('b', start, bw, '60', 'g', '40')]))
    expect(b).to.deep.equal(a)
  })

  it('never fires without an upper bound', async () => {
    expect(await run(entry([rsi('b', start, bw, '40', 'g')]))).to.deep.equal([])
    expect(
      await run(entry([rsi('b', start, bw, '40', 'g', '')])),
    ).to.deep.equal([])
  })
})
