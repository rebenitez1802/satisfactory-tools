import type { Plan } from '../../planner'

// Starter plan shown until saving lands (step 7): Reinforced Iron Plates from
// one iron node, plus a 20/min Iron Plate goal. It exercises a limited source,
// a numeric target next to a Max goal, two splits and a bottleneck.

const b = (id: string) => `base:${id}`
const at = (x: number, y: number) => ({ x, y })

export function samplePlan(): Plan {
  return {
    schemaVersion: 1,
    name: 'Reinforced Iron Plates',
    packs: [{ id: 'base', version: '1.2.0' }],
    settings: { machineMode: 'fractional' },
    nodes: [
      {
        id: 'ore',
        kind: 'extractor',
        position: at(0, 60),
        machine: b('Build_MinerMk2_C'),
        resource: b('Desc_OreIron_C'),
        limited: true,
        sites: [{ purity: b('normal'), count: 1 }],
        clock: 1,
        sloops: 0,
      },
      recipe('smelt', 'Recipe_IngotIron_C', 'Build_SmelterMk1_C', at(230, 60)),
      recipe('plates', 'Recipe_IronPlate_C', 'Build_ConstructorMk1_C', at(470, -40)),
      recipe('rods', 'Recipe_IronRod_C', 'Build_ConstructorMk1_C', at(470, 160)),
      recipe('screws', 'Recipe_Screw_C', 'Build_ConstructorMk1_C', at(710, 160)),
      recipe('rip', 'Recipe_IronPlateReinforced_C', 'Build_AssemblerMk1_C', at(950, 50)),
      { id: 'goal-rip', kind: 'goal', position: at(1190, 60), item: b('Desc_IronPlateReinforced_C'), target: 'max' },
      { id: 'goal-plates', kind: 'goal', position: at(950, -140), item: b('Desc_IronPlate_C'), target: 20 },
    ],
    edges: [
      edge('ore', 'smelt', 'Desc_OreIron_C'),
      edge('smelt', 'plates', 'Desc_IronIngot_C'),
      edge('smelt', 'rods', 'Desc_IronIngot_C'),
      edge('rods', 'screws', 'Desc_IronRod_C'),
      edge('plates', 'rip', 'Desc_IronPlate_C'),
      edge('screws', 'rip', 'Desc_IronScrew_C'),
      edge('plates', 'goal-plates', 'Desc_IronPlate_C'),
      edge('rip', 'goal-rip', 'Desc_IronPlateReinforced_C'),
    ],
  }

  function recipe(id: string, recipeId: string, machine: string, position: { x: number; y: number }) {
    return {
      id,
      kind: 'recipe' as const,
      position,
      recipe: b(recipeId),
      machine: b(machine),
      limited: false,
      count: 1,
      clock: 1,
      sloops: 0,
    }
  }

  function edge(source: string, target: string, item: string) {
    return { id: `${source}->${target}`, source, target, item: b(item) }
  }
}
