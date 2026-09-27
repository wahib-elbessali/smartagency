import { describe, expect, it } from 'vitest'
import {
  applyH,
  canvasTransform,
  coverageCheck,
  footprint,
  niceStep,
  toMatrix3d,
  completeParallelogram,
  invert,
  lineDiagnostics,
  multiply,
  reversedCameras,
  solveHomography,
  type Matrix3,
} from './homography'

const IDENTITY: Matrix3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
]
/* Scale x2 and shift by (10, 20). */
const SCALE_SHIFT: Matrix3 = [
  [2, 0, 10],
  [0, 2, 20],
  [0, 0, 1],
]

describe('homography maths', () => {
  it('applies a matrix with the projective divide', () => {
    expect(applyH(SCALE_SHIFT, [1, 1])).toEqual([12, 22])
    expect(
      applyH(
        [
          [2, 0, 0],
          [0, 2, 0],
          [0, 0, 2],
        ],
        [3, 4],
      ),
    ).toEqual([3, 4])
  })

  it('inverts, and a matrix times its inverse is the identity', () => {
    const inverse = invert(SCALE_SHIFT)
    expect(inverse).not.toBeNull()
    const product = multiply(SCALE_SHIFT, inverse as Matrix3)
    product.forEach((row, i) => row.forEach((v, j) => expect(v).toBeCloseTo(IDENTITY[i][j])))
    expect(applyH(inverse as Matrix3, [12, 22])).toEqual([1, 1])
  })

  it('refuses to invert a singular matrix', () => {
    expect(
      invert([
        [1, 2, 3],
        [2, 4, 6],
        [0, 0, 1],
      ]),
    ).toBeNull()
  })

  /* The reference's inferRectCorner3: corner4 = corner1 + corner3 - corner2. */
  it('completes a parallelogram from three corners', () => {
    expect(completeParallelogram([0, 0], [10, 0], [10, 5])).toEqual([0, 5])
  })
})

describe('lineDiagnostics', () => {
  it('measures length and straightness per camera, and agreement across them', () => {
    const result = lineDiagnostics(
      {
        a: [
          [0, 0],
          [5, 0],
          [10, 0],
        ],
        b: [
          [0, 0],
          [5, 1],
          [10, 0],
        ],
      },
      { a: IDENTITY, b: IDENTITY },
    )
    expect(result.per_camera.a.path_length).toBeCloseTo(10)
    expect(result.per_camera.a.collinearity_max_dev).toBeCloseTo(0)
    /* b's middle point sits 1 unit off the straight line. */
    expect(result.per_camera.b.collinearity_max_dev).toBeCloseTo(1)
    expect(result.agreement?.spread).toBeGreaterThan(0)
  })

  it('skips a camera with no calibration or a single point', () => {
    const result = lineDiagnostics(
      {
        a: [
          [0, 0],
          [1, 0],
        ],
        uncalibrated: [
          [0, 0],
          [1, 0],
        ],
        single: [[0, 0]],
      },
      { a: IDENTITY, single: IDENTITY },
    )
    expect(Object.keys(result.per_camera)).toEqual(['a'])
    expect(result.agreement).toBeNull()
  })

  /* Points pair by click order, so one camera clicked the other way round
     pairs every point with the wrong end. Caught between aligned cameras. */
  it('flags a camera that clicked the line in the opposite direction', () => {
    const diagnostics = lineDiagnostics(
      {
        a: [
          [0, 0],
          [10, 0],
        ],
        b: [
          [10, 0],
          [0, 0],
        ],
      },
      { a: IDENTITY, b: IDENTITY },
    )
    expect(reversedCameras(diagnostics, new Set(['a', 'b']))).toEqual(['b'])
    /* Not comparable until both are aligned. */
    expect(reversedCameras(diagnostics, new Set(['a']))).toEqual([])
  })
})

describe('solveHomography', () => {
  it('maps four points exactly onto four others', () => {
    const src: Array<[number, number]> = [
      [100, 100],
      [500, 120],
      [520, 400],
      [90, 380],
    ]
    const dst: Array<[number, number]> = [
      [0, 0],
      [200, 0],
      [200, 100],
      [0, 100],
    ]
    const H = solveHomography(src, dst)
    expect(H).not.toBeNull()
    src.forEach((p, i) => {
      const [x, y] = applyH(H as Matrix3, p)
      expect(x).toBeCloseTo(dst[i][0])
      expect(y).toBeCloseTo(dst[i][1])
    })
  })

  it('refuses collinear points', () => {
    expect(
      solveHomography(
        [
          [0, 0],
          [1, 1],
          [2, 2],
          [3, 3],
        ],
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
      ),
    ).toBeNull()
  })
})

describe("bird's-eye geometry", () => {
  it('projects a camera that sees only floor, and measures it', () => {
    const fp = footprint(SCALE_SHIFT, 100, 50)
    expect(fp.horizonFrac).toBeCloseTo(0)
    /* x2 scale on both axes: 100x50 px -> 200x100 floor units. */
    expect(fp.area).toBeCloseTo(20_000)
  })

  /* Denominator y - 20: the top 20 of 50 rows are at or past the horizon. */
  it('clips the part of the frame past the horizon, and reports it', () => {
    const horizon: Matrix3 = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 1, -20],
    ]
    const fp = footprint(horizon, 100, 50)
    expect(fp.horizonFrac).toBeCloseTo(0.4, 2)
    expect(fp.pixels.every(([, y]) => y >= 20)).toBe(true)
  })

  it('flags a footprint wildly off the median, and sets aside unbounded ones', () => {
    const fp = (area: number, horizonFrac = 0) => ({ pixels: [], world: [], area, horizonFrac })
    const result = coverageCheck({ a: fp(100), b: fp(120), c: fp(5000), d: fp(80, 0.3) })
    expect(result.median).toBe(120)
    expect(result.flagged).toEqual(['c'])
    expect(result.unbounded).toEqual(['d'])
  })

  it('builds a uniform canvas transform over the bounds', () => {
    const S = canvasTransform({ xmin: 0, xmax: 200, ymin: 0, ymax: 100 }, 220, 10)
    expect(applyH(S, [0, 0])).toEqual([10, 10])
    expect(applyH(S, [200, 100])).toEqual([210, 110])
  })

  it('writes a homography as a column-major matrix3d', () => {
    expect(toMatrix3d(SCALE_SHIFT)).toBe(
      'matrix3d(2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 10, 20, 0, 1)',
    )
  })

  it('picks round grid steps', () => {
    expect(niceStep(1000)).toBe(100)
    expect(niceStep(730)).toBe(100)
    expect(niceStep(37)).toBe(5)
  })
})
