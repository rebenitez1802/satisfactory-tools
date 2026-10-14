# Roadmap

What comes after Production Planner v1, in priority order. Agreed with the user
on 2026-10-14. Priorities:

1. **Automation that helps players build plans faster** comes first.
2. **Vanilla before mods.** Anything mod-specific is deferred.
3. **Quick wins** ride along with the milestone they help.

Effort: **XS** under an hour · **S** about half a day · **M** 1–2 days · **L** several days.

How the planner behaves today is in [production-planner.md](production-planner.md).
The game-data layer is in [data-model.md](data-model.md). Agent onboarding is in
[`AGENTS.md`](../AGENTS.md); read its "Working on the planner" section first.

| # | Item | Milestone | Value | Effort | Status |
|---|---|---|---|---|---|
| 1 | [Auto-layout](#1-auto-layout) | M1 | High | S | Done (PR #5) |
| 2 | [Auto-build upstream](#2-auto-build-upstream-mode-2) | M1 | Very high | M | Next |
| 3 | [Compare recipes at this node's rate](#3-compare-recipes-at-this-nodes-rate) | M1 | High | S | Next |
| 4 | [Belt counts instead of red edges](#4-belt-counts-instead-of-red-edges) | M1 | Medium | XS–S | Next |
| 5 | [Better default zoom](#5-better-default-zoom) | M1 | Low–Med | XS | Done (PR #5) |
| — | [Rates on unconnected ports](#quick-win-rates-on-unconnected-ports) | M1 | Medium | XS | Done (PR #5) |
| 6 | [Optimizer](#6-optimizer-mode-3) | M2 | Very high | L | Planned |
| 7 | [Split shares on outputs](#7-split-shares-on-outputs) | M2 | Medium | S–M | Planned |
| 8 | [Generators and net power](#8-generators-and-net-power) | M2 | Med–High | M | Done (PR #6) |
| 9 | [Share a plan as a link](#9-share-a-plan-as-a-link) | M2 | Medium | S | Planned |
| 17 | [Use leftovers](#17-use-leftovers) | M2 | High | M | Planned, after #2 and #6 |
| 10 | [1.2 power multiplier](#10-12-power-multiplier) | M2 | Medium | XS | Blocked on user's rules |
| 11 | [World node limits](#11-world-node-limits) | M3 | Medium | M | Later |
| 12 | [Byproduct-driven chains](#12-byproduct-driven-chains) | M2 | Med–High | M | Done (PR #6) |
| 13 | [Inspector covering cards](#13-inspector-covering-cards) | M3 | Low | S | Later |
| 14 | [Belt line style in the balancer](#14-belt-line-style-in-the-balancer) | M3 | Low | XS | Later |
| 15 | [Power goal](#15-power-goal) | M3 | Low | S–M | Later |
| 16 | [Byproduct loops](#16-byproduct-loops) | M3 | High | M–L | Later, needs design |
| — | [Mods and data tooling](#deferred-mods-and-data-tooling) | — | — | — | Deferred |

When an item ships, change its status to **Done (PR #n)** and move its rules
into `production-planner.md`.

### Delivery plan

Items are grouped into PRs by the code they touch and how much they risk,
since every merge deploys. Changes to how the solver calculates rates get
their own PR. Agreed with the user on 2026-10-14; one agent works through
them in this order:

| Order | PR | Items | Why together |
|---|---|---|---|
| 1 | Build chain | #2 | The largest piece; #6 and #17 reuse its node-building helpers. |
| 2 | Refine and read | #3, #4, #13 | Small polish for reading and refining a built plan; one screenshot pass. Closes M1. |
| 3 | Solver core | #6 (LP core), #16 | An LP solves byproduct loops exactly; isolated because it changes rates. |
| 4 | Optimize | #6 (UI), #11 | The Optimize action; world node counts weigh "fewest raw resources". |
| 5 | Use leftovers | #17 | Builds on #2 (adding nodes) and #6 (ranking suggestions). |
| any time | Small standalones | #9, #15, #14 | Independent; slot one in between the big ones. |
| blocked | — | #10 | Waits on the user's rules. |

---

## M1 — Build faster

**Goal:** typing "10 Modular Frames/min" gives a complete, tidy chain in one
click, which the player then refines. Do the items in order: #2 depends on #1.

### 1. Auto-layout

**Done.** Its behaviour is in
[production-planner.md](production-planner.md#interaction) ("Tidy layout").
For #2: call `layoutPlan(plan, sizes, { only: newIds })`. The new nodes are
anchored to the existing node they have the most belts with, which is the
node the build started from.

**Value:** tidies hand-built plans, and is needed so auto-built chains are
readable. **Effort:** S.

- **UX:**
  - A "Tidy layout" button in the canvas toolbar. It lays out the whole plan
    left to right (resources → goals), as one undo step, then fits the view.
  - Optionally, "Tidy selection" for only the selected nodes.
- **Implementation:**
  - Write a pure function `layoutPlan(plan, sizes, opts) → Map<nodeId, {x, y}>`
    in `src/planner/layout.ts`.
  - Use [`@dagrejs/dagre`](https://github.com/dagrejs/dagre) (small,
    framework-free) with `rankdir: 'LR'`. Avoid elkjs: it is over 1 MB.
  - Take node sizes from React Flow's `measured` width/height (see `rects` in
    `PlanCanvas.tsx`), falling back to `CARD_W` × 100.
  - Dagre breaks cycles by itself (recycling loops), but check that loops still
    read sensibly.
  - Keep parallel lines apart. Nodes sharing a split's source should be
    stacked, not interleaved.
  - Apply the result with one `setPlan` call (one undo step), then
    `fitView({ duration: 300 })`.
  - Auto-build (#2) calls the same function for only its new nodes, and
    anchors them to the node it was started from.
- **Done when:**
  - No two cards overlap.
  - Every belt runs left to right, except loop belts.
  - The sample plan looks at least as clean as it does by hand.
  - Undo restores the old positions.
- **Tests:** unit tests on `layoutPlan` (no overlaps; producers left of
  consumers in a DAG), and a Playwright screenshot of the sample after Tidy.

### 2. Auto-build upstream (mode 2)

**Value:** the biggest speed-up. A goal, or any missing input, becomes a full
chain down to raw resources. **Effort:** M.

- **UX:**
  - **"⚡ Build chain" in three places:**
    - the inspector, for a goal or a node with missing inputs
    - first option in the picker that opens when you click an unconnected input
    - next to each missing input in the summary panel
  - **It builds back to raw resources.** It adds recipe nodes, then extractors
    for mineable resources (miners/oil/water) or supplies for anything else.
    Everything it adds is flexible, so the plan's existing targets and limits
    still drive the rates.
  - **It reuses before adding.** If the plan already has a flexible recipe
    node making the needed item, it connects to that instead of adding a
    duplicate. This should be an option, on by default.
  - **It's one undo step,** and the new nodes go through the layout from #1.
- **Recipe choice** (pure `chooseRecipe(item, ctx)`), in this order:
  1. The player's remembered pick for that item. Store it in prefs as
     `preferredRecipes: Record<ItemId, RecipeId>`, updated whenever they
     switch recipes in the inspector.
  2. The standard (non-alternate) recipe whose **main** output is the item.
     Avoid recipes where the item is only a byproduct.
  3. Otherwise, an unlocked alternate. Respect `isRecipeHidden`.
  4. If none exists, the item becomes a supply node (hand-gathered things:
     leaves, mycelia, alien parts, Somersloops, …).
- **Raw resources:**
  - Items in `catalog.extractorsFor` become an extractor node.
  - Default extractor: the best tier available. Make it a preference later,
    e.g. "Miner Mk.2".
  - Water → Water Extractor. Crude Oil → Oil Extractor. Nitrogen → Resource
    Well Extractor.
  - New extractors are not limited, so they report what they need.
- **Implementation:**
  - Write a pure `buildUpstream(plan, catalog, start, ctx) → { plan, added }`
    in `src/planner/autobuild.ts`, reusing `createNode`, `connectPorts` and
    `newNodeId` from `create.ts` and `edit.ts`.
  - Walk the inputs depth-first, using `portsOf()` to find each node's
    inputs.
  - Keep a set of already-visited `(item, recipe)` pairs so recipe loops
    (Packaged ⇄ Unpackaged, Recycled Rubber/Plastic) can't recurse forever,
    and cap the depth at about 25.
  - Leave byproducts unconnected; they show up as spare output.
  - Water inputs to refineries etc. need water nodes too; don't skip fluids.
- **Done when:**
  - A Modular Frame goal of 10/min builds a connected chain down to Iron Ore
    and Limestone, with no missing inputs.
  - Locked alternates are never chosen.
  - A recipe the player switched to is reused the next time.
  - Running it twice doesn't duplicate anything.
- **Tests:**
  - Unit tests: Modular Frame, Computer (deep, with fluids), Plastic (Heavy
    Oil Residue byproduct), Packaged Water (loop guard).
  - A Playwright run from an empty plan to a complete chain.

### 3. Compare recipes at this node's rate

**Value:** makes choosing an alternate a matter of reading numbers. Pairs with
#2: build fast, then refine. **Effort:** S.

- **UX:**
  - The recipe dropdown (`RecipeSelect.tsx`) gets a toggle: *per machine* |
    *at this node's rate*.
  - At this node's rate, every option is scaled to the node's current main
    output. Example: for 90 screws/min, 22.5 rods vs 1.7 steel beams vs 22.5
    ingots.
  - Each option also shows its machine count and MW at that rate.
- **Implementation:**
  - The node's rate is `result.nodes.get(id).outputs[0].produced`, or the
    goal's demand when the node is idle.
  - Scale with `machinesFor()`, then `recipeFlows()` and `groupPowerMw()` from
    `rates.ts`.
  - Drawn with `RecipeIO` plus a rate/scale prop.
- **Done when:** switching the toggle shows the same rate on every option's
  main output, and the numbers match what the inspector shows after picking
  that recipe.

### 4. Belt counts instead of red edges

**Value:** fixes a misleading warning. An edge is a logical flow between
groups, so 240/min on Mk.2 really means "2 belts". **Effort:** XS–S.

- **UX:**
  - The edge label becomes `240 · 2× Mk.2` when it needs more than one belt of
    the plan's tier.
  - Red stays for one case only: a single physical source that can't be split,
    such as a lone extractor whose output is over its own belt's limit. Even
    that should probably be just a hint. Ask the user.
  - The belt inspector shows the belt count too.
- **Implementation:**
  - Solver: replace or extend `EdgeResult.overCapacity` with
    `beltsNeeded = ceil(perMin / tier.ratePerMin)`.
  - UI: the `FlowEdge.tsx` label, and `EdgeInspector` in `Inspector.tsx`.
  - Pipes work the same way, with the pipe tier.
- **Tests:** a solver unit test for `beltsNeeded`, and a screenshot.

### 5. Better default zoom

**Done** (shipped with #1). Its behaviour is in
[production-planner.md](production-planner.md#interaction) ("Zoom"). The
user chose to keep a plan that's too big centered, and to stop zooming out
by hand at 30% (`MIN_ZOOM`).

**Value:** cards are hard to read on wide plans. **Effort:** XS.

- Clamp `fitView` with a `minZoom` (about 0.55) so cards stay readable;
  scrolling is fine.
- Add "Zoom to selection": the F key, or a button.
- In `PlanCanvas.tsx`, see `FIT_VIEW`.

### Quick win: rates on unconnected ports

**Done** (shipped with #1, requested by the user). A port with no belt yet
shows its rate under the item: red for what an input needs, amber for what an
output makes. A newly added miner shows what it gives without hovering. The
rules are in [production-planner.md](production-planner.md#presentation)
("Ports").

- The solver used to report an open end's output as connected, because of
  its hidden implicit-goal belt. It now reports `connected: false`; `used`
  still includes that flow.
- If #4 adds belt counts, unconnected ports could show them too.

---

## M2 — Smarter plans

### 6. Optimizer (mode 3)

**Value:** "pick the best recipes for me." This is the final goal named in the
spec. **Effort:** L.

- **UX:**
  - An "Optimize" action on a plan, or on a selected goal, with one objective:
    *fewest raw resources* (default), *least power*, or *fewest buildings*.
  - It proposes recipe changes, or builds a fresh chain like #2. Show a
    before/after diff that the player accepts or discards (one undo step).
- **Model** (linear program):
  - **Variables:**
    - `x_r ≥ 0`: machine-equivalents for each candidate recipe (unlocked
      only)
    - `e_i ≥ 0`: extraction or supply for each raw item `i`
  - **Constraints:** for every item, production − consumption ≥ goal demand.
    Byproducts become allowed surplus. Limits (⛔ nodes, and world limits
    from #11) cap `e_i`.
  - **Objective:**
    - Fewest raw resources: weight each raw resource by its scarcity (world
      supply from #11, or a fixed table at first).
    - Least power: the MW per machine-equivalent from `rates.ts`. Power is
      nonlinear in clock, so assume 100% clock.
    - Fewest buildings: sum of `x_r`.
  - Fractional machines are fine; no integer programming.
- **Library:** try [`javascript-lp-solver`](https://github.com/JWally/jsLPSolver)
  first (MIT, small, pure JS). If it is too slow or unreliable at about 300
  recipe variables, use `highs` (WASM). Run it in a Web Worker if a solve
  takes more than about 100 ms.
- **Implementation:**
  - Write a pure `optimize(catalog, goals, limits, objective)` in
    `src/planner/optimize.ts`, returning recipe rates.
  - Convert the result into a plan with #2's node-creation helpers and #1's
    layout.
  - Keep `solvePlan` as the single source of truth for displayed rates. The
    optimizer only chooses the structure.
- **Done when:**
  - It matches small cases checked by hand. Write the expected recipe mix
    into the test; don't trust memory of "best alternates".
  - It respects locked alternates and limits.
  - It reports infeasible plans clearly.
- **Tests:** LP unit tests on small hand-checked chains, and a sanity check
  that the optimized plan's `solvePlan` result meets every goal.

### 7. Split shares on outputs

**Value:** control over how a scarce input is split ("80 to plates, 40 to
rods") without numeric goals. **Effort:** S–M.

- **Today:**
  - When several Max goals (or open ends) share a limit, the solver splits it
    evenly: step 2 of `solveAnchored` weights each goal by
    `1 / (fraction of limits it uses)`.
  - `PlanEdge.share` exists, but only splits *demand* between several
    producers feeding one input.
- **Design:**
  - Add an optional `weight` to Max goals (`GoalNode`). Open ends get a weight
    from a per-node setting.
  - Multiply it into the fair-share weight in step 2.
  - The ⑂ split popup gets a share input per branch. Editing a branch's share
    sets the weights of the Max goals downstream of that branch.
- **Done when:** a 2 : 1 share on a 120-ingot split between plates and rods
  gives 80 / 40 ingots.
- **Tests:** solver unit tests next to "several Max goals behind one limit
  share it evenly".

### 8. Generators and net power

**Status:** done; the rules are in
[production-planner.md](production-planner.md#generators-and-power). Coal,
fuel, biomass and nuclear generators are recipe nodes with a 🎯 MW target,
Max, or on demand; the summary shows power used, made and net. Left: a
plan-wide power goal (#15). Geothermal is out of scope: no production chain
feeds it, so it adds nothing to plan (agreed 2026-10-14). The original notes:

**Value:** power is the next thing players plan, and nuclear waste chains
come with it. **Effort:** M.

- **Data:**
  - Model generators as **recipes** that consume fuel (plus water) and produce
    power, with nuclear waste as a byproduct. Add `Recipe.generatesMw?: number`
    and a `generation` tag.
  - Source: greeny's `generators` plus the overlay.
  - Numbers from the research:

    | Generator | MW | Fuels | Water | Byproduct |
    |---|---|---|---|---|
    | Biomass Burner | 30 | leaves, wood, mycelia, biomass, solid biofuel, packaged biofuel | — | — |
    | Coal-Powered | 75 | coal, compacted coal, petroleum coke | 45 m³/min | — |
    | Fuel-Powered | 250 | fuel, turbofuel, liquid biofuel, rocket fuel, ionized fuel | — | — |
    | Nuclear Power Plant | 2500 | uranium rod (0.2/min), plutonium rod (0.1/min), ficsonium rod (1/min) | 240 m³/min | 10 uranium waste/min, 1 plutonium waste/min, none |

  - Fuel per minute = MW × 60 / energy (MJ).
  - Generators scale **linearly** with clock, not with the 1.32 power curve.
    Generator machines need their own power-exponent semantics.
  - Geothermal needs no fuel: 100/200/400 MW on impure/normal/pure geysers.
    Out of scope: no production chain feeds it.
- **UX:**
  - Generator nodes look like recipe cards with a ⚡ output.
  - The summary shows **generated vs consumed MW, and the net**.
  - A goal of "+N MW" could come later.
- **Done when:** a coal plant chain shows the right coal and water per
  generator, and the net MW in the summary.

### 9. Share a plan as a link

**Value:** players send plans to each other with no backend. **Effort:** S.

- Compress the plan with [`lz-string`](https://github.com/pieroxy/lz-string)
  (`compressToEncodedURIComponent`) into `#/planner?plan=…`.
- On load, run `validatePlan`, open the plan in a **new tab**, and clean the
  URL.
- Add a "Copy link" button to the plan menu.
- Plans with dozens of nodes should stay under about 8 KB. Positions can be
  rounded to integers.

### 17. Use leftovers

**Value:** no machine stops because a byproduct backs up, and no resource is
left idle. One click suggests a whole chain that uses what's spare.
**Effort:** M. Do it after auto-build (#2), and ideally the optimizer (#6),
since it reuses both.

- **What counts as a leftover:** anything the summary lists as spare:
  - Byproducts. Heavy Oil Residue → Fuel leaves Polymer Resin, and Alumina
    Solution / Aluminum Scrap leave water.
  - Waste. Uranium Waste can become Plutonium Fuel Rods, and Plutonium Waste
    can become Ficsonium.
  - Unused source capacity, often in the middle of a long chain. Example:
    a plan started from a 240/min iron node that only uses 200 leaves 40.
- **UX:**
  - A "✨ Use this" button on any port with spare output, and next to each
    row of the summary's *Spare output* (and the waste warning).
  - It suggests a few complete downstream trees, best first. Examples:
    resin → Residual Rubber, leftover water → Wet Concrete, 40 iron ore →
    ingots → rods. Show each with its machines and what it still needs.
  - Picking one adds it as one undo step, laid out by #1. It is flexible, so
    the spare-byproduct rules (production-planner.md, Byproducts) size it
    from exactly what's left.
- **Finding candidates** (pure `suggestUses(plan, catalog, item, perMin)`):
  - Walk forward through `recipesConsuming` from the leftover item.
  - Stop at good endpoints:
    - an item already wanted in the plan (a goal or a missing input)
    - a generator fuel, possibly adding the generator on Max
    - an item worth AWESOME Sink points
  - Rank by how much of the leftover each tree uses, how few extra raw
    inputs it needs, and its machine count. The optimizer (#6) can do this
    as an LP: "use all of X" as a constraint, the plan's objective as the
    cost.
  - Respect locked alternates. Cap the depth, and guard against loops, as in
    #2.
- **Done when:**
  - Spare Uranium Waste suggests the plutonium rod chain.
  - Spare Polymer Resin suggests Residual Rubber or Plastic.
  - 40 spare iron ore gets at least one complete tree, and the spare is gone
    once it's added.

### 10. 1.2 power multiplier

**Status:** blocked. The user will provide the exact rules (game option range
0.25–5×; does it apply to generators?). **Effort:** XS once the rules are
known.

- Add `PlanSettings.powerMultiplier`. Apply it in `assemble()` (`solve.ts`)
  to consumption only, unless the rules say otherwise.
- Show it in the summary next to MW.
- The recipe-cost multiplier waits on its rules too. Ask whether it scales
  machine recipes or only building costs.

---

## M3 — Nice to have

### 11. World node limits

**Value:** "you only have 46 pure iron nodes on the map", plus resource caps
for the optimizer. **Effort:** M.

- **Data:**
  - Add a `worldSupply` list to packs, per map, with resource, site type,
    purity and count.
  - Counts for the default map, from the wiki:

    | Resource | Impure | Normal | Pure |
    |---|---|---|---|
    | Iron Ore | 39 | 42 | 46 |
    | Copper Ore | 13 | 29 | 13 |
    | Limestone | 15 | 50 | 29 |
    | Coal | 15 | 31 | 16 |
    | Caterium Ore | 0 | 9 | 8 |
    | Raw Quartz | 3 | 7 | 7 |
    | Sulfur | 6 | 5 | 5 |
    | Bauxite | 5 | 6 | 6 |
    | Uranium | 3 | 2 | 0 |
    | SAM | 10 | 6 | 3 |
    | Crude Oil (oil nodes) | 10 | 12 | 8 |
    | Crude Oil (well satellites) | 8 | 6 | 4 |
    | Nitrogen Gas (well satellites) | 2 | 7 | 36 |
    | Water (well satellites) | 7 | 12 | 36 |

  - Geysers: 9 / 13 / 9. Water from Water Extractors is unlimited.
  - Sources: the per-resource pages on satisfactory.wiki.gg, e.g.
    [Iron Ore](https://satisfactory.wiki.gg/wiki/Iron_Ore). Re-check them
    before committing.
- **UX:** a per-plan "Map: default / custom counts" setting (1.2 World
  Randomization changes them). The summary shows the nodes used vs available
  per resource, and warns when a plan uses more than exist.

### 12. Byproduct-driven chains

**Status:** done, moved up with #8 because nuclear waste needs it. The rules
are in [production-planner.md](production-planner.md#byproducts): spare
byproducts flow on, Max goals get them, numeric goals fall short instead of
growing the maker, and spare is used before other producers. Left for the
optimizer (#6): choosing the best mix of byproduct and dedicated producers,
and naming the missing input of a loop that can't settle. The original notes:

**Value:** "burn my spare Heavy Oil Residue into fuel" works without adding a
goal. **Effort:** M. The optimizer (#6) covers most of this.

- **Today:** demand only flows from goals, so a chain fed only by a byproduct
  gets nothing.
- **Idea:** a second pass that treats the spare output on a byproduct port
  feeding a consumer as a limited supply, sized from the first pass's
  production, and lets the open-end rule fill the downstream chain. Watch for
  feedback when that chain loops back.

### 13. Inspector covering cards

**Value:** small polish. **Effort:** S. The docked inspector narrows the
canvas, so cards on the right can slide underneath it. When a node is
selected, pan it into view if it ended up under the inspector, or offer an
overlay mode.

### 14. Belt line style in the balancer

**Value:** consistency. **Effort:** XS.

- Reuse the planner's `edgeStyle` preference in `GraphView.tsx`.
- *Angled* keeps the lane router (`beltRouting.ts`). *Straight* and *curved*
  skip the router and use `getStraightPath` / `getBezierPath`.

### 16. Byproduct loops

**Value:** correctness. Loops that feed a byproduct back into their own chain
are common, and today they break the solver. **Effort:** M–L. Needs design
before code; it may be best solved together with the optimizer's LP (#6).

- **Examples:**
  - Aluminum: Alumina Solution needs water, and Aluminum Scrap gives some
    back; players pipe it to the Alumina Solution water input, topped up by
    a Water Extractor.
  - Ficsonium: each Ficsonium Fuel Rod needs 40 Dark Matter Residue and
    gives 20 back to the Particle Accelerator.
  - Any recipe loop where an item comes back as a byproduct.
- **What happens today** (reproduced on 2026-10-14, Alumina Solution →
  Aluminum Scrap with the water piped back):
  - Loop plus Water Extractor, Scrap 🎯360: rates run away to ~10¹⁷⁷ and the
    plan says "A loop in the plan never settles".
  - Only the loop, no other water: rates run to infinity with no warning.
  - ⛔ Bauxite with a Max goal: **everything is 0**.
- **Why:** byproduct belts *inside* a loop are still pulled (the stage split
  in `solve.ts` only cuts belts between stages). Demand for the water makes
  the scrap refinery grow, which needs more alumina, which needs more water.
  The equal share on the water input also asks the loop for half the water,
  whatever it can give. The runaway makes a Max goal's cost infinite, so it
  gets 0.
- **Directions to explore:**
  - Treat a byproduct belt that closes a loop as *spare*: it carries what
    the maker makes, used first, and the other producers make up the rest.
    That's the same rule as between stages, but solved as a fixed point
    inside the loop.
  - If the loop alone can't supply itself (gain ≥ 1, as with Ficsonium),
    report the shortfall as a missing input: "needs 20 more Dark Matter
    Residue/min". Don't let it run away.
  - Or hand loops to the LP from #6, which handles them exactly. Keep the
    demand passes for loop-free plans.
- **Done when:** the three aluminum cases above give finite, correct rates
  (scrap 360 with the extractor topping up the water), the Max case is no
  longer 0, and the Ficsonium loop names its missing input. Add each as a
  solver test.

### 15. Power goal

**Value:** "power this factory" or "I need 20 GW" in one setting, instead of
sizing each generator group by hand. A nice-to-have: per-group 🎯 MW targets
(#8) already cover it with a little arithmetic. **Effort:** S–M.

- **UX:** a power goal in the summary's power section, with two modes:
  - *Cover what the plan uses:* generators make at least the plan's own
    consumption, so the net is never negative.
  - *A fixed amount:* "+N MW" on top of, or including, the plan's use.
- **Which generators:** groups set to a new *Share of power goal* mode share
  the goal by weight (default equal), the way edge shares split demand. A
  plan with one such group gives it the whole goal.
- **Implementation:**
  - Store it in `PlanSettings` (optional, so saved plans keep loading).
  - In the solver, the goal turns into numeric targets on those groups.
  - "Cover the plan's use" is circular, because the fuel chains draw power
    too. Iterate: solve, set the target to the consumption, solve again,
    until it settles (a few rounds, since fuel chains use a small share of
    what they make).
- **Done when:** a coal plan set to "cover the plan's use" shows net ≥ 0, and
  changing the factory updates the generator count.

---

## Deferred: mods and data tooling

Not planned until the vanilla roadmap is done. The data model already supports
these; see [data-model.md](data-model.md).

- **Mod packs in the UI:** upload a pack JSON, validate it with zod, store it
  in IndexedDB, and enable or disable packs per plan. `buildCatalog` already
  merges packs and reports diagnostics.
- **Importers:** ContentLib JSON (mods), and the game's own
  `CommunityResources/Docs/en-US.json` (UTF-16). The Docs importer matters
  only when a game patch changes recipes; until then, `npm run data:base` from
  greeny's data is enough.
- **In-game check:** the Smelter's Somersloop slots. The game data says 0,
  while the wiki and other tools say 1, which is what we use. The user can
  check this in a minute.
