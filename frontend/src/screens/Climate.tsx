import { useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Droplets,
  Gauge,
  Home,
  Sun,
  Thermometer,
  Umbrella,
  Wind,
  type LucideIcon,
} from 'lucide-react'
import { fetchAgencies } from '@/api/endpoints/agencies'
import { fetchDevices } from '@/api/endpoints/devices'
import { fetchReadings } from '@/api/endpoints/readings'
import { fetchThresholds } from '@/api/endpoints/thresholds'
import { ApiError } from '@/api/errors'
import { describeWeatherCode, fetchCityWeather, type CityWeather } from '@/api/weather'
import type { Agency, Device, SensorReading, SensorThreshold } from '@/api/types'
import { useScope } from '@/agency/ScopeContext'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { Panel, PanelBody, PanelHeader } from '@/components/ui/Panel'
import { StatTile } from '@/components/ui/StatTile'
import { Clock } from '@/components/ui/Time'
import { formatReading, labelForSensor, latestBySensor, type IndoorStat } from './indoorReadings'
import { Screen } from './Screen'

/**
 * Outside and inside, per branch.
 *
 * OUTSIDE is live weather for the branch's city from Open-Meteo
 * (api/weather.ts), keyed off `Agency.address`. INSIDE is the DHT22 / MQ-7
 * readings the hardware publishes over MQTT (contracts/ingestion.md §4) -
 * added 2026-09-12 against a PROPOSED route, GET /api/devices/{id}/readings,
 * since the backend stores every reading and exposes none yet (api/types.ts
 * has the shape to ask for). Until it lands, a real server answers 404 and
 * the inside section says "no readings" rather than failing the screen.
 *
 * WHO DECIDES A READING IS A PROBLEM. Not this screen - the threshold table
 * does (contracts/api.md §10, set per device on the Devices screen), and the
 * comparison is the backend's own (iot_service.severity_for), reproduced in
 * indoorReadings.ts so a tile turns warn on exactly the reading that raises
 * an alert. This screen used to say as its <ContractPending> note that "what
 * counts as too hot or too cold comes from the contract or from Ahmed, not
 * from this screen" - still true, which is why the OUTSIDE tiles stay neutral
 * (no threshold applies to the weather) and an INSIDE tile with no threshold
 * set says so instead of guessing.
 */

function iconForCode(code: number): LucideIcon {
  if (code === 0) return Sun
  if (code <= 3) return CloudSun
  if (code === 45 || code === 48) return CloudFog
  if (code >= 51 && code <= 57) return CloudDrizzle
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return CloudRain
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return CloudSnow
  if (code >= 95) return CloudLightning
  return Cloud
}

function useAgencyWeather(city: string | null) {
  return useQuery({
    queryKey: ['weather', city],
    queryFn: ({ signal }) => fetchCityWeather(city as string, signal),
    enabled: city !== null,
    /* A city's weather does not need re-checking on every focus or every
       10-second poll the way the rest of this dashboard runs - it is still
       roughly true five minutes later, and Open-Meteo is a shared public
       service worth not hammering. */
    staleTime: 5 * 60_000,
    retry: 1,
  })
}

export default function Climate() {
  const scope = useScope()

  const agencies = useQuery({
    queryKey: ['agencies'],
    queryFn: ({ signal }) => fetchAgencies(signal),
  })

  const rows = agencies.data ?? []
  /* One branch to focus on, either because an admin opened it (AppShell's
     scope bar) or because there is only one to begin with - a MANAGER's list
     is already scoped to their own agency by the backend. Otherwise, every
     branch gets a compact card side by side. */
  const focused =
    rows.find((agency) => agency.id === scope.agencyId) ?? (rows.length === 1 ? rows[0] : null)

  return (
    <Screen
      title="Climate"
      description="Outside weather for each branch's city, and the readings from the sensors inside."
    >
      <AsyncBoundary
        isPending={agencies.isPending}
        error={agencies.error}
        isEmpty={rows.length === 0}
        emptyMessage="No agencies yet, so there is no city to check the weather for."
        forbiddenMessage="Agencies are managed by administrators and managers. Ask an administrator if you need access."
        onRetry={() => void agencies.refetch()}
        skeletonRows={3}
      >
        {focused ? (
          <AgencyWeatherDetail agency={focused} />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((agency) => (
              <AgencyWeatherCard key={agency.id} agency={agency} />
            ))}
          </div>
        )}
      </AsyncBoundary>
    </Screen>
  )
}

