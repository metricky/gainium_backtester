import { describe, it } from 'mocha'
import { expect } from 'chai'

import DCABotFunctions from '../src/helper/dcaBotFunctions'
import BotUtils from '../src/helper/botUtils'
import {
  BotOrderSideEnum,
  DCAOrderTypeEnum,
  StrategyEnum,
  OrderSizeTypeEnum,
  CloseConditionEnum,
} from '../src/types'
import type { DCABotSettings, GridType, Symbols } from '../src/types'

/**
 * spec 004 — an order quantity that is already a whole number of lot steps
 * must not be rounded up by another whole lot.
 *
 * The settings and prices are the reporter's: a long BTCUSDT Binance USD-M
 * bot, 10 000 USDT order size, lot step 0.001, and the four candle opens their
 * 12-month backtest sized one lot above the budget.
 */

const settings = {
  strategy: StrategyEnum.long,
  futures: true,
  coinm: false,
  leverage: 1,
  orderSizeType: OrderSizeTypeEnum.usd,
  baseOrderSize: '10000',
  orderSize: '10000',
  ordersCount: 1,
  activeOrdersCount: 1,
  step: '5',
  stepScale: '1',
  volumeScale: '1',
  tpPerc: '99',
  slPerc: '-10',
  useTp: true,
  useSl: false,
  useDca: false,
  dealCloseCondition: CloseConditionEnum.tp,
  dealCloseConditionSL: CloseConditionEnum.tp,
  indicators: [],
  indicatorGroups: [],
} as unknown as DCABotSettings

const symbolWithStep = (step: number, priceAssetPrecision = 1): Symbols =>
  ({
    pair: 'BTC-USDT',
    baseAsset: { name: 'BTC', minAmount: 0, maxAmount: 1e6, step },
    quoteAsset: { name: 'USDT', minAmount: 0, maxAmount: 1e6, step: 0.01 },
    priceAssetPrecision,
  }) as unknown as Symbols

const BUDGET = 10000
const STEP = 0.001

describe('lot-step rounding of an order quantity', () => {
  // §2.1 — the reporter's table. `floor(budget / price / step) * step` is what
  // the budget actually buys, and what the live bot engine opens.
  it('sizes the base order at the quantity the budget allows', () => {
    const symbol = symbolWithStep(STEP)
    const fn = new DCABotFunctions(settings, symbol, 0.0005)
    const overSized: string[] = []

    for (const price of [68571.5, 69685.1, 69699.4, 69112.8, 68523.7]) {
      const allowed = Math.floor(BUDGET / price / STEP) * STEP
      const baseOrder = fn
        .createOrders(1, price)
        .find((o) => o.type === DCAOrderTypeEnum.bo)

      expect(baseOrder, `base order at ${price}`).to.not.equal(undefined)
      if ((baseOrder?.qty ?? 0) > allowed + STEP / 2) {
        overSized.push(
          `${price}: qty ${baseOrder?.qty} vs ${allowed.toFixed(3)} allowed`,
        )
      }
    }

    expect(overSized, overSized.join(' | ')).to.deep.equal([])
  })

  // §2.1 — the single number the report is named after.
  it('opens 0.145 BTC, not 0.146, for 10000 USDT at 68571.5', () => {
    const fn = new DCABotFunctions(settings, symbolWithStep(STEP), 0.0005)
    const baseOrder = fn
      .createOrders(1, 68571.5)
      .find((o) => o.type === DCAOrderTypeEnum.bo)

    expect(baseOrder?.qty).to.be.closeTo(0.145, 1e-9)
  })

  // §1.1 at the safety-order site (`dcaBotFunctions.ts:716`). At a base price
  // of 69685.1 the safety orders are sized 0.144 — already 144 whole steps —
  // and the round-up pushed every one of them to 0.145.
  it('leaves an already-aligned safety order quantity alone', () => {
    const fn = new DCABotFunctions(
      {
        ...settings,
        useDca: true,
        ordersCount: 3,
        activeOrdersCount: 3,
        step: '1',
      } as unknown as DCABotSettings,
      symbolWithStep(STEP),
      0.0005,
    )
    const safetyOrders = fn
      .createOrders(1, 69685.1)
      .filter((o) => o.type === DCAOrderTypeEnum.dca)

    expect(safetyOrders.length, 'safety orders built').to.be.greaterThan(0)
    for (const order of safetyOrders) {
      expect(order.qty, `safety order at ${order.price}`).to.be.closeTo(
        0.144,
        1e-9,
      )
    }
  })

  // §2.2 — `botUtils.createGridOrders` used a native `%` in trades-backtest
  // mode and `MathHelper.remainder()` otherwise. Both misread an aligned
  // quantity, and they misread different ones, so the two modes sized the same
  // grid differently. They must agree.
  it('sizes a grid identically in both backtest modes', () => {
    const disagreements: string[] = []

    for (const [step, priceAssetPrecision, startPrice] of [
      [0.001, 1, 68571.5],
      [0.01, 2, 2500.55],
      [0.0001, 2, 300.25],
    ] as [number, number, number][]) {
      const symbol = symbolWithStep(step, priceAssetPrecision)

      for (let i = 0; i < 40; i++) {
        const lastPrice = startPrice * (1 + i * 0.0017)
        const [onTrades, onCandles] = [true, false].map((tradesBacktest) =>
          new BotUtils(tradesBacktest).createGridOrders(
            {
              lowPrice: lastPrice * 0.9,
              topPrice: lastPrice * 1.1,
              budget: 100000,
              levels: 15,
              useStartPrice: false,
              startPrice: '',
              updatedBudget: false,
              forceLocal: true,
              symbol,
              _lastPrice: lastPrice,
              userFee: 0.0005,
              sellDisplacement: 0,
              gridType: 'arithmetic' as GridType,
              initialPrice: lastPrice,
              futures: true,
              profitCurrency: 'base',
              orderFixedIn: 'quote',
              coinm: false,
              useOrderInAdvance: false,
              _side: BotOrderSideEnum.buy,
            },
            true,
          ),
        )

        onTrades.forEach((order, idx) => {
          const other = onCandles[idx]
          if (other && Math.abs(order.qty - other.qty) > 1e-12) {
            disagreements.push(
              `step ${step} @ ${order.price}: ${order.qty} vs ${other.qty}`,
            )
          }
        })
      }
    }

    expect(
      disagreements.length,
      disagreements.slice(0, 5).join(' | '),
    ).to.equal(0)
  })
})
