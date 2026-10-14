// Hand-written base-game data that greeny's dataset doesn't carry. Values come
// from the game's 1.2 data dump and satisfactory.wiki.gg (Production
// amplification, Clock speed, Conveyor Belts, Pipelines, Resource node).

import type { AmplifierSpec, OverclockSpec, Purity, TransportTier } from '../src/catalog/types.ts'

export const GAME_VERSION = '1.2'

/** Every vanilla production building and extractor: 1–250%, 3 shards at +50%. */
export const OVERCLOCK: OverclockSpec = { min: 0.01, baseMax: 1, shardSlots: 3, perShard: 0.5, item: 'Desc_CrystalShard_C' }

/** Items used only as machine upgrades (not by any recipe), still needed for icons. */
export const UPGRADE_ITEMS = ['Desc_CrystalShard_C', 'Desc_WAT1_C']

export const PURITIES: Purity[] = [
  { id: 'impure', name: 'Impure', multiplier: 0.5, order: 0 },
  { id: 'normal', name: 'Normal', multiplier: 1, order: 1 },
  { id: 'pure', name: 'Pure', multiplier: 2, order: 2 },
]

export const TRANSPORT_TIERS: TransportTier[] = [
  ...[60, 120, 270, 480, 780, 1200].map(
    (rate, i): TransportTier => ({
      id: `Build_ConveyorBeltMk${i + 1}_C`,
      name: `Conveyor Belt Mk.${i + 1}`,
      kind: 'belt',
      ratePerMin: rate,
      order: i,
    }),
  ),
  { id: 'Build_Pipeline_C', name: 'Pipeline Mk.1', kind: 'pipe', ratePerMin: 300, order: 0 },
  { id: 'Build_PipelineMK2_C', name: 'Pipeline Mk.2', kind: 'pipe', ratePerMin: 600, order: 1 },
]

/** Items whose form is gas rather than liquid (greeny only flags "liquid"). */
export const GASES = new Set(['Desc_NitrogenGas_C', 'Desc_DarkEnergy_C', 'Desc_QuantumEnergy_C'])

const amp = (slots: number): AmplifierSpec | undefined =>
  slots > 0 ? { slots, boostPerSlot: 1 / slots, powerExponent: 2, item: 'Desc_WAT1_C' } : undefined

interface MachineExtra {
  belt: [number, number]
  pipe: [number, number]
  amplifier?: AmplifierSpec
}

/** Port counts (in, out) and Somersloop slots for recipe-running machines. */
export const PRODUCTION: Record<string, MachineExtra> = {
  Build_SmelterMk1_C: { belt: [1, 1], pipe: [0, 0], amplifier: amp(1) },
  Build_ConstructorMk1_C: { belt: [1, 1], pipe: [0, 0], amplifier: amp(1) },
  Build_FoundryMk1_C: { belt: [2, 1], pipe: [0, 0], amplifier: amp(2) },
  Build_AssemblerMk1_C: { belt: [2, 1], pipe: [0, 0], amplifier: amp(2) },
  Build_ManufacturerMk1_C: { belt: [4, 1], pipe: [0, 0], amplifier: amp(4) },
  Build_OilRefinery_C: { belt: [1, 1], pipe: [1, 1], amplifier: amp(2) },
  Build_Packager_C: { belt: [1, 1], pipe: [1, 1] },
  Build_Blender_C: { belt: [2, 1], pipe: [2, 1], amplifier: amp(4) },
  Build_HadronCollider_C: { belt: [2, 1], pipe: [1, 0], amplifier: amp(4) },
  Build_Converter_C: { belt: [2, 1], pipe: [0, 1], amplifier: amp(2) },
  Build_QuantumEncoder_C: { belt: [3, 1], pipe: [1, 1], amplifier: amp(4) },
}

/**
 * Machines whose power is set per recipe. Source data also carries power ranges
 * on a few Blender/Manufacturer recipes; the game ignores those, and so do we.
 */
export const VARIABLE_POWER = new Set(['Build_HadronCollider_C', 'Build_Converter_C', 'Build_QuantumEncoder_C'])

interface ExtractorExtra {
  belt: [number, number]
  pipe: [number, number]
  usesPurity: boolean
  /** Placed on any water, not on resource nodes: no limit on how many. */
  anywhere?: boolean
  poweredBy?: string
  /** For extractors greeny doesn't list under `miners`. */
  fallback?: { resources: string[]; ratePerMin: number }
}

export const EXTRACTORS: Record<string, ExtractorExtra> = {
  Build_MinerMk1_C: { belt: [0, 1], pipe: [0, 0], usesPurity: true },
  Build_MinerMk2_C: { belt: [0, 1], pipe: [0, 0], usesPurity: true },
  Build_MinerMk3_C: { belt: [0, 1], pipe: [0, 0], usesPurity: true },
  Build_OilPump_C: { belt: [0, 0], pipe: [0, 1], usesPurity: true },
  Build_WaterPump_C: {
    belt: [0, 0],
    pipe: [0, 1],
    usesPurity: false,
    anywhere: true,
    fallback: { resources: ['Desc_Water_C'], ratePerMin: 120 },
  },
  Build_FrackingExtractor_C: { belt: [0, 0], pipe: [0, 1], usesPurity: true, poweredBy: 'Build_FrackingSmasher_C' },
}

/** Machines that exist only to power other extractors. */
export const SUPPORT_MACHINES = ['Build_FrackingSmasher_C']

/**
 * Generators: port counts (in, out). greeny lists their power, fuels and water
 * use under `generators`; the Biomass Burner here is the standalone one (the
 * HUB's burner can't take belts).
 */
export const GENERATORS: Record<string, { belt: [number, number]; pipe: [number, number] }> = {
  Build_GeneratorBiomass_Automated_C: { belt: [1, 0], pipe: [0, 0] },
  Build_GeneratorCoal_C: { belt: [1, 0], pipe: [1, 0] },
  Build_GeneratorFuel_C: { belt: [0, 0], pipe: [1, 0] },
  Build_GeneratorNuclear_C: { belt: [1, 1], pipe: [1, 0] },
}

/**
 * Waste left by one unit of fuel, which greeny doesn't carry. From
 * satisfactory.wiki.gg (Nuclear Power Plant): a uranium rod burns 300 s and
 * leaves 10 waste/min, a plutonium rod burns 600 s and leaves 1/min, and a
 * Ficsonium rod leaves none.
 */
export const FUEL_WASTE: Record<string, { item: string; amount: number }> = {
  Desc_NuclearFuelRod_C: { item: 'Desc_NuclearWaste_C', amount: 50 },
  Desc_PlutoniumFuelRod_C: { item: 'Desc_PlutoniumWaste_C', amount: 10 },
}
