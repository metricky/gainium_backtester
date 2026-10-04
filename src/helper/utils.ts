import type { DCABotSettings } from '../types'

export const checkNumber = (num?: string) => {
  return num && num !== '' && !isNaN(+num)
}

/**
 * Give every indicator an id.
 *
 * The dashboard always assigns a `uuid`; the bot API does not require one, so an
 * indicator can reach the engine with `uuid: null` or `''`. The engine keys an
 * indicator by `${uuid}@${pair}` — it writes back indicator data, statuses and
 * next-bar times under that key, and `getDynamicLevels` reads the id back out of
 * it — so two indicators without a uuid share one key and overwrite each other.
 *
 * The uuid field itself is replaced, not just the key, so that the
 * `i.id.split('@')[0]` the engine emits for dynamic AR levels still matches the
 * `indicator.uuid` the order helpers look it up by. Ids are deterministic
 * because they surface in the result and the engine has to produce the same
 * result server-side and in the dashboards.
 */
export const withIndicatorIds = <T extends Pick<DCABotSettings, 'indicators'>>(
  settings: T,
): T => {
  const indicators = settings.indicators
  if (!indicators?.some((i) => !i.uuid)) {
    return settings
  }
  const taken = new Set(indicators.filter((i) => i.uuid).map((i) => i.uuid))
  return {
    ...settings,
    indicators: indicators.map((i, index) => {
      if (i.uuid) {
        return i
      }
      let uuid = `indicator-${index}`
      while (taken.has(uuid)) {
        uuid = `_${uuid}`
      }
      taken.add(uuid)
      return { ...i, uuid }
    }),
  }
}
