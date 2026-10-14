import { describe, expect, it } from 'vitest'
import {
  extractorPowerMw,
  extractorRate,
  groupPowerMw,
  machinePowerMw,
  machineSetup,
  machinesFor,
  maxClock,
  outputMultiplier,
  recipeFlows,
  shardsNeeded,
} from '../rates'
import type { ExtractorNode } from '../types'
import { catalog, machine, recipe, withPacks } from './fixtures'

const smelter = machine('Build_SmelterMk1_C')
const constructor = machine('Build_ConstructorMk1_C')
const manufacturer = machine('Build_ManufacturerMk1_C')
const ironIngot = recipe('Recipe_IngotIron_C')

const site = (purity: string, count = 1) => ({ purity: `base:${purity}`, count })
const rate = (id: string, sites: ExtractorNode['sites'], clock = 1, sloops = 0, cat = catalog) =>
  extractorRate(cat.machines.get(`base:${id}`)!, { sites, clock, sloops }, cat.purities)

describe('recipe rates', () => {
  it('converts per-cycle amounts to per-minute', () => {
    expect(recipeFlows(ironIngot, smelter, 1, 1)).toEqual({
      inputs: [{ item: 'base:Desc_OreIron_C', perMin: 30 }],
      outputs: [{ item: 'base:Desc_IronIngot_C', perMin: 30 }],
    })
    // 2.5 Smelters at 150%.
    expect(recipeFlows(ironIngot, smelter, 2.5, 1.5).outputs[0].perMin).toBeCloseTo(112.5)
  })

  it('keeps byproducts', () => {
    const rubber = recipeFlows(recipe('Recipe_Rubber_C'), machine('Build_OilRefinery_C'), 1, 1)
    expect(rubber.outputs.map((o) => o.item)).toEqual(['base:Desc_Rubber_C', 'base:Desc_HeavyOilResidue_C'])
    expect(rubber.inputs).toEqual([{ item: 'base:Desc_LiquidOil_C', perMin: 30 }])
  })

  it('Somersloops boost outputs only', () => {
    const plain = recipeFlows(ironIngot, smelter, 1, 1, 0)
    const amped = recipeFlows(ironIngot, smelter, 1, 1, 1)
    expect(amped.inputs).toEqual(plain.inputs)
    expect(amped.outputs[0].perMin).toBe(60)
    expect(outputMultiplier(manufacturer, 2)).toBe(1.5)
    expect(outputMultiplier(manufacturer, 4)).toBe(2)
    expect(outputMultiplier(manufacturer, 9)).toBe(2)
    expect(outputMultiplier(machine('Build_Packager_C'), 1)).toBe(1)
  })

  it('finds machines needed for a target', () => {
    const rip = recipe('Recipe_IronPlateReinforced_C')
    expect(machinesFor(rip, machine('Build_AssemblerMk1_C'), 'base:Desc_IronPlateReinforced_C', 5)).toBeCloseTo(1)
    expect(machinesFor(ironIngot, smelter, 'base:Desc_IronIngot_C', 72)).toBeCloseTo(2.4)
    expect(machinesFor(ironIngot, smelter, 'base:Desc_IronIngot_C', 60, 1)).toBeCloseTo(1)
    expect(machinesFor(ironIngot, smelter, 'base:Desc_Wire_C', 60)).toBeUndefined()
  })
})

describe('extraction', () => {
  it('scales by purity and clock', () => {
    expect(rate('Build_MinerMk1_C', [site('impure')])).toBe(30)
    expect(rate('Build_MinerMk2_C', [site('normal')])).toBe(120)
    expect(rate('Build_MinerMk3_C', [site('pure')], 2.5)).toBe(1200)
    expect(rate('Build_OilPump_C', [site('normal')])).toBe(120)
    expect(rate('Build_FrackingExtractor_C', [site('pure', 2), site('impure')])).toBe(270)
  })

  it('water extractor ignores purity', () => {
    expect(rate('Build_WaterPump_C', [site('pure', 3)])).toBe(360)
  })

  it('vanilla extractors ignore Somersloops, modded ones can use them', () => {
    expect(rate('Build_MinerMk3_C', [site('pure')], 1, 1)).toBe(480)
    const mk3 = machine('Build_MinerMk3_C')
    expect(extractorPowerMw(mk3, { sites: [site('pure')], clock: 1, sloops: 1 })).toBe(45)

    const modded = withPacks({
      manifest: { id: 'sloopminer', name: 'Sloop Miner', version: '1', dependsOn: ['base'] },
      patch: {
        machines: [{ id: 'base:Build_MinerMk3_C', amplifier: { slots: 2, boostPerSlot: 0.5, powerExponent: 2 } }],
      },
    })
    expect(rate('Build_MinerMk3_C', [site('pure')], 1, 2, modded)).toBe(960)
    const moddedMk3 = modded.machines.get('base:Build_MinerMk3_C')!
    expect(extractorPowerMw(moddedMk3, { sites: [site('pure')], clock: 1, sloops: 2 })).toBe(180)
  })

  it('resource well: the pressurizer pays the power', () => {
    const well = machine('Build_FrackingExtractor_C')
    const pressurizer = machine('Build_FrackingSmasher_C')
    expect(extractorPowerMw(well, { sites: [site('pure', 3)], clock: 1, sloops: 0 }, pressurizer)).toBe(150)
  })
})

