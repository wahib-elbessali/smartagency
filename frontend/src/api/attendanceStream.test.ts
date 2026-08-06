import { describe, expect, it } from 'vitest'
import { backoffDelay, buildSocketTarget, parseFrame } from './attendanceStream'

describe('buildSocketTarget', () => {
  /* These three nulls are the whole safety property: the socket refuses to
     open rather than connecting unauthenticated and rendering a calm, empty,
     silently-wrong list. */
  it('refuses without a token', () => {
    expect(buildSocketTarget(null, 'query', 'ws://api.test')).toBeNull()
  })

  it('refuses when the auth mode has not been configured', () => {
    expect(buildSocketTarget('jwt', null, 'ws://api.test')).toBeNull()
  })

  it('refuses without a base url', () => {
    expect(buildSocketTarget('jwt', 'query', '')).toBeNull()
  })

  it('puts the token in the query string in query mode', () => {
    const target = buildSocketTarget('jwt', 'query', 'ws://api.test')
    expect(target?.url).toBe('ws://api.test/ws/attendance?token=jwt')
    expect(target?.protocols).toBeUndefined()
  })

  it('puts the token in the subprotocol list in subprotocol mode', () => {
    const target = buildSocketTarget('jwt', 'subprotocol', 'ws://api.test')
    expect(target?.url).toBe('ws://api.test/ws/attendance')
    expect(target?.protocols).toEqual(['bearer', 'jwt'])
  })
})

describe('backoffDelay', () => {
  it('never drops below the floor or above the ceiling', () => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const delay = backoffDelay(attempt)
      expect(delay).toBeGreaterThanOrEqual(1_000)
      expect(delay).toBeLessThanOrEqual(30_000)
    }
  })
})

describe('parseFrame', () => {
  const valid = JSON.stringify({
    type: 'attendance_updated',
    event: 'check_in',
    employee_id: 'emp-1',
    employee_name: 'Ahmed Benali',
    agency_id: 'agency-1',
    check_in: '2026-08-05T08:30:00Z',
    check_out: null,
    method: 'RFID',
    device_id: 'device-1',
  })

  it('parses a contract-shaped frame', () => {
    expect(parseFrame(valid)?.employee_id).toBe('emp-1')
  })

  /* One malformed message must not take down a dashboard that is otherwise
     fine, so these all return null instead of throwing. */
  it('drops malformed frames instead of throwing', () => {
    expect(parseFrame('{not json')).toBeNull()
    expect(parseFrame(JSON.stringify({ type: 'attendance_updated' }))).toBeNull()
    expect(parseFrame(JSON.stringify(null))).toBeNull()
    expect(parseFrame(new ArrayBuffer(4))).toBeNull()
  })

  it('keeps a frame whose event value is not one the contract documents', () => {
    const amended = JSON.parse(valid) as Record<string, unknown>
    amended.event = 'attendance_amended'
    expect(parseFrame(JSON.stringify(amended))?.event).toBe('attendance_amended')
  })
})
