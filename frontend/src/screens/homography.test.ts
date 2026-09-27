import { describe, expect, it } from 'vitest'
import {
  applyH,
  completeParallelogram,
  invert,
  lineDiagnostics,
  multiply,
  reversedCameras,
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
