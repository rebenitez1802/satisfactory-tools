// Loading packs shipped with the site. Each bundled pack lives in
// `public/packs/<id>/` (pack.json + icons/), so swapping the base data or
// adding a pack is a folder drop plus an entry here.

import type { DataPack } from './pack'

/** Packs served from `public/packs/`. The first one is the default game data. */
export const BUNDLED_PACKS = ['base'] as const

export async function fetchBundledPack(id: string, baseUrl: string): Promise<DataPack> {
  const res = await fetch(`${baseUrl.replace(/\/?$/, '/')}packs/${id}/pack.json`)
  if (!res.ok) throw new Error(`Could not load pack "${id}" (${res.status})`)
  return (await res.json()) as DataPack
}
