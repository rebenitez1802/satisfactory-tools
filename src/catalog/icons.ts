// Icon lookup. Catalog icons are either app-relative paths into a bundled pack
// folder (`packs/base/icons/Desc_IronIngot_C.png`) or absolute/data URLs (user
// packs). Content without an icon, or whose image fails to load, gets a
// generated placeholder tile: initials on a color derived from the name.

/** Resolve a catalog icon path against the site base URL (Vite's BASE_URL). */
export function iconUrl(icon: string | undefined, baseUrl: string): string | undefined {
  if (!icon) return undefined
  if (/^(data:|https?:|\/)/.test(icon)) return icon
  return baseUrl.replace(/\/?$/, '/') + icon
}

export interface Placeholder {
  initials: string
  background: string
}

/** Initials (up to 2 letters) and a stable color for an entity with no icon. */
export function placeholderFor(name: string, color?: string): Placeholder {
  const words = name
    .replace(/^Alternate:\s*/i, '')
    .split(/[\s\-_.]+/)
    .filter((w) => /[A-Za-z0-9]/.test(w))
  const initials =
    words.length >= 2
      ? (words[0][0] + words[1][0]).toUpperCase()
      : (words[0] ?? '?').slice(0, 2).toUpperCase()

  if (color) return { initials, background: color }
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return { initials, background: `hsl(${h % 360} 45% 38%)` }
}
