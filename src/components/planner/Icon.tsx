import { useState } from 'react'
import { iconUrl, placeholderFor } from '../../catalog'

interface IconProps {
  /** Any catalog entity with a name and optional icon/color (item, machine). */
  of: { name: string; icon?: string; color?: string }
  size?: number
  title?: string
}

/** Game icon, or an initials tile when the entity has none or it fails to load. */
export function Icon({ of, size = 32, title }: IconProps) {
  const [failed, setFailed] = useState(false)
  const src = iconUrl(of.icon, import.meta.env.BASE_URL)
  const label = title ?? of.name

  if (src && !failed) {
    return (
      <img
        className="icon"
        src={src}
        width={size}
        height={size}
        alt={label}
        title={label}
        loading="lazy"
        draggable={false}
        onError={() => setFailed(true)}
      />
    )
  }
  const ph = placeholderFor(of.name, of.color)
  return (
    <span
      className="icon icon-placeholder"
      title={label}
      style={{ width: size, height: size, background: ph.background, fontSize: Math.max(9, size * 0.36) }}
    >
      {ph.initials}
    </span>
  )
}
