// Download icons for the base pack from the Official Satisfactory Wiki and
// link them into pack.json. The wiki names files after the in-game display name
// (`File:Iron Ingot.png`); we store them by class name
// (`icons/Desc_IronIngot_C.png`). Files already on disk are not re-downloaded.
// On macOS, new downloads are shrunk to 128px with `sips`.
//
//   node scripts/fetch-icons.ts      (run after scripts/import-base.ts)

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DataPack } from '../src/catalog/pack.ts'
import { ROOT } from './greeny.ts'

const PACK_DIR = join(ROOT, 'public', 'packs', 'base')
const ICON_DIR = join(PACK_DIR, 'icons')
const API = 'https://satisfactory.wiki.gg/api.php'
const UA = 'satisfactory-tools/0.1 (github.com/rebenitez1802/satisfactory-tools; icon import, low volume)'
const SIZE = 128

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const titleFor = (name: string) => `File:${name.replace(/\//g, '-')}.png`

const packPath = join(PACK_DIR, 'pack.json')
const pack = JSON.parse(readFileSync(packPath, 'utf8')) as DataPack
const entities = [...(pack.add?.items ?? []), ...(pack.add?.machines ?? [])]
mkdirSync(ICON_DIR, { recursive: true })

const missing = entities.filter((e) => !existsSync(join(ICON_DIR, `${e.id}.png`)))
console.log(`${entities.length - missing.length} icons present, ${missing.length} to fetch`)

// Resolve file URLs 50 titles per request. No `redirects`: some redirects land
// on the wiki's "unknown" image.
const urls = new Map<string, string>()
for (let i = 0; i < missing.length; i += 50) {
  const batch = missing.slice(i, i + 50)
  const qs = new URLSearchParams({
    action: 'query',
    titles: batch.map((e) => titleFor(e.name)).join('|'),
    prop: 'imageinfo',
    iiprop: 'url',
    format: 'json',
  })
  const res = await fetch(`${API}?${qs}`, { headers: { 'User-Agent': UA } })
  const json = (await res.json()) as {
    query: {
      normalized?: { from: string; to: string }[]
      pages: Record<string, { title: string; imageinfo?: { url: string }[] }>
    }
  }
  const norm = new Map((json.query.normalized ?? []).map((n) => [n.from, n.to]))
  const pages = new Map(Object.values(json.query.pages).map((p) => [p.title, p]))
  for (const e of batch) {
    const t = titleFor(e.name)
    const url = pages.get(norm.get(t) ?? t)?.imageinfo?.[0]?.url
    if (url) urls.set(e.id, url)
    else console.warn(`No wiki icon for ${e.id} (${t})`)
  }
  await sleep(1000)
}

const canResize = process.platform === 'darwin'
for (const [id, url] of urls) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) {
    console.warn(`Download failed for ${id}: ${res.status}`)
    continue
  }
  const file = join(ICON_DIR, `${id}.png`)
  writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  if (canResize) execFileSync('sips', ['-Z', String(SIZE), file], { stdio: 'ignore' })
  console.log(`fetched ${id}`)
  await sleep(300)
}

// Link every icon on disk into the pack.
let linked = 0
for (const e of entities) {
  if (existsSync(join(ICON_DIR, `${e.id}.png`))) {
    e.icon = `icons/${e.id}.png`
    linked++
  } else delete e.icon
}
writeFileSync(packPath, JSON.stringify(pack, null, 1) + '\n')
console.log(`linked ${linked}/${entities.length} icons`)
