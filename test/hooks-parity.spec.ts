import { describe, it } from 'mocha'
import { expect } from 'chai'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

import DCABacktesting from '../src/dca'
import { StrategyContextManager } from '../src/dca/strategy/context'
import {
  CloseConditionEnum,
  DCAConditionEnum,
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
  DCABacktestingResult,
  DCABotSettings,
  FullBar,
  Symbols,
} from '../src/types'

/**
 * Parity guard for the optional engine hooks (1.8.0).
 *
 * The same engine runs server side (main-app's backtest worker) and in both
 * dashboards. The hooks must be inert unless a caller sets them:
 *
 * 1. Without hooks every configuration below must produce the SAME result as
 *    the engine before the hooks existed. The golden files under
 *    `test/fixtures/hooks-parity/` were generated from backtester 1.7.1
 *    (commit b87a2e1) — regenerate them only from a commit that predates a
 *    deliberate engine change (`UPDATE_GOLDEN=1`).
 * 2. With hooks that approve everything and an `afterBar` that does nothing,
 *    the result must ALSO be identical (the hooks are synchronous: the engine
 *    continues on the same bar with the answer).
 *
 * Random ids and wall-clock timings are stripped before comparing.
 */

const HOUR = 3600e3
const FROM = Date.UTC(2026, 0, 1)
const GOLDEN_DIR = join(__dirname, 'fixtures', 'hooks-parity')

const mkSymbol = (pair: string, base: string): Symbols => ({
  pair,
  exchange: ExchangeEnum.binance,
  baseAsset: { name: base, minAmount: 0.0001, maxAmount: 1e9, step: 0.0001 },
  quoteAsset: { name: 'USDT', minAmount: 1 },
  maxOrders: 200,
  priceAssetPrecision: 4,
})

const wave = (pair: string, n: number, phase = 0, base = 100): FullBar[] =>
  Array.from({ length: n }, (_, i) => {
    const p = (k: number) =>
      base +
      12 * Math.sin((k + phase) / 23) +
      4 * Math.sin((k + phase) / 5) +
      k * 0.01
    const open = p(i - 1)
    const close = p(i)
    return {
      time: FROM + i * HOUR,
      open,
      close,
      high: Math.max(open, close) + 0.6,
      low: Math.min(open, close) - 0.6,
      volume: 1000,
      symbol: pair,
    }
  })

const base = {
  name: 'parity',
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
  useSl: true,
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

type Case = {
  name: string
  settings: Partial<DCABotSettings>
  symbols: Symbols[]
  bars: FullBar[]
  combo?: boolean
}

const one = mkSymbol('AAA_USDT', 'AAA')
const two = mkSymbol('BBB_USDT', 'BBB')

const CASES: Case[] = [
  {
    name: 'asap-dca-tp-sl',
    settings: {},
    symbols: [one],
    bars: wave(one.pair, 700),
  },
  {
    name: 'asap-trailing-tp',
    settings: {
      trailingTp: true,
      trailingTpPerc: '0.5',
      useSl: false,
    } as Partial<DCABotSettings>,
    symbols: [one],
    bars: wave(one.pair, 700),
  },
  {
    name: 'asap-trailing-sl',
    settings: { trailingSl: true, slPerc: '-3' } as Partial<DCABotSettings>,
    symbols: [one],
    bars: wave(one.pair, 700),
  },
  {
    name: 'ti-start-ti-close',
    settings: {
      startCondition: StartConditionEnum.ti,
      dealCloseCondition: CloseConditionEnum.techInd,
      useSl: false,
      indicators: [
        rsi(
          's',
          IndicatorAction.startDeal,
          IndicatorStartConditionEnum.lt,
          '40',
        ),
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
    } as Partial<DCABotSettings>,
    symbols: [one],
    bars: wave(one.pair, 700),
  },
  {
    name: 'asap-multi-pair',
    settings: {
      pair: [one.pair, two.pair],
      useMulti: true,
      maxNumberOfOpenDeals: '2',
      maxDealsPerPair: '1',
    } as Partial<DCABotSettings>,
    symbols: [one, two],
    bars: [...wave(one.pair, 500), ...wave(two.pair, 500, 40, 50)].sort(
      (a, b) => a.time - b.time || a.symbol.localeCompare(b.symbol),
    ),
  },
  {
    name: 'combo-asap',
    settings: { tpPerc: '1.5', slPerc: '-8' } as Partial<DCABotSettings>,
    symbols: [one],
    bars: wave(one.pair, 500),
    combo: true,
  },
]

const STRIP = new Set([
  'id',
  'dealId',
  '_id',
  'minigridId',
  'relatedTo',
  'dcaOrderId',
  'loadingDataTime',
  'processingDataTime',
])

function normalise(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalise)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      if (STRIP.has(k)) continue
      out[k] = normalise((v as Record<string, unknown>)[k])
    }
    return out
  }
  if (typeof v === 'number' && !Number.isFinite(v)) return String(v)
  return v
}

