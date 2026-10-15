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
| 2 | [Auto-build upstream](#2-auto-build-upstream-mode-2) | M1 | Very high | M | Done (PR #9) |
| 3 | [Compare recipes at this node's rate](#3-compare-recipes-at-this-nodes-rate) | M1 | High | S | Done (PR #11) |
| 4 | [Belt counts instead of red edges](#4-belt-counts-instead-of-red-edges) | M1 | Medium | XS–S | Done (PR #11) |
| 5 | [Better default zoom](#5-better-default-zoom) | M1 | Low–Med | XS | Done (PR #5) |
| — | [Rates on unconnected ports](#quick-win-rates-on-unconnected-ports) | M1 | Medium | XS | Done (PR #5) |
| 6 | [Optimizer](#6-optimizer-mode-3) | M2 | Very high | L | Done (PR #17) |
| 7 | [Split shares on outputs](#7-split-shares-on-outputs) | M2 | Medium | S–M | Planned |
| 8 | [Generators and net power](#8-generators-and-net-power) | M2 | Med–High | M | Done (PR #6) |
| 9 | [Share a plan as a link](#9-share-a-plan-as-a-link) | M2 | Medium | S | Planned |
| 17 | [Use leftovers](#17-use-leftovers) | M2 | High | M | Planned, after #2 and #6 |
| 10 | [1.2 power multiplier](#10-12-power-multiplier) | M2 | Medium | XS | Blocked on user's rules |
| 11 | [World node limits](#11-world-node-limits) | M3 | Medium | M | Done (PR #17) |
| 12 | [Byproduct-driven chains](#12-byproduct-driven-chains) | M2 | Med–High | M | Done (PR #6) |
| 13 | [Inspector covering cards](#13-inspector-covering-cards) | M3 | Low | S | Done (PR #11) |
| 14 | [Belt line style in the balancer](#14-belt-line-style-in-the-balancer) | M3 | Low | XS | Later |
| 15 | [Power goal](#15-power-goal) | M3 | Low | S–M | Later |
| 16 | [Byproduct loops](#16-byproduct-loops) | M3 | High | M–L | Done (PR #15) |
| 18 | [How to belt or pipe a connection](#18-how-to-belt-or-pipe-a-connection) | M3 | Low | S–M | Done (PR #21) |
| 19 | [Balancer with several inputs](#19-balancer-with-several-inputs) | M2 | Med–High | M | Done (PR #21) |
| 20 | [Build cost](#20-build-cost) | M2 | Med–High | S–M | Done (PR #12) |
| 21 | [Build checklist](#21-build-checklist) | M2 | High | S | Done (PR #12) |
| 22 | [Resources to avoid](#22-resources-to-avoid) | M2 | High | S | Done (PR #19) |
| 23 | [Lock standard recipes](#23-lock-standard-recipes) | M2 | Medium | XS–S | Done (PR #20) |
| 24 | [Game progress](#24-game-progress) | M2 | High | M | Done (PR #20) |
| 25 | [Byproduct makers shared between stages](#25-byproduct-makers-shared-between-stages) | M3 | Medium | M | Later |
| 26 | [Game progress, finer](#26-game-progress-finer) | M3 | Low–Med | S | Later, after #24 |
| 27 | [Splits as players build them](#27-splits-as-players-build-them) | M2 | High | M | Done (PR #22) |
| — | [Mods and data tooling](#deferred-mods-and-data-tooling) | — | — | — | Deferred |

When an item ships, change its status to **Done (PR #n)** and move its rules
into `production-planner.md`.

### Delivery plan

Items are grouped into PRs by the code they touch and how much they risk,
since every merge deploys. Changes to how the solver calculates rates get
their own PR. Agreed with the user on 2026-10-14; one agent works through
them in this order. #19–#21 came from the user's testing of #2 on
2026-10-14; "Build in game" goes before the solver work because it is small
and useful straight away while playing. Reorder freely.

**Next up (2026-10-14): order 8, Use leftovers (#17).** Orders 1–7 are done, and so is #27.

| Order | PR | Items | Why together |
|---|---|---|---|
| 1 | Build chain | #2 | Done (PR #9). #6 and #17 reuse its node-building helpers. |
| 2 | Refine and read | #3, #4, #13 | Done (PR #11). Closes M1. |
| 3 | Build in game | #21, #20 | Done (PR #12). |
| 4 | Byproduct loops | #16 | Done (PR #15), without the LP: loops are solved with the spare-byproduct rule. Isolated because it changes rates. |
| 5 | Optimize | #6, #11 | Done (PR #17), after a solver fix it needed (PR #16: byproducts feeding their maker's own goal). |
| 6a | Resources to avoid | #22 | Done (PR #19). From the user's testing of #6 (2026-10-14): "build this without oil". Split from 6b on 2026-10-14: it covers the oil case alone and touches Optimize and Build chain, not prefs. |
| 6b | Game progress | #23, #24 | Done (PR #20). Plan early in the game with only what's unlocked. Together because both reshape the Recipes dialog and prefs (one migration, `lockedAlternates` → `lockedRecipes` plus progress); #23 alone is mostly groundwork for #24. |
| 7 | Real belts | #19, #18 | Done (PR #21). Both turn one logical flow into belts you can build, and share a helper that puts machines onto belts (`src/planner/belts.ts`). |
| 7b | Splits as players build them | #27 | Done (PR #22). From the user's testing of #19: balancers for real plan rates were absurd. |
| 8 | Use leftovers | #17 | Builds on #2 (adding nodes) and #6 (ranking suggestions). |
| any time | Small standalones | #9, #15, #14, #26 | Independent; slot one in between the big ones. |
| later | Solver | #25 | Changes rates, so its own PR. |
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

**Done.** Its behaviour is in
[production-planner.md](production-planner.md#interaction) ("⚡ Build
chain"). Differences from the plan below: raw resources are mined before
the remembered recipe is tried (so a remembered converter recipe never
replaces a miner); reuse also covers extractors and supplies, ⛔ limited ones
included; the loop guard tracks items on the current path rather than
`(item, recipe)` pairs; and the Modular Frame chain needs only Iron Ore
(the standard recipes use no limestone). For #6 and #17: `chooseProducer`,
`buildUpstream` and `openInputs` in `src/planner/autobuild.ts`, and
`CanvasApi.buildChain` in `PlanCanvas.tsx` (build, lay out, fit).

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

**Done.** Its behaviour is in
[production-planner.md](production-planner.md#interaction) ("Editing").
The user chose "at this node's rate" as the default view; the toggle is a
preference. Generators compare fuels at the group's MW.

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

**Done.** Its behaviour is in
[production-planner.md](production-planner.md#presentation) ("Edges").
Red is kept for one case only, and it's a real error: one machine at
either end makes or takes more than a belt of the tier carries. The count
would be meaningless there (one machine's 120/min can't go onto two 60/min
belts), so the edge shows the tier it needs instead ("needs Mk.2"), as
the user pointed out while testing. `EdgeResult.overCapacity` became
`belts: { tier, count }`, or `tooFast: { perMin, end, needs }`. The count sits under the rate (not `240 · 2× Mk.2` on one
line) so labels fit between Tidy's columns. Not done: counts on
unconnected ports. For #18 and #19, `belts.count` is the starting point.

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

**Done.** Its behaviour is in
[production-planner.md](production-planner.md#interaction) ("✨ Optimize").
How it went against the notes below:
- The LP is a small dense two-phase simplex of our own (`src/planner/lp.ts`),
  not `javascript-lp-solver` (unmaintained since 2019, no types). A whole
  rocket solves in under 10 ms, so no Web Worker. The item rows all have a
  right-hand side of 0, which makes it badly degenerate: rows are relaxed
  by tiny, different amounts, and the exact answer is recovered from the
  final basis.
- It works on the whole plan, not a selected goal: kept nodes (goals,
  sources, generators, ⛔ groups) stay, flexible machine groups are rebuilt.
- Building plans from LP flows found a solver bug: a byproduct feeding its
  maker's own goal (alumina's silica to the ingot) was cut into a later
  stage and came out as 0. Fixed separately first (PR #16).
- A Max goal behind one ⛔ limit pulls in new, unlimited resources to
  stretch it, whatever the objective. That's the point of "how much power
  can I get from one uranium node?" (the user's use case, 2026-10-14), so
  Max generators are maximized together, in MW: uranium plants plus the
  plutonium plants burning their waste.
- Byproduct water is never piped back by the optimizer (water is free).
- Follow-up (solver): a byproduct maker shared by two stages doesn't hand
  its later-stage growth to that stage's consumer; the optimizer adds a
  producer instead. See production-planner.md, Follow-ups.

The original notes:

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

### 19. Balancer with several inputs

**Done.** Its behaviour is in the [README](../README.md#several-inputs) and
[production-planner.md](production-planner.md#presentation) ("Splits and
merges"). Only *packing* was built: the user picked it over *proportional*
(2026-10-14). Not done: grouping a mix of different input rates onto belts
(the balancer's "Group onto belts" only handles one machine group). The
popup starts with one input per machine, not grouped, even for big groups:
grouping first means splitting again, which made far more complex graphs.

**Value:** a realistic balancer for big flows. Asked for by the user on
2026-10-14 while testing #2. **Effort:** M. Do it after #4, together with
#18.

- **Problem:** the ⑂ popup and "Open in Load Balancer" treat a split as one
  input belt. Balancing 2004/min from a single source can't be built: no belt
  carries more than 1200/min (Mk.6). In the game the producing group is many
  machines, each with its own output.
- **UX:**
  - The balancer gets an optional **several inputs** toggle. It's off by
    default, so the balancer works as today.
  - When it's on, the input is several belts: a count of equal inputs (8 ×
    250/min), or a list of rates.
  - **From the planner:** the popup and the link start with one input per
    machine in the producing group. A fractional count gives one smaller
    input: 7.5 machines at 100/min are 7 × 100 + 1 × 50.
  - **With a belt limit selected:** no input, internal belt or output may
    go over the tier. The toggle can combine machines onto the fewest input
    belts that fit (2004/min on Mk.6: 2 belts of 1002), and an output over
    the limit is reported, or split into several output belts.
  - Links keep working: `in=120` stays one input, and a new form such as
    `in=8x250` or repeated `in=` adds inputs.
- **Solver** (`src/solver/`, framework-free):
  - Generalise `SolveInput` from one input rate to a list of input rates.
  - Two ways to build it; prototype both and keep what the simulator checks
    and the user prefers:
    - *Proportional:* split every input by the outputs' ratios (one
      balancer per input), then merge per output with merger trees (≤3 per
      merger). Always exact, and no belt carries more than its input, but it
      takes many splitters.
    - *Packing:* send whole inputs straight to an output where they fit, as
      in a transportation problem, and split only the few inputs that
      straddle two outputs. Far fewer buildings, and closer to what players
      build.
  - Every result is still checked by `simulate()`.
  - Grouping machines onto belts is the same helper #18 needs. Write it
    once in `src/planner/`.
- **Done when:** 2000/min from 20 machines at 100/min, split 1200 / 800 with
  a Mk.6 limit, gives a balancer that simulates exactly with no belt over
  1200, and the planner's ⑂ popup opens it with the inputs filled in.
- **Tests:** solver tests that simulate multi-input graphs (equal inputs, a
  partial input, a belt limit), and a screenshot of the popup.

### 20. Build cost

**Done.** Its behaviour is in
[production-planner.md](production-planner.md#interaction) ("Build cost").
`Machine.buildCost` comes from greeny's build-gun recipes; every vanilla
machine has one. Costs are counted whole per node, from the new
`NodeResult.buildings`. Not done: belts, pipes, splitters and mergers.

**Value:** "what do I need to bring to build this?" The summary already
counts buildings; this adds the materials they cost. Asked for by the user
on 2026-10-14. **Effort:** S–M.

- **Data:** available. greeny's `data1.0.json` has a build recipe for every
  building (`forBuilding: true`, 500 of them), e.g. Constructor = 2
  Reinforced Iron Plate + 8 Cable. `scripts/import-base.ts` drops them
  today (`.filter((r) => r.inMachine && !r.forBuilding)`).
  - Add `Machine.buildCost?: ItemAmount[]` to the pack format, so mods can
    add or patch it. Update `data-model.md`.
  - Resource wells: the pressurizer plus a satellite per site.
  - Fill any gaps in `base-overlay.ts`. A machine with no cost shows as
    "cost unknown" rather than 0.
- **UX:**
  - A "Build cost" section in the summary: total items for the buildings
    the plan needs, counted whole (`ceil` per group, like the Buildings
    section), next to the power shards and Somersloops already listed.
  - **With #21, the checklist drives what's left:** the section shows the
    total and **still needed**, which leaves out every node marked done.
    Marking a node done takes its buildings' cost off "still needed" right
    away, and unmarking puts it back. A done node that now needs more
    machines (done with 6, now needs 8) still counts the 2 extra.
  - Maybe later: belts and pipes (their length isn't known), and splitters
    and mergers counted from the ⑂ / ⑃ badges.
- **Implementation:** a pure `buildCost(plan, result, catalog)` in
  `src/planner/`, from `result.totals.machines` or per node.
- **Done when:** the Modular Frame chain from #2 shows its cost, and the
  numbers match the wiki for a couple of buildings. Once #21 is in, marking
  nodes done lowers "still needed" by exactly their cost.
- **Tests:** importer output for a few machines (Constructor, Miner Mk.3,
  Nuclear Power Plant), and unit tests for `buildCost`.

### 21. Build checklist

**Done.** Its behaviour is in
[production-planner.md](production-planner.md#interaction) ("Build
checklist"). Changed while building, at the user's request: a node whose
plan now needs more machines than it was marked done with **isn't done**
any more. It is highlighted, left out of the progress count, and only its
extra machines count toward "still needed". The "show what's left" view
wasn't built; done cards fade instead.

**Value:** keeps track of a plan while building it in the game, often
across several sessions. Asked for by the user on 2026-10-14. **Effort:** S.

- **What it is** (agreed with the user, 2026-10-14): a visual aid, one mark
  per node meaning "I'm done with this node". Nothing more:
  - Belts and pipes can't be marked.
  - No partial progress: a node is done or not ("6 of 10 built" is out).
- **UX:**
  - A ✓ toggle on the card (a corner badge) and in the inspector. Done cards
    get a green check and fade a little, so what's left stands out.
  - The summary shows progress, e.g. "12 of 30 nodes done". With #20, the
    build cost's "still needed" leaves out done nodes (see #20).
  - Maybe a "show what's left" view that dims everything done.
- **Nice to have: a warning when the plan changes.** If a node was marked
  done with 6 machines and an edit later needs 8, the card warns "done with
  6, now needs 8". For that, the mark stores the machine count at the time
  (`done?: { count: number }` on `PlanNodeBase`, optional so saved plans
  keep loading). The count is only for the warning; there is no way to enter
  partial progress.
- **Implementation:**
  - Not part of solving; `solvePlan` ignores it.
  - Set it through a helper in `edit.ts`, as one undo step. Duplicated or
    pasted nodes start not done.
- **Done when:** marks survive a reload and export/import, the summary shows
  progress, and a done node that needs more machines after an edit is
  flagged.
- **Tests:** edit helper tests (toggle, copy clears it), and a screenshot of
  done and not-done cards.

### 22. Resources to avoid

**Done.** Its behaviour is in [production-planner.md](production-planner.md)
("Don't use", under ✨ Optimize and ⚡ Build chain). ⚡ Build chain follows
the same per-plan list, and the list is also in the summary's Settings, so
it can be set without opening Optimize. The original notes:

**Value:** "build this factory without oil". Today the only ways are locking
every oil recipe (dozens, and locks apply to every plan) or setting Crude
Oil to 0 in World nodes (meant to describe the map, not a wish).
**Effort:** S.

- **UX:** in the ✨ Optimize dialog, a "Don't use" row of resource chips
  (the raw resources the program could mine). Picking one re-solves at once.
  Saved per plan, since it's about this factory, not your game.
- **Model:** `PlanSettings.avoid?: ItemId[]`, optional (old plans load).
  In `optimize`, an avoided resource gets no new extractor column and no
  import; the plan's own extractors and supplies of it still count (they
  are what the player has; say so in the hint).
- ⚡ Build chain should respect it too: `chooseProducer` skips recipes that
  need an avoided resource when another way exists, and ends at a supply
  node otherwise. Decide with the user whether Build chain reads the same
  per-plan list.
- When nothing can be made without it, the dialog says which resource
  blocks which goal ("Plastic needs Crude Oil").
- **Tests:** plates with oil alternates unlocked and Crude Oil avoided use
  no oil; a goal that needs oil reports it.

### 23. Lock standard recipes

**Done.** Its behaviour is in [production-planner.md](production-planner.md)
("Recipes"). The original notes:

**Value:** turn off any recipe, not just alternates: "I don't want this
one", and the building block for #24. **Effort:** XS–S.

- The "Alternate recipes" dialog becomes "Recipes", with a Standard /
  Alternate filter. `Prefs.lockedAlternates` becomes `lockedRecipes`;
  `loadPrefs` migrates the old key.
- Everything already goes through `isRecipeHidden` (pickers, recipe
  dropdown, ⚡ Build chain, ✨ Optimize), so little else changes. A locked
  recipe already in a plan keeps working and stays shown there.
- `chooseProducer` already falls back from standard to alternates to a
  supply node; check that ordering with locked standard recipes.

### 24. Game progress

**Done.** Its behaviour is in [production-planner.md](production-planner.md)
("Recipes") and [data-model.md](data-model.md) (`Schematic`). As built:
alternates count once the milestones and research they need are done, and
the per-recipe locks say which hard drives you haven't found; recipes
greeny lists under no schematic come with their building. Machines are
still all shown. The original notes:

**Value:** plan early in the game: ⚡ Build chain and ✨ Optimize only use what
you've unlocked. **Effort:** M.

- **Data:** greeny's `data1.0.json` (already our source) has `schematics`:
  every milestone with its tier (0–9), MAM research, alternates' hard
  drives, and the recipes each unlocks. E.g. *Oil Processing* is Tier 5 and
  unlocks Plastic, Rubber, Fuel, Petroleum Coke and Circuit Board.
  - Import them into the base pack as a new entity kind (`schematics`:
    id, name, kind, tier, unlocked recipe ids), so mods can add their own.
  - Skip customization and AWESOME Sink schematics.
- **UX:** the Recipes dialog (#23) gets a "Game progress" header: pick your
  tier ("Tier 4" unlocks Tiers 0–4), tick MAM research and alternates you
  have. Per-recipe locks stay as overrides on top.
- **Model:** prefs, not per plan (it's about your save): unlocked tier,
  unlocked schematic ids, plus #23's recipe overrides. A recipe is usable
  if a schematic unlocking it is unlocked (or it has none) and it isn't
  locked by hand.
- Buildings unlock with milestones too (the Refinery at Tier 5); machines
  could be hidden the same way later.
- **Tests:** at Tier 4, plastic isn't usable and Optimize says so; at
  Tier 5 it is.

### 27. Splits as players build them

**Done.** Its behaviour is in the [README](../README.md#precision)
(Precision) and [production-planner.md](production-planner.md#presentation)
("Splits and merges").

**Value:** asked for by the user on 2026-10-14, after #19: a nuclear plan's
balancers were dozens of splitters and loopbacks deep, mostly to split
fractions of a part per minute. Their example, 1956 iron ingots into 92.4 /
88.9 / 1077.2 / 697.5, took 25 splitters, 27 mergers and 123 loopbacks.
**Effort:** M.

- **Agreed with the user:** both a rounding tolerance (A) and suggestions of
  how players really build splits (B). The tolerance is a **percentage** of
  each output: half a part per minute matters at 1.5/min, not at 100.5/min.
- **A, precision:** Exact / ±1% / ±2% / ±5% in the balancer and the split
  dialog (`SolveInput.tolerance`, `src/solver/approx.ts`). It searches ratios
  of up to 600 shares within the tolerance and keeps the one with the fewest
  buildings, loopbacks counted double. A Leftover never backs up, so with one
  present the other outputs only round up. With several inputs, tiny cuts are
  dropped (the floor), since each output shares its allowance among its cuts.
- **B, the split dialog:** Manifold (recommended when every branch pulls, or
  one goal goes last for the overflow), Load balancer, and Dedicated machines
  with a "Split into N groups" plan edit.
- **Not done:** remembering the dialog's precision between visits; manifold
  diagrams (the tab is text and a table); treating a goal as a machine when
  the player knows it backs up.

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

### 25. Byproduct makers shared between stages

**Value:** correctness, and cheaper optimized plans. **Effort:** M. Found
while testing #6 (one uranium node feeding uranium and plutonium plants).

- **What happens:** a byproduct maker that serves two stages (one Heavy Oil
  Residue refinery for both the uranium and the plutonium chain) grows when
  the later stage needs more of its main product, but only the earlier
  stage's spare byproduct reaches the byproduct's consumer in the later
  stage. Its extra polymer resin goes unused, and the consumer is short.
- **Today:** ✨ Optimize works around it by adding another group of the
  recipe for the rest (`optimize.ts`, after `topUpSpares`).
- **Direction:** in `solvePlan`, a cut belt whose maker is borrowed by the
  consuming stage should also carry what the maker makes for that stage,
  as a spare belt inside it, on top of the earlier stage's spare.
- **Done when:** the uranium + plutonium plan from the #6 tests needs no
  extra groups, and its LP flows match the solver's.

### 26. Game progress, finer

**Value:** game progress (#24) that matches a save more closely, and says
more. **Effort:** S. Found while building #24.

- **Pick milestones, not just a tier.** Players unlock milestones out of
  order; "Up to Tier 4" unlocks all of Tiers 0–4. Let the dialog tick
  single milestones of the next tiers on top of the tier.
- **Hide machines too.** Buildings unlock with milestones (the Refinery
  with Oil Processing), so the "+ Add anything" palette could leave out
  machines that aren't unlocked. Recipes already gate most of it.
- **Say what's missing in ✨ Optimize.** When no usable recipe makes an
  item, the note could name what would unlock one ("Plastic: Tier 5 (Oil
  Processing)"), with `recipeAccess` / `needsLabel` from `progress.ts`.
- **MAM prerequisites.** greeny's data has no MAM tree order, so research
  nodes are ticked one by one. If a source with the tree turns up, ticking
  a node could tick what it needs.

### 11. World node limits

**Done.** Its behaviour is in [production-planner.md](production-planner.md#interaction)
("World nodes") and [data-model.md](data-model.md). The counts below were
checked against each wiki page's maximum per minute. The original notes:

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
and naming the missing input of a loop that can't settle (done for byproduct
loops in #16). The original notes:

**Value:** "burn my spare Heavy Oil Residue into fuel" works without adding a
goal. **Effort:** M. The optimizer (#6) covers most of this.

- **Today:** demand only flows from goals, so a chain fed only by a byproduct
  gets nothing.
- **Idea:** a second pass that treats the spare output on a byproduct port
  feeding a consumer as a limited supply, sized from the first pass's
  production, and lets the open-end rule fill the downstream chain. Watch for
  feedback when that chain loops back.

### 13. Inspector covering cards

**Done.** Agreed with the user: pan rather than an overlay. When the
canvas narrows (the inspector opening), it pans just enough to keep the
selected nodes in view (`reveal` in `PlanCanvas.tsx`); nodes added from a
picker use the same pan. The rules are in
[production-planner.md](production-planner.md#interaction) ("Inspector").

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

**Done.** Its behaviour is in
[production-planner.md](production-planner.md#byproducts) ("Byproducts piped
back into their own chain"). We took the first direction below, not the LP:
a byproduct belt that loops back into its maker's chain is a *spare belt*
inside the maker's stage. It doesn't pull, carries what the maker makes, and
is used first. Leaving those belts out, the pulled part of the loop has no
cycle, so the demand pass settles in a couple of rounds, and the existing
rules (limits, Max goals, edge shares) keep working unchanged. The LP moved
to the Optimize PR (#6), where it has a user. What a loop can't give back is
a missing input (`shortfall` in `solve.ts`), and ⚡ Build chain tops it up
(`missingInputs` in `autobuild.ts`). Main-product loops (Recycled Plastic ⇄
Rubber) are still pulled, as before. The original notes:

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

### 18. How to belt or pipe a connection

**Done.** Its behaviour is in
[production-planner.md](production-planner.md#presentation) ("Edges"). It
lives in the belt inspector only (the user's choice, 2026-10-14), with no
hint on the edge label. Not done: suggesting where a splitter or merger goes
when the two ends don't line up; the inspector says how many extra machines
keeping the belts apart costs instead.

**Value:** low priority, asked for by the user on 2026-10-14. #4 says *how
many* belts an edge needs ("2000 · 2× Mk.6"); this says *how to build them*.
**Effort:** S–M. Do it after #4, in one PR with #19 (the balancer's
several inputs), which needs the same machines-onto-belts helper.

- **The idea:** an edge joins two machine groups, so it never has to be one
  belt. For an edge carrying 2000/min, suggest a concrete way to carry it:
  - **How many belts, of which tier:** the fewest belts of the plan's tier,
    and the alternatives with other tiers (2000/min: 2× Mk.6, 3× Mk.5,
    5× Mk.4, …). With no tier set, show the options anyway.
  - **How to divide the flow:** even (2 × 1000) or fill-first (1200 + 800).
    Prefer even, since each belt then has headroom.
  - **Which machines feed which belt:** split the producing group into
    sub-groups, each fitting on one belt. Example: 20 machines making
    100/min each = 2000/min → 2 belts of 10 machines (1000/min each). With a fractional
    count (7.5 machines), say which belt gets the partly-clocked machine.
  - **Same at the consumer end:** which consumers each belt feeds, so the
    belts stay separate and no merger or splitter is needed. If the counts
    don't line up, say where a splitter or merger goes, and link to the load
    balancer (`#/balancer?in=…&out=…`) for the uneven case.
- **Pipes work the same way,** with the pipe tier (Mk.1 300, Mk.2 600):
  900 m³/min of water → 2 pipes, e.g. 4 Water Extractors on one pipe (480)
  and 3.5 on the other (420).
- **UX** (ask the user before building):
  - A "How to build" section in the belt inspector (`EdgeInspector` in
    `Inspector.tsx`), shown when the edge needs more than one belt or pipe.
  - Maybe a hint on the edge label too.
- **Implementation:**
  - A pure helper in `src/planner/` (e.g. `beltPlan(perMin, tiers, from,
    to)`), taking the producing and consuming groups' machine counts and
    per-machine rates from `SolveResult`. Use catalog tiers, never literal
    rates.
  - Edges from a split, or into a merge, only carry part of a group's
    output. Use the edge's own rate and share of the group.
- **Tests:** unit tests for the helper (even splits, fractional counts, pipes,
  no tier set), and a screenshot of the inspector.

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
