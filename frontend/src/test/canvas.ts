import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, vi } from 'vitest'

/**
 * Test helpers for the screens that are clicked on a camera picture
 * (calibration, zones). jsdom has neither
 * pictures nor SVG geometry: an <img> never loads, and `getScreenCTM`,
 * `DOMPoint` and pointer capture do not exist. So this file supplies the
 * three smallest stand-ins that let a click land where it was aimed - the
 * picture reports 1920x1080 when told it loaded, and the screen-to-image
 * matrix is the identity, so clientX/Y ARE image pixels. Everything past
 * that point (the handle, the guess, the pairing, the requests) is the real
 * code.
 */
export function stubSvgGeometry() {
  vi.stubGlobal(
    'DOMPoint',
    class {
      x: number
      y: number
      constructor(x = 0, y = 0) {
        this.x = x
        this.y = y
      }
      matrixTransform() {
        return this
      }
    },
  )
  Object.defineProperty(SVGElement.prototype, 'getScreenCTM', {
    configurable: true,
    value: () => ({ inverse: () => ({}) }),
  })
  Object.defineProperty(Element.prototype, 'setPointerCapture', {
    configurable: true,
    value: () => {},
  })
  Object.defineProperty(Element.prototype, 'releasePointerCapture', {
    configurable: true,
    value: () => {},
  })
  if (typeof globalThis.PointerEvent === 'undefined') {
    vi.stubGlobal(
      'PointerEvent',
      class extends MouseEvent {
        pointerId: number
        constructor(type: string, init: PointerEventInit = {}) {
          super(type, init)
          this.pointerId = init.pointerId ?? 0
        }
      },
    )
  }
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:frame'),
    revokeObjectURL: vi.fn(),
  })
}

/** Tells every camera picture on the page that it decoded at 1920x1080. */
export async function loadPictures(count = 1) {
  await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(count), { timeout: 4000 })
  const images = screen.getAllByRole('img')
  for (const img of images) {
    Object.defineProperty(img, 'naturalWidth', { value: 1920, configurable: true })
    Object.defineProperty(img, 'naturalHeight', { value: 1080, configurable: true })
    fireEvent.load(img)
  }
}

export function clickAt(svg: Element, x: number, y: number) {
  fireEvent.click(svg, { clientX: x, clientY: y })
}

export function canvasFor(cameraName: string): Element {
  const img = screen.getByRole('img', { name: `Current frame from ${cameraName}` })
  const svg = img.parentElement?.querySelector('svg')
  if (!svg) throw new Error(`no canvas for ${cameraName}`)
  return svg
}