/** One branch, full detail - the StatTile row this screen was always meant to have. */
function AgencyWeatherDetail({ agency }: { agency: Agency }) {
  const weather = useAgencyWeather(agency.address)

  return (
    <Panel as="section">
      <PanelHeader>
        <h2 className="text-ink text-sm font-semibold">{agency.name}</h2>
        <p className="text-ink-3 mt-0.5 text-xs">{agency.address ?? 'No address set'}</p>
      </PanelHeader>
      <PanelBody>
        {agency.address === null ? (
          <p className="text-ink-2 text-sm">
            This branch has no address set, so there is no city to look up.
          </p>
        ) : weather.isPending ? (
          <p className="text-ink-3 text-sm">Checking the weather in {agency.address}…</p>
        ) : weather.error ? (
          <p className="text-warn text-sm">
            Could not reach the weather service for {agency.address}.
          </p>
        ) : (
          <WeatherStats weather={weather.data} />
        )}

        <IndoorSection agency={agency} />
      </PanelBody>
    </Panel>
  )
}

/**
 * Everything the branch's sensors have said lately, reduced to one tile per
 * sensor type. Three reads: the device list (already cached if the Devices
 * screen was open), then readings and thresholds per device in parallel.
 *
 * Readings refetch every minute rather than on the dashboard's usual
 * ten-second poll: the hardware publishes every few minutes at most
 * (ingestion.md), so anything faster is asking the same question again.
 */
function useIndoorStats(agencyId: string) {
  const devices = useQuery({
    queryKey: ['devices'],
    queryFn: ({ signal }) => fetchDevices(signal),
  })
  const branchDevices = useMemo(
    () => (devices.data ?? []).filter((d) => d.agency_id === agencyId),
    [devices.data, agencyId],
  )

  const readings = useQueries({
    queries: branchDevices.map((device) => ({
      queryKey: ['readings', device.id],
      queryFn: ({ signal }: { signal?: AbortSignal }) =>
        fetchReadings(device.id, { limit: 60 }, signal),
      refetchInterval: 60_000,
      /* PROPOSED route: a real backend without it answers 404, and that is
         "no readings" for this device, not a broken screen. */
      retry: (count: number, error: unknown) =>
        !(error instanceof ApiError && error.status === 404) && count < 2,
    })),
  })
  const thresholds = useQueries({
    queries: branchDevices.map((device) => ({
      queryKey: ['thresholds', device.id],
      queryFn: ({ signal }: { signal?: AbortSignal }) => fetchThresholds(device.id, signal),
    })),
  })

  const readingsByDevice: Record<string, SensorReading[] | undefined> = {}
  const thresholdsByDevice: Record<string, SensorThreshold[] | undefined> = {}
  branchDevices.forEach((device: Device, i) => {
    readingsByDevice[device.id] = readings[i]?.data
    thresholdsByDevice[device.id] = thresholds[i]?.data
  })

  const stats = latestBySensor(branchDevices, readingsByDevice, thresholdsByDevice)
  const pending = devices.isPending || readings.some((q) => q.isPending)
  /* The device list is the one read that can refuse (ADMIN, MANAGER,
     TECHNICIAN). A per-device 404 or 403 is per-device and already folded
     into "no readings" above. */
  const error = devices.error

  return { stats, pending, error, deviceCount: branchDevices.length }
}

function IndoorSection({ agency }: { agency: Agency }) {
  const inside = useIndoorStats(agency.id)

  return (
    <section className="mt-5" aria-labelledby={`inside-${agency.id}`}>
      <div className="mb-3 flex items-center gap-2">
        <Home className="text-ink-3 size-4" aria-hidden />
        <h3 id={`inside-${agency.id}`} className="text-ink text-sm font-semibold">
          Inside
        </h3>
      </div>
      {inside.error ? (
        <p className="text-ink-3 text-sm">
          {inside.error instanceof ApiError && inside.error.status === 403
            ? 'Sensor readings are visible to administrators, managers and technicians.'
            : 'Could not load the sensors for this branch.'}
        </p>
      ) : inside.pending ? (
        <p className="text-ink-3 text-sm">Reading the sensors…</p>
      ) : inside.deviceCount === 0 ? (
        <p className="text-ink-3 text-sm">
          No devices registered for this branch, so nothing is measuring the inside.
        </p>
      ) : inside.stats.length === 0 ? (
        <p className="text-ink-3 text-sm">
          The sensors here have not reported yet, so there are no indoor readings to show.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {inside.stats.map((stat) => (
            <IndoorTile key={stat.sensorType} stat={stat} />
          ))}
        </div>
      )}
    </section>
  )
}

const SENSOR_ICON: Record<string, LucideIcon> = {
  temperature: Thermometer,
  humidity: Droplets,
  gas_co: Wind,
}

/**
 * One reading, with what it was measured against underneath. The hint is
 * where the threshold speaks: over the line it names the line, under it it
 * still names the line, and with none set it says none is set - three
 * different sentences so "24°C" never looks the same when it means "fine",
 * "nobody has said what fine is" and "the alert has fired".
 */