describe('power', () => {
  it('scales with clock^1.321929', () => {
    expect(machinePowerMw(constructor, 1)).toBe(4)
    expect(machinePowerMw(constructor, 2.5)).toBeCloseTo(13.43, 2)
    expect(machinePowerMw(constructor, 0.5)).toBeCloseTo(1.6, 3)
  })

  it('Somersloops multiply power by (1 + filled/slots)^2', () => {
    expect(machinePowerMw(constructor, 1, 1)).toBe(16)
    expect(machinePowerMw(manufacturer, 1, 2)).toBeCloseTo(55 * 2.25)
    expect(machinePowerMw(manufacturer, 2.5, 4)).toBeCloseTo(55 * 4 * 2.5 ** 1.321929)
  })

  it('variable-power recipes use the average', () => {
    const r = recipe('Recipe_DarkEnergy_C')
    expect(r.variablePower).toEqual({ minMw: 100, maxMw: 400 })
    expect(machinePowerMw(machine('Build_Converter_C'), 1, 0, r)).toBe(250)
  })

  it('costs a fractional machine as an underclocked one', () => {
    expect(groupPowerMw(smelter, 2.4, 1)).toBeCloseTo(8 + 4 * 0.4 ** 1.321929)
    expect(groupPowerMw(smelter, 3, 0.8)).toBeCloseTo(3 * 4 * 0.8 ** 1.321929)
    expect(groupPowerMw(smelter, 2, 1)).toBe(8)
  })
})

describe('machine setups', () => {
  it('fractional, underclocked or overclocked', () => {
    expect(machineSetup(smelter, 2.4, 'fractional')).toEqual({ count: 2.4, clock: 1, shards: 0, feasible: true })
    const under = machineSetup(smelter, 2.4, 'underclock')
    expect(under.count).toBe(3)
    expect(under.clock).toBeCloseTo(0.8)
    expect(machineSetup(smelter, 2.4, 'underclock', { count: 2 })).toMatchObject({ count: 2, shards: 1, feasible: true })
    expect(machineSetup(smelter, 2.4, 'fractional', { count: 1 })).toMatchObject({ count: 1, clock: 2.4, shards: 3, feasible: true })
    expect(machineSetup(smelter, 3, 'underclock', { count: 1 }).feasible).toBe(false)
    expect(machineSetup(smelter, 2, 'underclock')).toEqual({ count: 2, clock: 1, shards: 0, feasible: true })
  })

  it('respects a preferred clock', () => {
    // 5 machines' worth at a preferred 250%: 2 at 250% or 3 at ~167%.
    expect(machineSetup(smelter, 5, 'fractional', { clock: 2.5 })).toMatchObject({ count: 2, clock: 2.5, shards: 3 })
    const whole = machineSetup(smelter, 6, 'underclock', { clock: 2.5 })
    expect(whole.count).toBe(3)
    expect(whole.clock).toBeCloseTo(2)
    expect(whole.shards).toBe(2)
  })

  it('shards and max clock', () => {
    expect(maxClock(smelter)).toBe(2.5)
    expect(shardsNeeded(smelter, 1)).toBe(0)
    expect(shardsNeeded(smelter, 1.01)).toBe(1)
    expect(shardsNeeded(smelter, 1.5)).toBe(1)
    expect(shardsNeeded(smelter, 2.5)).toBe(3)
  })
})
