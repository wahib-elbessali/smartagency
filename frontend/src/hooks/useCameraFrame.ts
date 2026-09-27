import { useCallback, useEffect, useState, type SyntheticEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchCameraFrame } from '@/api/endpoints/cameras'
import { ApiError } from '@/api/errors'
import type { Camera } from '@/api/types'

/* The detectors' own update_interval (ai-service.md GET /config) - polling
   faster would fetch the same frame twice. */
export const FRAME_MS = 2_000

export interface CameraFrame {
  /** An object URL for the current picture, or null while none is loaded. */
  src: string | null
  /** The picture's natural size - the coordinate space every overlay uses. */
  size: { w: number; h: number } | null
  /** Hand to the <img>: records the natural size once the picture decodes. */
  onLoad: (event: SyntheticEvent<HTMLImageElement>) => void
  isError: boolean
  isFetching: boolean
  error: unknown
  refetch: () => void
}

/**
 * One camera's picture, as the three screens that draw on it need it: the
 * live view, zone drawing and calibration.
 *
 * WHY THIS IS SHARED. Each of them kept its own object URL and natural size
 * in state, and each reset them only when a new blob arrived. Switching
 * camera therefore left the OLD camera's picture and size on screen until the
 * new frame landed - and a click in that window was recorded in the old
 * picture's pixels against the new camera. Here both are tagged with the
 * camera they belong to and read back only when that is still the camera in
 * hand, so a switch clears them in the same render.
 *
 * `hold` stops the polling (a half-drawn polygon or placed calibration
 * corners must not have the room move under them). A 403 stops it too: a
 * permission will still be one in two seconds.
 */
export function useCameraFrame(
  camera: Pick<Camera, 'id' | 'agency_id' | 'name'>,
  { hold = false }: { hold?: boolean } = {},
): CameraFrame {
  const frame = useQuery({
    queryKey: ['cameraFrame', camera.id],
    queryFn: ({ signal }) => fetchCameraFrame(camera, signal),
    /* A 404 is the AI service saying it cannot open the stream; the next
       poll is the retry, and a backoff would only bring the picture back
       later than the camera did. */
    retry: false,
    refetchInterval: (query) =>
      hold || (query.state.error instanceof ApiError && query.state.error.status === 403)
        ? false
        : FRAME_MS,
    /* The last picture stays up while the next loads, so the view does not
       blink through a placeholder every two seconds. */
    placeholderData: (previous) => previous,
    gcTime: 0,
  })

  const [loaded, setLoaded] = useState<{ cameraId: string; src: string } | null>(null)
  const [measured, setMeasured] = useState<{
    cameraId: string
    size: { w: number; h: number }
  } | null>(null)

  /* Every object URL made is revoked, or the tab leaks a frame per poll. The
     blob is only trusted if it was fetched for THIS camera - placeholderData
     would otherwise hand over the previous camera's last picture. */
  const blob = frame.isPlaceholderData ? null : frame.data
  useEffect(() => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    setLoaded({ cameraId: camera.id, src: url })
    return () => URL.revokeObjectURL(url)
  }, [blob, camera.id])

  const onLoad = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      setMeasured({
        cameraId: camera.id,
        size: { w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight },
      })
    },
    [camera.id],
  )

  return {
    src: loaded?.cameraId === camera.id ? loaded.src : null,
    size: measured?.cameraId === camera.id ? measured.size : null,
    onLoad,
    isError: frame.isError,
    isFetching: frame.isFetching,
    error: frame.error,
    refetch: () => void frame.refetch(),
  }
}