type Fingerprint = {
  sha256: string
  deals: number
  closed: number
  netProfitTotal: number
  maxDrawDownPerc: number
}

/** A compact, exact fingerprint of a normalised result. */
function fingerprint(r: unknown): Fingerprint {
  const res = r as {
    deals: { status: string }[]
    financial: { netProfitTotal: number; maxDrawDownPerc: number }
  }
  return {
    sha256: createHash('sha256').update(JSON.stringify(r)).digest('hex'),
    deals: res.deals.length,
    closed: res.deals.filter((d) => d.status === 'closed').length,
    netProfitTotal: res.financial.netProfitTotal,
    maxDrawDownPerc: res.financial.maxDrawDownPerc,
  }
}

let runNo = 0

async function run(c: Case, hooks?: unknown): Promise<Fingerprint> {
  // Engine state is per context; a fresh one per run keeps one run's
  // leftovers out of the next (the server runs each backtest in its own
  // worker thread, the dashboards one per page).
  StrategyContextManager.setActiveContext(`parity-${++runNo}`)
  const backtest = new DCABacktesting({
    exchange: ExchangeEnum.binance,
    symbols: c.symbols,
    interval: ExchangeIntervals.oneH,
    userFee: 0.001,
    prices: c.symbols.map((s) => ({ symbol: s.pair, price: 100 })),
    balances: [{ asset: 'USDT', free: '1000000', locked: '0' }] as never,
    from: FROM,
    to: FROM + 700 * HOUR,
    combo: !!c.combo,
    settings: {
      ...base,
      pair: c.symbols.map((s) => s.pair),
      ...c.settings,
    } as DCABotSettings,
    fullResult: true,
    ...(hooks ? { hooks } : {}),
  } as never)
  const result = (await backtest.test([
    { bar: c.bars, interval: ExchangeIntervals.oneH },
  ])) as DCABacktestingResult
  return fingerprint(normalise(JSON.parse(JSON.stringify(result))))
}

describe('engine hooks — client/server parity (1.8.0)', () => {
  for (const c of CASES) {
    const file = join(GOLDEN_DIR, `${c.name}.json`)

    it(`${c.name}: no hooks → identical to the pre-hooks engine`, async () => {
      const got = await run(c)
      if (process.env.UPDATE_GOLDEN === '1') {
        if (!existsSync(GOLDEN_DIR)) mkdirSync(GOLDEN_DIR, { recursive: true })
        writeFileSync(file, `${JSON.stringify(got, null, 2)}\n`)
      }
      const golden = JSON.parse(readFileSync(file, 'utf8'))
      expect(got.closed, 'the case closes deals').to.be.greaterThan(1)
      expect(got).to.deep.equal(golden)
    })

    it(`${c.name}: approve-all synchronous hooks → identical`, async () => {
      if (process.env.UPDATE_GOLDEN === '1') return
      let bars = 0
      const got = await run(c, {
        approveNewDeal: () => true,
        approveDealClose: () => true,
        afterBar: () => {
          bars++
        },
      })
      const golden = JSON.parse(readFileSync(file, 'utf8'))
      expect(got).to.deep.equal(golden)
      expect(bars, 'afterBar is called').to.be.greaterThan(100)
    })
  }
})
