import { cn } from './cn'

/**
 * Initials stand-in for a photo.
 *
 * No employee photo field exists in contracts/api.md, so there is no image to
 * load - and the hue is derived from the name rather than assigned, so the same
 * person is the same colour on every render and across reloads without any
 * state. Purely decorative: the name is always next to it in text.
 */
function hueOf(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) % 360
  }
  return hash
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const hue = hueOf(name)

  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-semibold',
        className,
      )}
      style={{
        backgroundColor: `oklch(0.32 0.06 ${hue})`,
        color: `oklch(0.86 0.09 ${hue})`,
      }}
    >
      {initialsOf(name)}
    </span>
  )
}
