// Game-content model for the production planner.
//
// Everything the planner knows about the game (items, machines, recipes,
// purities, belt/pipe tiers) is *data* loaded from one or more data packs (see
// ./pack.ts), never hard-coded. The base game is just the `base` pack; mods add
// their own packs on top. Code only branches on engine-level semantics (an
// item's physical form, whether a machine extracts or runs recipes), so a mod
// that adds a new machine, resource or recipe needs no code changes.
//
// Ids are namespaced `<packId>:<localId>`, e.g. `base:Desc_IronIngot_C`. Local
// ids follow the game's class names so they line up with the game's own data
// dump and with mods built on the same conventions.

/** Namespaced content id, `<packId>:<localId>`. */
export type Id = string
export type ItemId = Id
export type MachineId = Id
export type RecipeId = Id
export type PurityId = Id
export type TransportTierId = Id
export type MapId = Id

/** Physical form. Solids ride belts; liquids and gases go through pipes. */
export type ItemForm = 'solid' | 'liquid' | 'gas'

export type TransportKind = 'belt' | 'pipe'

export interface Item {
  id: ItemId
  name: string
  form: ItemForm
  /** Path relative to the pack's folder, or an absolute / data: URL. */
  icon?: string
  /** Hex color, used for fluids and icon placeholders. */
  color?: string
  sinkPoints?: number
  /** MJ released when burned, for fuels. */
  energyMJ?: number
  /** Radioactive items (uranium, waste, fuel rods). Unused radioactive items that can't be sunk are flagged. */
  radioactive?: boolean
}

/** Node purity tier. Extraction rates are multiplied by `multiplier`. */
export interface Purity {
  id: PurityId
  name: string
  multiplier: number
  /** Sort order in pickers (ascending). */
  order: number
}

/** A belt or pipe mark and its throughput cap. */
export interface TransportTier {
  id: TransportTierId
  name: string
  kind: TransportKind
  /** Items/min for belts, m³/min for pipes. */
  ratePerMin: number
  order: number
}

export interface PortCounts {
  in: number
  out: number
}

/** Clock-speed limits. Clock is a fraction: 1 = 100%. */
export interface OverclockSpec {
  min: number
  /** Max clock with no power shards. */
  baseMax: number
  shardSlots: number
  /** Extra max clock per shard (0.5 = +50%). */
  perShard: number
  /** Item that goes in the shard slots (the Power Shard in vanilla). */
  item?: ItemId
}

/** Somersloop production amplification. */
export interface AmplifierSpec {
  slots: number
  /** Output boost per filled slot (1 / slots in vanilla, so a full machine doubles output). */
  boostPerSlot: number
  /** Power scales by (1 + filled / slots) ^ powerExponent. */
  powerExponent: number
  /** Item that goes in the slots (the Somersloop in vanilla). */
  item?: ItemId
}

/**
 * A machine that pulls a raw resource out of the world (miners, oil/water
 * extractors, resource-well satellites).
 */
export interface ExtractionSpec {
  /** Resources it can extract. */
  resources: ItemId[]
  /** Output per site at normal purity and 100% clock (items or m³ per minute). */
  ratePerMin: number
  /** False for extractors that ignore purity (water extractor). */
  usesPurity: boolean
  /**
   * Built anywhere rather than on resource nodes (water extractors go on any
   * water), so any number can be built: the UI counts extractors, not nodes,
   * and world node limits (roadmap #11) don't apply.
   */
  anywhere?: boolean
  /**
   * The kind of world site it is built on ('node' for resource nodes, 'well'
   * for resource-well satellites). Extractors with the same kind compete for
   * the same sites, which a map counts (`WorldMap`). Absent: not limited by
   * the world.
   */
  site?: string
  /**
   * Machine that powers this extractor's sites instead of each site drawing its
   * own power, e.g. resource-well satellites are driven by one pressurizer.
   * The planner charges this machine's power once per extractor node.
   */
  poweredBy?: MachineId
}

/**
 * A machine that burns fuel for power. Its recipes take fuel (and water) and
 * may output waste; each recipe's duration is how long one unit of fuel burns.
 * Generators scale linearly with clock: power and fuel use alike.
 */
export interface GenerationSpec {
  /** Power produced at 100% clock, in MW. */
  powerMw: number
}

export interface Machine {
  id: MachineId
  name: string
  icon?: string
  /** Free-form grouping for pickers: 'production', 'extraction', mod categories… */
  category: string
  /** Power draw in MW at 100% clock. Variable-power recipes override this. */
  powerMw: number
  /** Power scales with clock ^ powerExponent (≈1.32 in vanilla). */
  powerExponent: number
  /** Recipe speed multiplier (1 in vanilla; tiered machines in mods go higher). */
  speed: number
  ports: { belt: PortCounts; pipe: PortCounts }
  /** Absent = fixed at 100%. */
  overclock?: OverclockSpec
  /** Absent = no Somersloop slots. */
  amplifier?: AmplifierSpec
  /** Present on extractors. */
  extraction?: ExtractionSpec
  /** Present on power generators. */
  generation?: GenerationSpec
  /** What one of these costs to build. Absent: unknown (not free). */
  buildCost?: ItemAmount[]
}

export interface ItemAmount {
  item: ItemId
  /** Per cycle. Fluids in m³. */
  amount: number
}

export interface Recipe {
  id: RecipeId
  name: string
  /** Machines that can run it (more than one in some mods). */
  machines: MachineId[]
  durationSec: number
  inputs: ItemAmount[]
  /**
   * outputs[0] is the main product; any others are byproducts. Generator
   * recipes make power, so all their outputs (waste) are byproducts, and they
   * may have none.
   */
  outputs: ItemAmount[]
  alternate: boolean
  /**
   * Per-recipe power for variable-power machines (Particle Accelerator,
   * Converter, Quantum Encoder). The machine cycles between min and max; the
   * planner uses the average.
   */
  variablePower?: { minMw: number; maxMw: number }
  tags?: string[]
}

/** How many sites of one kind a map has for one resource, at one purity. */
export interface WorldSite {
  resource: ItemId
  /** Matches `ExtractionSpec.site`. */
  site: string
  purity: PurityId
  count: number
}

/** A world map's resource sites, for world node limits and the optimizer's scarcity weights. */
export interface WorldMap {
  id: MapId
  name: string
  sites: WorldSite[]
}

/** The merged, ready-to-query result of loading a set of packs. */
export interface Catalog {
  /** Manifests of the packs merged into this catalog, in load order. */
  packs: PackInfo[]
  items: ReadonlyMap<ItemId, Item>
  machines: ReadonlyMap<MachineId, Machine>
  recipes: ReadonlyMap<RecipeId, Recipe>
  purities: ReadonlyMap<PurityId, Purity>
  transportTiers: ReadonlyMap<TransportTierId, TransportTier>
  /** World maps; the first is the default. */
  maps: ReadonlyMap<MapId, WorldMap>
  /** Recipes listing the item among their outputs. */
  recipesProducing: ReadonlyMap<ItemId, RecipeId[]>
  /** Recipes listing the item among their inputs. */
  recipesConsuming: ReadonlyMap<ItemId, RecipeId[]>
  /** Extractor machines able to extract the item. */
  extractorsFor: ReadonlyMap<ItemId, MachineId[]>
}

export interface PackInfo {
  id: string
  name: string
  version: string
}
