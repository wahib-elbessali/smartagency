import type { Device, SensorReading, SensorThreshold } from '@/api/types'

/**
 * What the Climate screen says about the inside of a branch, reduced from
 * three lists it fetches separately: the branch's devices, each device's
 * recent readings, and each device's thresholds.
 *
 * Kept out of the component for the same reason presenceSeries.ts is: the
 * rule for "which reading is the current one" and "is it over the line" is
 * worth a test that does not have to render anything.
 *
 * ONE TILE PER SENSOR TYPE, NOT PER DEVICE. A branch with two DHT22s has one
 * temperature, not two - the newest reading wins, and the tile says which
 * device it came from. That matches how a person asks the question ("how warm
 * is it in Rabat?") rather than how the data is stored.
 *
 * THE LEVEL COMES FROM THE THRESHOLD TABLE AND NOWHERE ELSE. This screen has
 * no opinion about what is too hot; contracts/api.md §10 gives every device an
 * explicit warning_max / critical_max, and iot_service.severity_for is the
 * rule that turns a reading into an alert (>= warning is HIGH, >= critical is
 * CRITICAL). The same comparison is made here so the tile and the alert never
 * disagree. No threshold, no judgment - the tile shows the number and says so.
 */

export const SENSOR_LABELS: Record<string, string> = {
  temperature: 'Temperature',
  humidity: 'Humidity',
  gas_co: 'Carbon monoxide',
}

/**
 * ingestion.md §4 fixes these three; a fourth sensor type would still get a
 * tile, labelled with its raw name, rather than being silently dropped.
 */
export function labelForSensor(sensorType: string): string {
  return SENSOR_LABELS[sensorType] ?? sensorType
}

export type ReadingLevel = 'normal' | 'warning' | 'critical' | 'unknown'

export interface IndoorStat {
  sensorType: string
  value: number
  unit: string | null
  recordedAt: string
  device: Device
  threshold: SensorThreshold | null
  level: ReadingLevel
}

/** Mirrors backend/app/services/iot_service.py's severity_for, in the same order. */
export function levelFor(value: number, threshold: SensorThreshold | null): ReadingLevel {
  if (threshold === null || !threshold.is_active) return 'unknown'
  if (threshold.critical_max !== null && value >= threshold.critical_max) return 'critical'
  if (threshold.warning_max !== null && value >= threshold.warning_max) return 'warning'
  return 'normal'
}

export function latestBySensor(
  devices: Device[],
  readingsByDevice: Record<string, SensorReading[] | undefined>,
  thresholdsByDevice: Record<string, SensorThreshold[] | undefined>,
): IndoorStat[] {
  const newest = new Map<string, IndoorStat>()

  for (const device of devices) {
    const readings = readingsByDevice[device.id] ?? []
    const thresholds = thresholdsByDevice[device.id] ?? []
    for (const reading of readings) {
      const current = newest.get(reading.sensor_type)
      if (current && current.recordedAt >= reading.recorded_at) continue
      const threshold = thresholds.find((t) => t.sensor_type === reading.sensor_type) ?? null
      newest.set(reading.sensor_type, {
        sensorType: reading.sensor_type,
        value: reading.value,
        unit: reading.unit,
        recordedAt: reading.recorded_at,
        device,
        threshold,
        level: levelFor(reading.value, threshold),
      })
    }
  }

  /* The contract's own order, so temperature is always first and an unknown
     type lands last rather than wherever Map insertion put it. */
  const order = Object.keys(SENSOR_LABELS)
  return [...newest.values()].sort((a, b) => {
    const ia = order.indexOf(a.sensorType)
    const ib = order.indexOf(b.sensorType)
    return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib)
  })
}

/**
 * The unit as a person would write it after the number: "24.5 °C", "58 %",
 * "12 ppm". The device sends "C" for Celsius (ingestion.md §4), which is
 * right for a payload and wrong on a screen.
 */
export function formatReading(value: number, unit: string | null): string {
  const number = Number.isInteger(value) ? String(value) : value.toFixed(1)
  if (unit === null) return number
  if (unit === 'C') return `${number}°C`
  if (unit === '%') return `${number}%`
  return `${number} ${unit}`
}
