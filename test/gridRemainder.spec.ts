import { describe, it } from 'mocha'
import { expect } from 'chai'
import { MathHelper } from '../src/helper/math'

/**
 * spec 004 §1.1, §1.2, §3.1 — `MathHelper.gridRemainder` must decide whether a
 * quantity is a whole number of lot steps, which neither a native `%` nor
 * `MathHelper.remainder()` can do for binary floats.
 *
 * The first three cases are the reporter's, kept verbatim in intent. The
 * `scales with the quantity-to-step ratio` case is the one a fixed `1e-9`
 * tolerance does not pass (spec §3.1).
 */
describe('MathHelper.gridRemainder', () => {
  const math = new MathHelper()

  // §1.1
  it('reads a quantity already on the step grid as 0', () => {
    // Native `%` returns 0.000999… for each of these, which made the order
    // builder round the quantity up by a whole lot.
    for (const qty of [0.145, 0.146, 0.143, 0.144]) {
      expect(qty % 0.001, `${qty} % 0.001`).to.be.greaterThan(Number.EPSILON)
      expect(math.gridRemainder(qty, 0.001), `${qty}`).to.equal(0)
    }
  })

  // §1.2
  it('still reports a genuine remainder', () => {
    expect(math.gridRemainder(0.1455, 0.001)).to.be.closeTo(0.0005, 1e-12)
  })

  // §1.2
  it('handles a coarser step', () => {
    expect(math.gridRemainder(12, 4)).to.equal(0)
    expect(math.gridRemainder(13, 4)).to.equal(1)
    expect(math.gridRemainder(0.145, 0.005)).to.equal(0)
    expect(math.gridRemainder(0.143, 0.005)).to.be.greaterThan(Number.EPSILON)
  })

  // §3.1
  it('holds at large quantity-to-step ratios', () => {
    expect(math.gridRemainder(145000, 0.001)).to.equal(0)
    expect(math.gridRemainder(10, 1e-8)).to.equal(0)
    expect(math.gridRemainder(12345.678, 0.001)).to.equal(0)
  })

  // §3.1 — the tolerance has to scale with `a / b`; these are ratios where a
  // fixed 1e-9 runs out of precision and the quantity is read as off-grid.
  it('scales with the quantity-to-step ratio', () => {
    const cases: [number, number][] = [
      [67112.487, 0.001], // ratio 6.7e7
      [894830.94, 0.01], // ratio 8.9e7
      [7.31340192, 1e-8], // ratio 7.3e8
      [5368.72974, 0.00001], // ratio 5.4e8
    ]
    for (const [qty, step] of cases) {
      const ratio = qty / step
      expect(
        Math.abs(ratio - Math.round(ratio)),
        `${qty}/${step} is not a case a fixed 1e-9 tolerance already covers`,
      ).to.be.greaterThan(1e-9)
      expect(
        math.gridRemainder(qty, step),
        `${qty} on a ${step} grid`,
      ).to.equal(0)
    }
  })

  // §1.2 — the cap: the tolerance must never grow large enough to swallow a
  // real remainder, however big the ratio gets.
  it('does not swallow a real remainder at a large ratio', () => {
    expect(math.gridRemainder(67112.4875, 0.001)).to.be.greaterThan(
      Number.EPSILON,
    )
    expect(math.gridRemainder(1234567.5, 1)).to.be.greaterThan(Number.EPSILON)
  })
})
