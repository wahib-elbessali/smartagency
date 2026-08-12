import { describe, expect, it } from 'vitest'
import {
  activeCameras,
  applyAlertFrame,
  applyOccupancyFrame,
  totalAcrossZones,
  type AlertsByCamera,
  type ZonesByName,
} from './streamMerge'
import { parseAlertFrame, parseOccupancyFrame } from './endpoints/streams'

describe('applyAlertFrame', () => {
  it('takes a snapshot as the whole truth', () => {
    const before: AlertsByCamera = {
      'cam-old': [{ class: 'pistol', confidence: 0.9, bbox: [0, 0, 1, 1] }],
    }
    const after = applyAlertFrame(before, { type: 'snapshot', cameras: { 'cam-new': [] } })

    /* The old camera is gone, not merged forward - a snapshot describes every
       camera, so one missing from it no longer exists. */
    expect(Object.keys(after)).toEqual(['cam-new'])
  })

  /* The mistake worth guarding: appending instead of replacing leaves a
     cleared weapon alert on a security screen forever. */
  it('replaces a camera detections rather than appending to them', () => {
    const before: AlertsByCamera = {
      'cam-1': [{ class: 'pistol', confidence: 0.9, bbox: [0, 0, 1, 1] }],
    }
    const after = applyAlertFrame(before, {
      type: 'update',
      camera: 'cam-1',
      detections: [{ class: 'knife', confidence: 0.7, bbox: [2, 2, 3, 3] }],
    })

    expect(after['cam-1']).toHaveLength(1)
    expect(after['cam-1']?.[0]?.class).toBe('knife')
  })

  it('treats an empty detections array as the all-clear', () => {
    const before: AlertsByCamera = {
      'cam-1': [{ class: 'pistol', confidence: 0.9, bbox: [0, 0, 1, 1] }],
    }
    const after = applyAlertFrame(before, { type: 'update', camera: 'cam-1', detections: [] })

    expect(after['cam-1']).toEqual([])
    expect(activeCameras(after)).toEqual([])
  })

  it('leaves other cameras alone', () => {
    const before: AlertsByCamera = {
      'cam-1': [{ class: 'pistol', confidence: 0.9, bbox: [0, 0, 1, 1] }],
      'cam-2': [],
    }
    const after = applyAlertFrame(before, { type: 'update', camera: 'cam-2', detections: [] })

    expect(after['cam-1']).toHaveLength(1)
  })
})

describe('applyOccupancyFrame', () => {
  it('keeps a zone that drops to zero rather than dropping the row', () => {
    const before: ZonesByName = { lobby: { count: 4, points: [[1, 1]] } }
    const after = applyOccupancyFrame(before, {
      type: 'update',
      zone: 'lobby',
      count: 0,
      points: [],
    })

    /* Not just "count is 0" - the key has to survive, or the screen stops
       rendering the row and leaves the last number on a wall display. */
    expect(Object.keys(after)).toContain('lobby')
    expect(after.lobby?.count).toBe(0)
  })

  it('adds a zone it has not seen before', () => {
    const after = applyOccupancyFrame({}, { type: 'update', zone: 'vault', count: 2, points: [] })
    expect(after.vault?.count).toBe(2)
  })

  it('replaces everything on a snapshot', () => {
    const before: ZonesByName = { gone: { count: 9, points: [] } }
    const after = applyOccupancyFrame(before, {
      type: 'snapshot',
      zones: { lobby: { count: 1, points: [] } },
    })
    expect(Object.keys(after)).toEqual(['lobby'])
  })

  /* Overlapping zones double-count on purpose, so the sum is not a headcount
     and nothing in the UI may call it one. */
  it('sums across zones without pretending it is a headcount', () => {
    expect(
      totalAcrossZones({
        lobby: { count: 4, points: [] },
        counters: { count: 3, points: [] },
      }),
    ).toBe(7)
  })
})

describe('frame parsers', () => {
  it('drops unreadable frames instead of throwing', () => {
    expect(parseAlertFrame('not json')).toBeNull()
    expect(parseAlertFrame(42)).toBeNull()
    expect(parseOccupancyFrame('{}')).toBeNull()
  })

  it('rejects a frame whose type is not one of the two documented', () => {
    expect(parseAlertFrame(JSON.stringify({ type: 'heartbeat' }))).toBeNull()
  })

  it('parses the contract-shaped alert frames', () => {
    const snapshot = parseAlertFrame(JSON.stringify({ type: 'snapshot', cameras: { cam1: [] } }))
    expect(snapshot?.type).toBe('snapshot')

    const update = parseAlertFrame(
      JSON.stringify({
        type: 'update',
        camera: 'cam1',
        detections: [{ class: 'pistol', confidence: 0.87, bbox: [900.5, 332, 1352.5, 664.7] }],
      }),
    )
    expect(update?.type).toBe('update')
  })

  it('parses the contract-shaped occupancy frames', () => {
    const snapshot = parseOccupancyFrame(
      JSON.stringify({ type: 'snapshot', zones: { lobby: { count: 4, points: [[210.5, 533]] } } }),
    )
    expect(snapshot?.type).toBe('snapshot')

    const update = parseOccupancyFrame(
      JSON.stringify({ type: 'update', zone: 'lobby', count: 5, points: [] }),
    )
    expect(update && 'count' in update && update.count).toBe(5)
  })

  /* A count of zero must parse. `typeof 0 === 'number'` is true but a
     truthiness check would drop it, which is exactly the bug that makes an
     emptied zone stay busy on screen. */
  it('parses an occupancy update with a count of zero', () => {
    const frame = parseOccupancyFrame(
      JSON.stringify({ type: 'update', zone: 'lobby', count: 0, points: [] }),
    )
    expect(frame).not.toBeNull()
  })
})
