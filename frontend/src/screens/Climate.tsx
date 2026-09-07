import { useQuery } from '@tanstack/react-query'
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Droplets,
  Gauge,
  Sun,
  Thermometer,
  Umbrella,
  Wind,
  type LucideIcon,
} from 'lucide-react'
import { fetchAgencies } from '@/api/endpoints/agencies'
import { describeWeatherCode, fetchCityWeather, type CityWeather } from '@/api/weather'
import type { Agency } from '@/api/types'
import { useScope } from '@/agency/ScopeContext'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { Panel, PanelBody, PanelHeader } from '@/components/ui/Panel'
import { StatTile } from '@/components/ui/StatTile'
import { Screen } from './Screen'

/**
 * Live weather for each branch's city, from Open-Meteo (api/weather.ts) - not
 * the DHT22 sensors. Those measure conditions inside one room and have no
 * frontend yet; this is the outside weather, keyed off `Agency.address`.
 *
 * No hot/cold thresholds are invented here. This screen used to say exactly
 * that as its <ContractPending> note: "what counts as too hot or too cold
 * comes from the contract or from Ahmed, not from this screen." That is still
 * true - every StatTile below stays neutral-toned, never warn, because this
 * screen has no authority to decide a reading is a problem.
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
    <Screen title="Climate" description="Live outside weather for each branch's city.">
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
      </PanelBody>
    </Panel>
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
