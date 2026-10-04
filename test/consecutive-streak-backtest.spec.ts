import { describe, it } from 'mocha'
import { expect } from 'chai'

import DCABacktesting from '../src/dca'
import {
  CloseConditionEnum,
  DCAConditionEnum,
  ExchangeEnum,
  OrderTypeEnum,
  ExchangeIntervals,
  OrderSizeTypeEnum,
  StartConditionEnum,
  StrategyEnum,
  BotStartTypeEnum,
  CloseDCATypeEnum,
} from '../src/types'
import type { DCABotSettings, FullBar, Symbols } from '../src/types'

/**
 * End-to-end: "stop after X consecutive winning / losing deals" must actually
 * stop a BACKTEST, not just pass its unit test.
 *
 * `checkCloseAfterX` is private and runs inside `openDeal`, so the only honest
 * way to prove the wiring is to run the engine over candles and count the deals
 * it produced. Each case runs the SAME candles twice — once with the limit off,
 * once on — so the assertion is "the limit changed the outcome", not "some
 * number came back".
 */

const PAIR = 'BTC_USDT'
const MINUTE = 60_000
const START = Date.UTC(2026, 0, 1)

const symbol: Symbols = {
  pair: PAIR,
  exchange: ExchangeEnum.binance,
  baseAsset: { minAmount: 0.0001, maxAmount: 1e9, step: 0.0001, name: 'BTC' },
  quoteAsset: { minAmount: 1, name: 'USDT' },
  maxOrders: 200,
  priceAssetPrecision: 2,
}

const bar = (i: number, open: number, close: number): FullBar => ({
  time: START + i * MINUTE,
  open,
  high: Math.max(open, close),
  low: Math.min(open, close),
  close,
  volume: 1000,
  symbol: PAIR,
})

/**
 * A staircase: `cycles` legs of `stepPerc` in `direction`, each leg spread over
 * a few bars so a deal has a bar to open on before the move that ends it.
 *
 * Up legs take a 1% take profit, so every deal is a win. Down legs take a -1%
 * stop loss, so every deal is a loss. Either way the bot opens a fresh deal on
 * the next bar, which is what makes the deals CONSECUTIVE.
 */
const staircase = (cycles: number, stepPerc: number): FullBar[] => {
  const bars: FullBar[] = [bar(0, 100, 100)]
  let price = 100
  for (let c = 0; c < cycles; c++) {
    const next = price * (1 + stepPerc / 100)
    bars.push(bar(bars.length, price, price))
    bars.push(bar(bars.length, price, next))
    price = next
  }
  // Tail so the run does not end on the bar that closed the last deal.
  for (let i = 0; i < 5; i++) {
    bars.push(bar(bars.length, price, price))
  }
  return bars
}

const baseSettings = {
  name: 'streak',
  pair: [PAIR],
  strategy: StrategyEnum.long,
  futures: false,
  coinm: false,
  leverage: 1,
  orderSizeType: OrderSizeTypeEnum.quote,
  baseOrderSize: '100',
  orderSize: '100',
  startOrderType: OrderTypeEnum.market,
  startCondition: StartConditionEnum.asap,
  dcaCondition: DCAConditionEnum.percentage,
  useDca: false,
  ordersCount: 0,
  activeOrdersCount: 0,
  step: '1',
  stepScale: '1',
  volumeScale: '1',
  useTp: true,
  tpPerc: '1',
  useSl: false,
  slPerc: '-1',
  dealCloseCondition: CloseConditionEnum.tp,
  dealCloseConditionSL: CloseConditionEnum.tp,
  maxNumberOfOpenDeals: '1',
  maxDealsPerPair: '1',
  profitCurrency: 'quote',
  indicators: [],
  indicatorGroups: [],
  useBotController: true,
  botStart: BotStartTypeEnum.manual,
  botActualStart: BotStartTypeEnum.manual,
  stopType: CloseDCATypeEnum.leave,
} as unknown as DCABotSettings

const run = async (bars: FullBar[], overrides: Partial<DCABotSettings>) => {
  const backtester = new DCABacktesting({
    exchange: ExchangeEnum.binance,
    symbols: [symbol],
    interval: ExchangeIntervals.oneM,
    userFee: 0,
    prices: [{ symbol: PAIR, price: 100 }],
    balances: [{ asset: 'USDT', free: '100000', locked: '0' }] as never,
    from: bars[0].time,
    to: bars[bars.length - 1].time,
    settings: { ...baseSettings, ...overrides },
    fullResult: true,
  })
  const result = await backtester.test([
    { bar: bars, interval: ExchangeIntervals.oneM },
  ])
  return result?.deals?.length ?? 0
}

describe('consecutive win/loss limit — end to end', () => {
  it('a win streak stops the backtest, and the same candles run on without it', async () => {
    const bars = staircase(8, 1.2)

    const unlimited = await run(bars, {})
    expect(
      unlimited,
      'the candles must produce a run of wins to limit',
    ).to.be.at.least(4)

    const limited = await run(bars, {
      useCloseAfterXconsecutiveWin: true,
      closeAfterXconsecutiveWin: '2',
    })
    expect(limited).to.equal(2)
  })

  it('a loss streak stops the backtest', async () => {
    const bars = staircase(8, -1.2)
    const losing = {
      useTp: false,
      useSl: true,
      slPerc: '-1',
      tpPerc: '100',
    } as Partial<DCABotSettings>

    const unlimited = await run(bars, losing)
    expect(
      unlimited,
      'the candles must produce a run of losses to limit',
    ).to.be.at.least(4)

    const limited = await run(bars, {
      ...losing,
      useCloseAfterXconsecutiveLoss: true,
      closeAfterXconsecutiveLoss: '2',
    })
    expect(limited).to.equal(2)
  })

  it('a win limit does not fire on a run of losses', async () => {
    const bars = staircase(8, -1.2)
    const losing = {
      useTp: false,
      useSl: true,
      slPerc: '-1',
      tpPerc: '100',
    } as Partial<DCABotSettings>

    const unlimited = await run(bars, losing)
    const withWinLimit = await run(bars, {
      ...losing,
      useCloseAfterXconsecutiveWin: true,
      closeAfterXconsecutiveWin: '2',
    })
    expect(withWinLimit).to.equal(unlimited)
  })

  it('leaves the run alone when the bot controller is off', async () => {
    const bars = staircase(8, 1.2)

    const unlimited = await run(bars, {})
    const controllerOff = await run(bars, {
      useBotController: false,
      useCloseAfterXconsecutiveWin: true,
      closeAfterXconsecutiveWin: '2',
    })
    expect(controllerOff).to.equal(unlimited)
  })
})