function IndoorTile({ stat }: { stat: IndoorStat }) {
  const over = stat.level === 'critical' || stat.level === 'warning'
  const Icon = over ? AlertTriangle : (SENSOR_ICON[stat.sensorType] ?? Gauge)
  const limit = (n: number | null | undefined) => (n == null ? null : formatReading(n, stat.unit))
  const warning = limit(stat.threshold?.warning_max)
  const critical = limit(stat.threshold?.critical_max)
  const hint = {
    critical: `Above the critical level of ${critical}`,
    warning: `Above the warning level of ${warning}`,
    normal:
      warning !== null
        ? `Under the warning level of ${warning}`
        : `Under the critical level of ${critical}`,
    unknown: 'No threshold set for this sensor',
  }[stat.level]

  return (
    <StatTile
      label={labelForSensor(stat.sensorType)}
      value={formatReading(stat.value, stat.unit)}
      tone={over ? 'warn' : 'neutral'}
      icon={<Icon className="size-4" aria-hidden />}
      hint={hint}
      detail={
        <p className="text-ink-3 text-xs">
          {stat.device.name} · <Clock iso={stat.recordedAt} />
          {stat.device.status !== 'ONLINE' && (
            <span className="text-warn"> · sensor {stat.device.status.toLowerCase()}</span>
          )}
        </p>
      }
    />
  )
}

function WeatherStats({ weather }: { weather: CityWeather }) {
  const Icon = iconForCode(weather.code)
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <StatTile
        label="Temperature"
        value={`${Math.round(weather.temperatureC)}°C`}
        icon={<Icon className="size-4" aria-hidden />}
        hint={describeWeatherCode(weather.code)}
      />
      <StatTile
        label="Feels like"
        value={weather.feelsLikeC === null ? '—' : `${Math.round(weather.feelsLikeC)}°C`}
        icon={<Thermometer className="size-4" aria-hidden />}
        hint="Wind and humidity factored in"
      />
      <StatTile
        label="Humidity"
        value={weather.humidityPct === null ? '—' : `${Math.round(weather.humidityPct)}%`}
        icon={<Droplets className="size-4" aria-hidden />}
      />
      <StatTile
        label="Wind"
        value={`${Math.round(weather.windKph)} km/h`}
        icon={<Wind className="size-4" aria-hidden />}
        hint={
          weather.windGustKph === null
            ? undefined
            : `Gusting to ${Math.round(weather.windGustKph)} km/h`
        }
      />
      <StatTile
        label="Precipitation"
        value={weather.precipitationMm === null ? '—' : `${weather.precipitationMm} mm`}
        icon={<Umbrella className="size-4" aria-hidden />}
        hint="This hour"
      />
      <StatTile
        label="Cloud cover"
        value={weather.cloudCoverPct === null ? '—' : `${Math.round(weather.cloudCoverPct)}%`}
        icon={<Cloud className="size-4" aria-hidden />}
      />
      <StatTile
        label="Pressure"
        value={weather.pressureHpa === null ? '—' : `${Math.round(weather.pressureHpa)} hPa`}
        icon={<Gauge className="size-4" aria-hidden />}
        hint="At sea level"
      />
    </div>
  )
}

/** Every branch at once - compact, side by side, for an admin looking at the whole estate. */
function AgencyWeatherCard({ agency }: { agency: Agency }) {
  const weather = useAgencyWeather(agency.address)
  const Icon = weather.data ? iconForCode(weather.data.code) : Cloud

  return (
    <Panel as="section">
      <PanelBody className="flex items-center justify-between gap-3 py-4">
        <div className="min-w-0">
          <h2 className="text-ink truncate text-sm font-semibold">{agency.name}</h2>
          <p className="text-ink-3 mt-0.5 truncate text-xs">{agency.address ?? 'No address set'}</p>
          {agency.address !== null && (
            <p className="text-ink-2 mt-2 text-sm">
              {weather.isPending && 'Checking…'}
              {weather.error && <span className="text-warn">Unavailable</span>}
              {weather.data && (
                <>
                  <span className="tabular font-semibold">
                    {Math.round(weather.data.temperatureC)}°C
                  </span>{' '}
                  <span className="text-ink-3">{describeWeatherCode(weather.data.code)}</span>
                  {weather.data.humidityPct !== null && (
                    <span className="text-ink-3 tabular">
                      {' · '}
                      {Math.round(weather.data.humidityPct)}% humidity
                    </span>
                  )}
                </>
              )}
            </p>
          )}
        </div>
        {agency.address !== null && (
          <span className="bg-accent-gradient text-ink grid size-11 shrink-0 place-items-center rounded-[0.75rem]">
            <Icon className="size-5" aria-hidden />
          </span>
        )}
      </PanelBody>
    </Panel>
  )
}
