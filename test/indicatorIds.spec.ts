import { describe, it } from 'mocha'
import { expect } from 'chai'

import DCABacktesting from '../src/dca'
import { withIndicatorIds } from '../src/helper/utils'
import { ExchangeEnum, ExchangeIntervals } from '../src/types'
import type {
  DCABacktestingResult,
  DCABotSettings,
  FullBar,
  SettingsIndicators,
  Symbols,
} from '../src/types'

/**
 * spec 005 — an indicator that reaches the engine without a `uuid` (a bot built
 * through the GraphQL API; the dashboard always assigns one) must be evaluated
 * exactly like the same indicator with an id.
 *
 * The bars are synthetic — a deterministic oscillation that walks RSI(14)
 * through the entry threshold repeatedly — so the suite needs no market data.
 */

const PAIR = 'BTC-USDT'
const HOUR = 3600e3
const FROM = Date.UTC(2026, 0, 1)

const bars: FullBar[] = Array.from({ length: 900 }, (_, i) => {
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

const rsiLow = {
  type: 'RSI',
  groupId: 'entry',
  uuid: 'rsi-low',
  indicatorLength: 14,
  indicatorValue: '35',
  indicatorCondition: 'lt',
  indicatorInterval: '1h',
  indicatorAction: 'startDeal',
  // real settings (dashboard or API) carry every field, nulled out — and it is
  // `maUUID: null` that the id-less indicator's own id collides with
  maUUID: null,
  xoUUID: null,
} as unknown as SettingsIndicators

// chosen so the AND is genuinely constraining: alone these two give 12 and 5
// deals over the fixture bars, together 8 — a collision between the two
// indicators therefore cannot pass for a correct AND
const rsiHigh = {
  ...rsiLow,
  uuid: 'rsi-high',
  indicatorLength: 7,
  indicatorValue: '25',
  indicatorCondition: 'gt',
} as unknown as SettingsIndicators

const baseSettings = {
  pair: [PAIR],
  name: 'spec-005',
  strategy: 'LONG',
  profitCurrency: 'quote',
  dcaCondition: 'percentage',
  scaleDcaType: 'percentage',
  startCondition: 'TechnicalIndicators',
  startDealLogic: 'and',
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
  useTp: true,
  tpPerc: '2',
  dealCloseCondition: 'tp',
  dealCloseConditionSL: 'tp',
  closeDealType: 'closeByMarket',
  closeOrderType: 'MARKET',
  maxNumberOfOpenDeals: '1',
  maxDealsPerPair: '1',
  type: 'regular',
  marginType: 'isolated',
  leverage: 1,
  futures: true,
  indicatorGroups: [
    { id: 'entry', logic: 'and', action: 'startDeal', section: null },
  ],
  indicators: [rsiLow],
} as unknown as DCABotSettings

const countDeals = async (indicators: SettingsIndicators[]) => {
  const backtest = new DCABacktesting({
    settings: { ...baseSettings, indicators },
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
  const result = (await backtest.test([
    { bar: bars, interval: ExchangeIntervals.oneH },
  ])) as DCABacktestingResult
  return result.deals.length
}

const withoutIds = (indicators: SettingsIndicators[]) =>
  indicators.map((i) => ({ ...i, uuid: null }) as unknown as SettingsIndicators)

describe('spec 005 — indicators that arrive without an id', () => {
  describe('the engine (§1.1, §1.2, §1.3)', () => {
    it('evaluates an indicator that arrives without an id (§1.1)', async () => {
      const withId = await countDeals([rsiLow])
      expect(withId).to.be.greaterThan(0)
      expect(await countDeals(withoutIds([rsiLow]))).to.equal(withId)
    })

    it('AND of two id-less indicators is still an AND (§1.3)', async () => {
      const withIds = await countDeals([rsiLow, rsiHigh])
      expect(withIds).to.be.greaterThan(0)
      // guard the fixture: the AND has to constrain, or a collision between the
      // two indicators would be indistinguishable from a correct evaluation
      expect(withIds).to.not.equal(await countDeals([rsiLow]))
      expect(withIds).to.not.equal(await countDeals([rsiHigh]))
      expect(await countDeals(withoutIds([rsiLow, rsiHigh]))).to.equal(withIds)
    })

    it('evaluates an indicator whose own id equals its maUUID (§1.2)', async () => {
      const withId = await countDeals([rsiLow])
      const collided = {
        ...rsiLow,
        uuid: 'q',
        maUUID: 'q',
      } as unknown as SettingsIndicators
      expect(await countDeals([collided])).to.equal(withId)
    })
  })

  describe('withIndicatorIds (§1.3, §1.4)', () => {
    const settingsWith = (uuids: (string | null)[]) =>
      ({
        indicators: uuids.map((uuid) => ({ uuid, type: 'RSI' })),
      }) as unknown as Pick<DCABotSettings, 'indicators'>

    it('gives indicators without an id distinct ids (§1.3)', () => {
      const { indicators } = withIndicatorIds(settingsWith([null, null, null]))
      const ids = indicators.map((i) => i.uuid)
      expect(new Set(ids).size).to.equal(3)
      expect(ids.every(Boolean)).to.equal(true)
    })

    it('leaves the ids the dashboard assigned alone', () => {
      const input = settingsWith(['a', 'b'])
      expect(withIndicatorIds(input)).to.equal(input)
    })

    it('only fills the gaps in a mixed list', () => {
      const { indicators } = withIndicatorIds(settingsWith(['a', null]))
      expect(indicators[0]!.uuid).to.equal('a')
      expect(indicators[1]!.uuid).to.not.equal('a')
    })

    it('never reuses an id an explicit uuid already took (§1.3)', () => {
      const { indicators } = withIndicatorIds(
        settingsWith(['indicator-1', null, null]),
      )
      expect(new Set(indicators.map((i) => i.uuid)).size).to.equal(3)
    })

    it('replaces the uuid field itself, not just the registration key (§1.4)', () => {
      const { indicators } = withIndicatorIds(settingsWith([null]))
      expect(indicators[0]!.uuid).to.be.a('string').and.not.equal('')
    })
  })
})
