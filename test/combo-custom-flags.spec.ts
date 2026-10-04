import { describe, it } from 'mocha'
import { expect } from 'chai'
import { Strategy } from '../src/dca/strategy/main'
import { StrategyContextManager } from '../src/dca/strategy/context'
import {
  CloseConditionEnum,
  ExchangeEnum,
  ExchangeIntervals,
  OrderSizeTypeEnum,
  PositionSide,
  StartConditionEnum,
  StrategyEnum,
  TrailingModeEnum,
} from '../src/types'

// Real strategy methods, with only venue/order execution replaced.
class TestStrategy extends Strategy {
  async test() {}
  async preTest() {}
  async processBar() {}
  processTrade() {}
}

const PAIR = 'TEST_USDT'
let run = 0
const make = (name: string, combo = true, short = false): any => {
  StrategyContextManager.setActiveContext(`custom-flags-${++run}`)
  const bot = new TestStrategy({
    combo,
    exchange: ExchangeEnum.binance,
    interval: ExchangeIntervals.oneH,
    userFee: 0,
    prices: [{ symbol: PAIR, price: 100 }],
    balances: [],
    symbols: [
      {
        pair: PAIR,
        exchange: ExchangeEnum.binance,
        baseAsset: { name: 'TEST', minAmount: 0.001, step: 0.001 },
        quoteAsset: { name: 'USDT', minAmount: 1 },
        priceAssetPrecision: 4,
        maxOrders: 200,
      },
    ],
    settings: {
      name,
      pair: [PAIR],
      strategy: short ? StrategyEnum.short : StrategyEnum.long,
      futures: true,
      coinm: false,
      leverage: 1,
      profitCurrency: 'quote',
      orderSizeType: OrderSizeTypeEnum.quote,
      startCondition: StartConditionEnum.ti,
      useTp: true,
      tpPerc: '10',
      useSl: false,
      slPerc: '-10',
      dealCloseCondition: CloseConditionEnum.tp,
      dealCloseConditionSL: CloseConditionEnum.tp,
      indicators: [],
      indicatorGroups: [],
    },
  } as never) as any
  bot.getTP = () => [{ price: 100 }]
  bot.updatePositionWithOrder = () => {}
  return bot
}

const bar = (price: number): any => ({
  symbol: PAIR,
  time: 1,
  open: price,
  close: price,
  low: price - 20,
  high: price + 20,
})

describe('custom Combo backtest flags survive upstream merges', () => {
  for (const short of [false, true]) {
    for (const flag of ['', ' | LiqOff=0', ' | LiqOff=1']) {
      it(`${short ? 'short' : 'long'} liquidation ${flag || '(default)'}`, () => {
        const bot = make(`Combo${flag}`, true, short)
        Strategy.position.set(PAIR, {
          qty: 1,
          entryPrice: 100,
          liquidationPrice: short ? 110 : 90,
          side: short ? PositionSide.SHORT : PositionSide.LONG,
        })
        const original = Strategy.getDeals
        const closes: any[] = []
        Strategy.getDeals = () => [{ id: 'deal' }] as any
        bot.closeDeal = (...args: any[]) => closes.push(args)
        bot.processDealCloseFromMap = () => {}
        try {
          bot.checkPosition(bar(100))
          expect(closes).to.have.length(flag.includes('=1') ? 0 : 1)
        } finally {
          Strategy.getDeals = original
        }
      })
    }
  }

  it('keeps LiqOff isolated from ordinary DCA and refreshes Combo flags on updates', () => {
    const dca = make('DCA | LiqOff=1', false)
    expect(dca.settings.skipBalanceCheck).to.equal(undefined)
    const bot = make('Combo # LiqOff=1 TTP=1 TTPperc=20')
    expect(bot.settings.skipBalanceCheck).to.equal(true)
    bot.settingsUpdate = { ...bot.settings, name: 'Combo | LiqOff=0 TTP=0' }
    expect(bot.settings.skipBalanceCheck).to.equal(false)
    expect(bot.settings.trailingTp).to.equal(false)
  })

  it('keeps Combo TTP profit-percentage activation, peak and retrace', () => {
    const bot = make('Combo | TTP=1 TTPperc=20 LiqOff=1')
    const deal: any = {
      symbol: { pair: PAIR },
      avgPrice: 100,
      activeOrders: [],
      filledOrders: [],
      currentBalance: { base: 1, quote: 0 },
      initialBalance: { base: 0, quote: 100 },
      usage: { current: { base: 1, quote: 100 }, max: { base: 1, quote: 100 } },
      profit: { total: 0 },
    }
    expect(bot.getSLOrder(deal, bar(120)).order).to.equal(undefined)
    expect(deal.trailingMode).to.equal(TrailingModeEnum.ttp)
    expect(deal.bestPrice).to.equal(20)
    expect(deal.trailingLevel).to.equal(0)
    expect(bot.getSLOrder(deal, bar(150)).order).to.equal(undefined)
    expect(deal.bestPrice).to.equal(50)
    expect(deal.trailingLevel).to.equal(30)
    const result = bot.getSLOrder(deal, bar(129))
    expect(result.order.price).to.equal(130)
    expect(deal.bestPrice).to.equal(50)
  })

  it('respects the upstream per-deal Combo stop-loss settings', () => {
    const bot = make('Combo | TTP=1 TTPperc=20')
    bot.settings.dealCloseConditionSL = CloseConditionEnum.techInd
    const deal: any = {
      symbol: { pair: PAIR },
      avgPrice: 100,
      activeOrders: [],
      filledOrders: [],
      currentBalance: { base: 1, quote: 0 },
      initialBalance: { base: 0, quote: 100 },
      usage: {
        current: { base: 1, quote: 100 },
        max: { base: 1, quote: 100 },
      },
      profit: { total: 0 },
      settingsOverride: {
        useSl: true,
        slPerc: '-5',
        dealCloseConditionSL: CloseConditionEnum.tp,
      },
    }
    expect(bot.getSLOrder(deal, bar(90)).order.price).to.equal(95)
  })
})
