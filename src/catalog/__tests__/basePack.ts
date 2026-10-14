import { readFileSync } from 'node:fs'
import type { DataPack } from '../pack'

/** The committed base pack, read from public/ the way the app would fetch it. */
export function loadBasePack(): DataPack {
  return JSON.parse(readFileSync(new URL('../../../public/packs/base/pack.json', import.meta.url), 'utf8'))
}
