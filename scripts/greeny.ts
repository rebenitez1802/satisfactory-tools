// Source data: greeny/SatisfactoryTools `data/data1.0.json` (MIT licensed),
// pinned to a commit so imports are reproducible. Its machine recipes match
// the game's own 1.2 data dump exactly. Only the shapes we read are typed.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const GREENY_COMMIT = '74b691c82ed69030f32cd9419d8c327c878e2ac8'
export const GREENY_URL = `https://raw.githubusercontent.com/greeny/SatisfactoryTools/${GREENY_COMMIT}/data/data1.0.json`

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export interface GreenyAmount {
  item: string
  amount: number
}

export interface GreenyData {
  items: Record<
    string,
    {
      className: string
      name: string
      liquid: boolean
      sinkPoints: number
      energyValue: number
      radioactiveDecay: number
      fluidColor: { r: number; g: number; b: number; a: number }
    }
  >
  recipes: Record<
    string,
    {
      className: string
      name: string
      alternate: boolean
      time: number
      inMachine: boolean
      forBuilding: boolean
      ingredients: GreenyAmount[]
      products: GreenyAmount[]
      producedIn: string[]
      isVariablePower: boolean
      minPower: number
      maxPower: number
    }
  >
  buildings: Record<
    string,
    {
      className: string
      name: string
      metadata: { powerConsumption?: number; powerConsumptionExponent?: number; manufacturingSpeed?: number }
    }
  >
  generators: Record<
    string,
    {
      className: string
      fuel: string[]
      /** MW at 100% clock. */
      powerProduction: number
      /** Water in m³ per MJ × 1000 (0 for generators that need none). */
      waterToPowerRatio: number
    }
  >
  miners: Record<
    string,
    {
      className: string
      allowedResources: string[]
      allowLiquids: boolean
      itemsPerCycle: number
      extractCycleTime: number
    }
  >
}

/** Load the pinned dataset, downloading it once into node_modules/.cache. */
export async function loadGreeny(): Promise<GreenyData> {
  const cache = join(ROOT, 'node_modules', '.cache', `greeny-data1.0-${GREENY_COMMIT.slice(0, 10)}.json`)
  if (!existsSync(cache)) {
    console.log(`Downloading ${GREENY_URL}`)
    const res = await fetch(GREENY_URL)
    if (!res.ok) throw new Error(`Download failed: ${res.status}`)
    mkdirSync(dirname(cache), { recursive: true })
    writeFileSync(cache, await res.text())
  }
  return JSON.parse(readFileSync(cache, 'utf8')) as GreenyData
}
