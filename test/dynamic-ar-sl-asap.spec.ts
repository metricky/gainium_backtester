import { describe, it } from 'mocha'
import { expect } from 'chai'

import DCABacktesting from '../src/dca'
import { ExchangeEnum, ExchangeIntervals } from '../src/types'
import type {
  DCABacktestingResult,
  DCABotSettings,
  FullBar,
  SettingsIndicators,
  Symbols,
} from '../src/types'

/**
 * A DCA bot that starts ASAP and whose only indicator is the ATR behind an
 * ATR/ADR stop loss (`dealCloseConditionSL: 'dynamicAr'`) must load that
 * indicator. Before the fix the strategy factory tested `dealCloseCondition`
 * (the TP condition) for the SL branch, so no indicator was evaluated, the
 * dynamic levels came back empty and every deal was refused — 0 deals.
 */

const PAIR = 'BTC-USDT'
const HOUR = 3600e3
const FROM = Date.UTC(2026, 0, 1)

const bars: FullBar[] = Array.from({ length: 600 }, (_, i) => {
  const time = FROM + i * HOUR
  const close = 100 + 18 * Math.sin(i / 17) + 5 * Math.sin(i / 3)
  const open = 100 + 18 * Math.sin((i - 1) / 17) + 5 * Math.sin((i - 1) / 3)
  return {
    time,
    open,
    close,
    high: Math.max(open, close) + 0.3,
    low: Math.min(open, close) - 0.3,
    volume: 1000,
    symbol: PAIR,
  } as FullBar
})

const symbol: Symbols = {
  pair: PAIR,
  exchange: ExchangeEnum.paperBinanceUsdm,
  baseAsset: { name: 'BTC', minAmount: 0, maxAmount: 1e6, step: 0.001 },
  quoteAsset: { name: 'USDT', minAmount: 0 },
  maxOrders: 200,
  priceAssetPrecision: 2,
}

const atr = (section: 'sl' | 'tp') =>
  ({
    type: 'ATR',
    groupId: `atr-${section}`,
    uuid: `atr-${section}`,
    indicatorLength: 14,
    indicatorInterval: '1h',
    indicatorAction: 'closeDeal',
    section,
    dynamicArFactor: '2',
    maUUID: null,
    xoUUID: null,
  }) as unknown as SettingsIndicators

const baseSettings = {
  pair: [PAIR],
  name: 'dynamic-ar-sl-asap',
  strategy: 'LONG',
  profitCurrency: 'quote',
  dcaCondition: 'percentage',
  scaleDcaType: 'percentage',
  startCondition: 'ASAP',
  startOrderType: 'MARKET',
  baseOrderSize: '10000',
  orderSize: '10000',
  orderSizeType: 'usd',
  orderFixedIn: 'quote',
  ordersCount: 1,
  activeOrdersCount: 1,
  step: '5',
  volumeScale: '1',
  stepScale: '1',
  minimumDeviation: '0',
  useDca: false,
  useTp: true,
  tpPerc: '2',
  dealCloseCondition: 'tp',
  useSl: false,
  // far from any 2×ATR distance on these bars, so an SL order at this level
  // would mean the ATR value was not used
  slPerc: '-20',
  dealCloseConditionSL: 'tp',
  closeDealType: 'closeByMarket',
  closeOrderType: 'MARKET',
  maxNumberOfOpenDeals: '1',
  maxDealsPerPair: '1',
  type: 'regular',
  marginType: 'isolated',
  leverage: 1,
  futures: true,
  indicatorGroups: [],
  indicators: [],
} as unknown as DCABotSettings

const run = async (settings: Partial<DCABotSettings>) => {
  const backtest = new DCABacktesting({
    settings: { ...baseSettings, ...settings },
    userFee: 0.0005,
    makerFee: 0.0005,
    takerFee: 0.0005,
    prices: [],
    balances: [],
    interval: ExchangeIntervals.oneH,
    from: FROM,
    to: FROM + bars.length * HOUR,
    slippage: 0,
    exchange: ExchangeEnum.paperBinanceUsdm,
    combo: false,
    symbols: [symbol],
  } as never)
  return (await backtest.test([
    { bar: bars, interval: ExchangeIntervals.oneH },
  ])) as DCABacktestingResult
}

describe('ATR/ADR stop loss on an ASAP-start DCA bot', () => {
  it('control: an ATR take profit on the same bot opens deals', async () => {
    const result = await run({
      dealCloseCondition: 'dynamicAr',
      indicators: [atr('tp')],
    } as unknown as Partial<DCABotSettings>)
    expect(result.deals.length).to.be.greaterThan(0)
  })

  it('opens deals when the only indicator is the ATR stop loss', async () => {
    const result = await run({
      useSl: true,
      dealCloseConditionSL: 'dynamicAr',
      indicators: [atr('sl')],
    } as unknown as Partial<DCABotSettings>)
    expect(result.deals.length).to.be.greaterThan(0)
    // the stop is placed from the ATR, not from the fixed slPerc fallback
    for (const deal of result.deals) {
      const sl = deal.ordersHistory.find((o) => o.type === 'SL order')
      expect(sl, `deal ${deal.number} has no SL order`).to.not.equal(undefined)
      expect(sl!.price).to.be.lessThan(deal.startPrice)
      expect(sl!.price).to.be.greaterThan(deal.startPrice * 0.85)
    }
  })
})
