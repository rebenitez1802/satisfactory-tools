# Production planner

v1 shipped. This doc is both the spec of how it behaves and the list of
what's deliberately deferred ([Follow-ups](#follow-ups)).

The user builds a production chain on a canvas and the app works out rates,
machine counts, power and totals. The same plan answers **backward**
questions ("what do I need for 120 plates/min?"), **forward** questions ("what
can I make from 90 iron ore/min?") and mixes of both. The data layer is in
[data-model.md](data-model.md).

## Modes (roadmap)

1. **Manual planner (v1).** You place and connect nodes; the app sizes them
   from your targets and limits.
2. **Auto-build** (⚡ Build chain, below). Given a goal or a missing input,
   the app fills in the chain back to raw resources.
3. **Optimize** (✨ Optimize, below). Given inputs and goals, the app picks
   recipes and shares scarce resources with a linear program. It uses the
   same targets and limits as v1.

## Nodes

Each node is a **group**: "Constructor ×4 @ 100%, Iron Plate". You can have
any number of groups running the same recipe as separate lines. Nothing gets
merged behind your back.

| Kind | What it is | Anchor |
|---|---|---|
| `recipe` | machines running one recipe | may be ⛔ limited ("I have 4 Constructors") |
| `extractor` | miners/extractors on resource nodes, by purity | may be ⛔ limited ("these nodes are what I have") |
| `supply` | items arriving from outside the plan | may be ⛔ limited ("I get 90/min") |
| `goal` | what the plan should deliver | 🎯 target: a number, or **Max** |
| `recipe` on a generator | generators burning one fuel | 🎯 power target in MW, or **Max**; may also be ⛔ limited |

Edges are belts or pipes you draw, carrying one item from an output port to
an input port of the same item. Connections are explicit; nothing is wired up
implicitly by item.

## Targets and limits

Every number you type is either a **target** (on goals) or a **limit** (on a
⛔ node). Every other node is **flexible**: it is sized from those numbers and
never overwrites them.

- A flexible recipe node keeps your clock and Somersloops as preferences, and
  its machine count is derived.
- A flexible supply shows what it needs to provide.
- A flexible extractor is sized like a recipe node: it shows how many
  resource nodes (or Water Extractors) it needs, at the preferred clock, and
  never overclocks past the maximum. 180 iron ore/min on Mk.1 miners is 3
  normal nodes at 100% (1.5 pure ones); 900 m³/min of water is 7.5 Water
  Extractors (or 8 at 93.75% in whole-machine mode). You pick the purity;
  mixed purities need ⛔ Limit, where the nodes you list are what you have.
  A flexible group saved with mixed purities counts in their average.
  Resource wells count satellites, plus one pressurizer.

The calculation, per connected chain:

1. **Work back from the numeric targets.** Demand flows upstream along edges
   and adds up where branches share a node. A node with several outputs is
   sized by its most-demanded output; the rest is surplus.
2. **Check the limits.** If a limited node would have to exceed its limit,
   every target in the chain is scaled by the same factor `r` (< 1). The
   tightest limit is the **bottleneck**, and the goals show how far short they
   fall.
3. **Fill Max goals** with whatever capacity the limits have left after the
   targets. A Max goal with no limit upstream is reported as unbounded.
4. Whatever demand is left over at a limited source is shown as unused.
5. **Open ends:** a chain with a limit but no goal treats each node with
   nothing connected downstream as a Max goal on its main output. A lone
   miner, or miner → smelter, therefore shows its full output without adding a
   goal.

Examples, using Iron Ore → Ingot → Plate:

| Setup | Result |
|---|---|
| Miner ⛔90, goal Max | 60 plates/min |
| goal 🎯120, no limits | miner needs 180/min; 6 Smelters, 6 Constructors |
| Miner ⛔90, goal 🎯120 | 60 of 120 plates (50%); miner is the bottleneck |
| Miner ⛔300, goal 🎯120 | 120 plates; 120 ore/min unused |
| Constructors ⛔4, goal Max | 80 plates/min; miner needs 120/min |

Known v1 simplifications (Option 3 lifts them):
- Demand on an input with several producers is split by edge **share**
  (default: equal), except that spare byproducts are used first (below).
- Several numeric goals behind one bottleneck are scaled together; several
  Max goals share the limits evenly (each uses the same fraction of them).

## Generators and power

Generators are machines that run one recipe per fuel: the Nuclear Power
Plant has *Uranium Fuel Rod*, *Plutonium Fuel Rod* and *Ficsonium Fuel Rod*
recipes, the Coal-Powered Generator has coal, compacted coal and petroleum
coke, and so on. Each recipe takes the fuel (plus water where needed) and
outputs any waste. Geothermal generators are left out on purpose: no production chain feeds
them.

- A generator group is an **anchor**, like a goal:
  - **🎯 Target** in MW: the fuel chain upstream sizes itself to make that
    much power. Limits upstream can scale it down, as with goals.
  - **Max**: burn all the fuel the limits upstream allow.
  - **On demand** (no anchor): sized like any machine group, by demand for
    its waste. "How many uranium plants feed 2 plutonium plants?" works this
    way.
  - ⛔ limiting the machine count caps it, as with any machine group.
- Generators scale **linearly** with clock: N machines' worth at 100% make
  N × their MW and burn N × the fuel, whatever the clock.
- Added from "+ Goal" or the palette, a generator starts with a target of one
  machine's power; added from a fuel output, it starts on Max.
- The summary shows **power used**, **power made** and the **net** (spare or
  short).

| Generator | MW | Fuel per machine | Water | Waste |
|---|---|---|---|---|
| Nuclear, uranium rods | 2500 | 0.2 rods/min | 240 m³/min | 10 Uranium Waste/min |
| Nuclear, plutonium rods | 2500 | 0.1 rods/min | 240 m³/min | 1 Plutonium Waste/min |
| Nuclear, Ficsonium rods | 2500 | 1 rod/min | 240 m³/min | none |
| Coal-Powered, coal | 75 | 15/min | 45 m³/min | — |
| Fuel-Powered, fuel | 250 | 20 m³/min | — | — |

Waste that is left over and can't be sunk (radioactive items without sink
points) is reported as a warning: in the game the plants stop when it backs
up. A fully closed nuclear chain runs **4 uranium : 2 plutonium : 1
Ficsonium** plants with no waste left.

## Byproducts

A node is sized by the output it is run for; its other outputs are
byproducts (a recipe's second output, or all of a generator's outputs).

- **Spare byproducts flow on.** When a byproduct's maker has an anchor to
  run for (a goal or a powered generator down its main products, or the
  maker itself), the belts carrying that byproduct get **what is spare** and
  no more:
  - A chain fed only by the byproduct fills from it by itself, through the
    open-end rule: Plastic 🎯20 → Heavy Oil Residue → Residual Fuel makes
    6.7 fuel/min with no fuel goal.
  - A Max goal or Max generator downstream gets the spare, even when the
    sources upstream are fully used.
  - A numeric goal that needs more than the spare **falls short**, and the
    maker is marked as the bottleneck. The maker doesn't grow (which would
    over-make its main product); add another producer of the byproduct.
  - Where an input is fed by a spare byproduct and by other producers, the
    byproduct is used first and the others make up the rest.
  - Several consumers of one spare byproduct share it like Max goals share
    a limit, whether or not they are connected to each other: uranium waste
    belted to both a Blender and a Particle Accelerator splits between them.
  - The byproduct's chain may share nodes with its maker's chain: one Water
    Extractor group for the reactors and the waste chain, or an Iron Plate
    line feeding both. Shared flexible nodes grow to cover both. A shared
    ⛔ limited node serves the maker's chain first, and the byproduct's
    chain gets what is left (it is the bottleneck when nothing is).
- **Otherwise byproducts are pulled** like main products. A maker with
  nothing else to run for (its main output unconnected, or no goal around
  it) is sized by demand for its byproduct.
- **Byproducts piped back into their own chain are spare too.** Aluminum
  Scrap's water piped to the Alumina Solution that feeds it, Ficsonium Fuel
  Rod's Dark Matter Residue going back to the Ficsonium that makes it, and
  Fertile Uranium's water piped to its acids all work the same way:
  - The belt carries what the maker gives back, and the input uses it
    first. Other producers on that input make up the rest: Scrap 🎯360 takes
    120 water from the loop and 240 from a Water Extractor.
  - The maker doesn't grow to give back more, so the loop can't run away.
  - When nothing else feeds the input, the rest is **missing**, as if the
    input had no belt. The card shows the shortfall in red on the port, the
    summary lists it under *Missing inputs*, and a warning names it: one
    Ficsonium plant's loop is 20 m³/min of Dark Matter Residue short. ⚡ Build
    chain adds a producer next to the loop's belt.
  - Several inputs fed by one byproduct take it in plan order. Fertile
    Uranium's 40 m³/min of water covers its sulfuric (25) and nitric (15)
    acid exactly, with nothing else needed.
- **So are byproducts feeding their maker's own goal.** Alumina Solution's
  silica belted to the Aluminum Ingot foundry that the alumina is made for,
  or the polymer resin of the *Heavy Oil Residue* alternate going to
  Residual Rubber for the same goal, follow the same rules as a loop: used
  first, other producers make up the rest, and what nothing else covers is
  missing. 60 ingots take the alumina's 25 silica and make the other 50 from
  30 quartz. (These used to be cut into a later stage, which left the
  maker's stage with nothing to run for: the silica came out as 0, and a
  consumer fed by nothing else scaled the goal down to 0.)
- Technically the solver cuts the plan at those byproduct belts into
  *stages*, solves them makers first, and hands each stage the spare as a
  limited supply. A node's stage is the number of cut belts on its longest
  way in. Each stage also takes in the nodes upstream of it from earlier
  stages, adding its demand to theirs, with only the room their limits have
  left. A byproduct belt that loops back into its maker's own chain, or
  whose consumer leads on to an anchor the maker runs for, can't be cut, so
  it stays in its maker's stage as a *spare belt*: it doesn't pull on the
  maker, and carries what the maker makes at the rate it settles at.

## Presentation

- **Machine mode** (per plan): *fractional* (2.4 machines at your clock) or
  *whole* (3 machines underclocked to 80%). Power is always costed as built.
  Limited nodes keep your count and run at the clock they need.
- **Ports** show needed vs supplied. Unconnected inputs are listed as missing
  inputs: things to import, and so is what a byproduct loop can't give back
  (see Byproducts). Outputs show surplus.
  - A port with no belt yet shows its rate under the item: red for what an
    input needs, amber for what an output makes. Once a belt is connected,
    the rate moves to the belt label. An open end's output counts as having
    no belt, even though the solver treats its flow as used.
- **Edges** show rate and item. Both the belt and the pipe tier are set to
  **No limit** by default, in new plans and the sample. With a tier set, an
  edge says how many belts or pipes of it the flow needs: an edge joins two
  machine groups, so 240/min on Mk.2 is "2× Mk.2" under the rate, not an
  error. The belt inspector shows the count too.
  - When the edge needs more than one belt or pipe, the inspector says
    **how to build** it (`beltPlan` in `src/planner/belts.ts`): one row
    per belt with its rate, the producing machines on it and the consuming
    machines it feeds. Machines go onto belts whole and as evenly as they
    can, from whichever end needs fewer belts (producers on a tie), so 20
    Smelters at 30/min on Mk.4 are 2 belts of 10. A partly clocked machine
    rides on the lightest belt. The other end gets what each belt brings,
    which can be part of a machine; when that adds machines, a hint says
    so. An edge from a split or into a merge holds `perMin / each`
    machines' worth of its group. The counts on up to three other tiers
    follow ("Or 1× Mk.6 · 2× Mk.5").
  - The count assumes the flow can be shared out over the belts, which only
    works if **every machine fits on one belt**: a machine puts out (or
    takes in) an item through one port, so one belt. When one machine at
    either end makes or takes more than a belt of the tier carries, e.g. a
    Mk.2 miner (120/min) on Mk.1 belts, or a smelter at 250% eating 75
    ore/min, no number of belts helps. The edge then turns **red** with no
    count, and says the slowest tier that would carry that machine ("needs
    Mk.2"), or that none does. For a limited extractor group the best site
    counts; a group's part machine counts at its part clock.
- **Splits and merges:** an output port feeding several edges gets a splitter
  badge (⑂). Inputs fed by several edges get a merger badge. The splitter
  badge opens the **split dialog** (`SplitPopup`, advice from `adviseSplit`
  in `src/planner/splits.ts`), with three ways to build the split, the way
  players do. It opens on the recommended one:
  - **Manifold**, recommended when it works: a splitter in front of each
    machine along the belt. Machines take what they need and back up when
    full, so the splitters pass the rest on. It works when every branch
    feeds machines, or when exactly one branch feeds a goal (storage, a
    sink, a train), which then goes last and takes the overflow. Two or more
    goals take everything they get, so a manifold can't share between them,
    and the load balancer is recommended instead. The tab lists the line in
    order, with each consumer's machines.
  - **Load balancer:** read-only, as in the balancer tool. The producing
    group is many machines, so it has **one input per machine** (7.5 machines
    are 7 inputs plus one at half rate). Whole machines go straight to an
    output, so this needs the fewest splitters. A toggle groups the machines
    onto the fewest belts of the plan's tier instead. With a tier set, it is
    the balancer's belt cap: an output above it leaves on several belts.
    **Precision** starts at ±2% (see the README's balancer section). "Open in
    Load Balancer" carries the inputs (`in=30x30`), the cap and the precision.
  - **Dedicated machines**, for producer machine groups: one sub-group per
    consumer, so the item never splits. Exact, and no splitters, for at most
    one extra machine per sub-group. Each sub-group is shown as whole
    machines sharing one clock ("14 at 95.2%"), as the underclock machine
    mode counts them, whatever the plan's mode. **Split into N groups**
    does it in the plan (`splitByConsumer` in `edit.ts`): the first belt
    stays on the node, every other belt moves to a copy below it, and every
    copy gets the node's input belts. It is offered only for plain recipe
    nodes (not limited, no power target) whose other outputs have no belts.
- **Summary:** total MW (power used; with generators, also power made and
  the net), buildings by type, shards and Somersloops, raw resources, net
  outputs, surplus, missing inputs, bottlenecks, then the build checklist's
  progress and the build cost (see Interaction).
- **Cards** are compact, in the style of Satisfactory Modeler: machine and
  count in the middle, input items on the left edge, outputs on the right.
  Details are in the hover tooltip; editing happens in the inspector.

## Interaction

- **Plans are tabs.** One saved plan per tab, autosaved to localStorage.
  **+** opens a blank plan and asks for its name; × deletes, with an Undo
  notice. Export/Import move plans as JSON.
- **Quick start:** "⛏ + Resource" (what you have) or "🎯 + Goal" (what you
  want: power plants first, biggest first, then items); an empty plan offers
  both.
- **Connections:** the whole item icon is the handle.
  - Drag onto a card to connect the matching port.
  - Drag onto empty canvas to pick a producer or consumer.
  - Drag a connected input away to move its belt, or drop it on empty canvas
    to delete it.
  - Click an item to open its picker; the new node is placed beside the card.
- **Editing:** select a node to edit it in the inspector. The recipe picker
  shows ingredient and product icons. A toggle (a preference, on by
  default) switches between rates **per machine** at 100% and **at this
  node's rate**: every option sized to make what the node makes now (its
  main product, or a generator group's MW), with its machine count and
  power. The numbers are what the node shows after picking that option
  (`recipeAtRate` in `src/planner/compare.ts`); a ⛔ limited node keeps its
  machine count instead. A node that makes nothing has no toggle.
- **Inspector:** it docks on the right and narrows the canvas. When it opens
  (or the canvas narrows for any reason), the canvas pans just enough to
  keep the selected nodes in view. Somersloops are a
  single "Amplify ×2" toggle, with partly filled slots behind "Partial…".
- **Tidy layout** (canvas toolbar) arranges the plan left to right, from
  resources to goals, as one undo step, then fits the view. With two or more
  nodes selected it becomes **Tidy selection** and moves only those. The
  rules (`layoutPlan` in `src/planner/layout.ts`, built on dagre):
  - Columns follow the belts. Each node sits as far left as its inputs
    allow, and moves right only if that shortens its belts, so a resource
    node sits just before its first consumer. Goals and other ends of the
    line share the last column, so no goal sits in the way of a belt.
  - Separate chains are stacked top to bottom in their current order.
  - In a loop (packaging, recycling) only the belt that closes it runs
    backwards. A backwards belt between cards on the same row is drawn
    underneath them.
  - A tidied selection is anchored to the outside node it has the most belts
    with (a consumer, on a tie). With no such node it keeps its top-left
    corner. Either way it moves down past any card it would cover.
  - Angled belts turn just before their consumer, so a belt that skips a
    column runs past it instead of under a card.
- **Zoom:** fitting the view (on load, after Tidy, the fit button) never goes
  below 55%, so cards stay readable; a plan too big for that stays centered
  and scrolls. Zooming out by hand stops at 30%. **F**, or the target button
  under the zoom controls, zooms to the selected nodes, or to the whole plan
  if nothing is selected.
- **Shortcuts:** ⌘/Ctrl + C, V, D (with the belts between copied nodes),
  ⌘/Ctrl + Z / Shift+Z, Delete, F (zoom to selection).
- **⚡ Build chain** fills unconnected inputs with producers, all the way back
  to raw resources, as one undo step. It is offered in three places: the
  inspector of a node with missing inputs (a goal, or any machine group),
  first in the picker that opens from an input with no belt, and next to
  each row of the summary's *Missing inputs* (plus **Build all**). The rules
  (`buildUpstream` in `src/planner/autobuild.ts`):
  - What makes an item (`chooseProducer`), in order: an extractor for raw
    resources (the fastest one with its own power, so a Miner Mk.3, a Water
    Extractor, an Oil Extractor; Nitrogen gets a Resource Well Extractor);
    the recipe the player last picked for that item; the simplest standard
    recipe whose **main** product is the item; the simplest unlocked
    alternate; otherwise a supply node (leaves, mycelia, alien remains, …).
    "Simplest" counts recipe steps down to raw resources, so Fuel comes from
    crude oil, not from unpackaging or residue. Recipes that aren't usable
    (see Recipes) are never used.
  - **Don't use** (below): an avoided resource is never mined anew; it ends
    at a supply node, so it shows as brought in. Recipes whose whole chain
    can do without the avoided resources go first, in the order above
    (Circuit Board without oil: Silicon Circuit Board); when none can, the
    usual order holds. The plan's own extractors and supplies of an avoided
    resource still count, and are reused as usual.
  - A recipe is remembered for its main product when the player switches to
    it in the inspector, or picks it from an input's picker.
  - It **reuses before adding** (a preference, on by default): an input
    connects to a node that already makes its item. Extractors and supplies
    are reused even when ⛔ limited, since they are what the player has;
    machine groups only when flexible. A reused node's own missing inputs
    are built too. Nothing downstream of the input is reused, so reuse
    never closes a loop.
  - Everything added is flexible, so the plan's targets and limits still
    drive the rates: machine groups size themselves, and extractors count
    the nodes (or Water Extractors) they need, on normal purity.
  - Byproducts are left unconnected and show up as spare output.
  - A recipe that eats an item already being built further down the line is
    skipped, and the walk stops after 25 steps with a supply node, so recipe
    loops can't run forever.
  - Inputs that already have a belt are left alone: building twice adds
    nothing. The exception is an input a byproduct loop feeds too little:
    building it adds a producer next to the loop's belt
    (`missingInputs` in `autobuild.ts` lists both kinds).
  - The new nodes are laid out with Tidy's rules, anchored to the node they
    were built for, and the view fits them.
- **Build checklist** keeps track of a plan while you build it in the game.
  It's a visual aid, one mark per node meaning "this node is built"; belts
  can't be marked and there is no partial progress. The solver ignores it.
  - A ✓ in a card's top-left corner (shown on hover until the node is
    marked) and a toggle at the top of the inspector mark a node done; with
    several nodes selected, the inspector marks or clears them all. Done
    cards turn their ✓ green and fade, so what's left stands out.
  - The mark remembers how many of the node's machines (or extractors) it
    had, counted whole (`done: { count }` on the plan node, set with
    `markDone` in `src/planner/edit.ts`). If the plan later needs more (done
    with 4, now needs 8), the node is **not done any more**: the card turns
    amber with `✓ 4/8`, the inspector says how many more to build, and only
    those extra machines count toward "still needed". Clicking the ✓ (or
    "All 8 built") marks it done again with the new count; "Clear the mark"
    removes it. If the plan goes back down to 4 or fewer, it is done again
    without a click.
  - A new recipe, machine, resource or item clears the mark, since that's a
    different thing to build. Copied, pasted and duplicated nodes start not
    done. Marks are saved with the plan, so they survive a reload and
    export/import.
  - The summary shows progress ("3 of 8 nodes done", with a bar) and how
    many marked nodes need more machines.
- **Build cost** (summary): the items needed to build every building the
  plan uses, from each machine's `buildCost` in the game data
  (`buildCost` in `src/planner/buildcost.ts`).
  - Buildings are counted whole per node: 2.4 Smelters cost 3, in either
    machine mode. A resource well counts its satellites plus one
    pressurizer.
  - Once any node is marked, each row shows **still needed / total**. Still
    needed leaves out done nodes, except the extra machines a node needs
    beyond its mark.
  - A machine with no known cost is listed as "cost unknown", never counted
    as free. Belts, pipes, splitters and mergers aren't counted.
- **✨ Optimize** (canvas toolbar) picks the recipes for the plan's goals
  and rebuilds the plan around them, after showing what would change:
  goals, power used, buildings and raw resources (now → optimized), the
  machine groups it would use (alternates and new recipes marked), and any
  warnings. **Apply** is one undo step and lays the whole plan out with
  Tidy's rules; **Cancel** changes nothing. The rules (`optimize` in
  `src/planner/optimize.ts`, on the simplex in `src/planner/lp.ts`):
  - One objective, a preference: **fewest raw resources** (the default),
    **least power** or **fewest buildings**. Raw resources are weighed by
    how scarce the map makes them: the most common one (iron, 92100/min)
    weighs 1, uranium (2100/min) 44. Water is free: Water Extractors go on
    any water, so they only cost power and buildings, which the other two
    objectives count (and the tie-breaker below counts their buildings).
    Power and buildings are counted at 100% clock. A second, tiny term breaks
    ties (buildings, or resources), so no pointless loops make it in.
  - It uses only usable recipes (see Recipes). An item no usable recipe
    makes comes from a supply node, and the dialog says so ("No recipe you
    can use makes Plastic, so it comes from a supply node"). Raw resources are mined, never made: the Converter's ore recipes
    and unpackaging water or oil are left out, so a ⛔ limit on iron ore
    holds. Items nothing makes and nothing mines (leaves, mycelia, …) come
    from new supply nodes, only when there's no other way.
  - **Kept:** goals, extractors, supplies, generators and ⛔ limited
    machine groups. **Replaced:** flexible machine groups. All belts are
    drawn anew, except those touching a node whose content isn't loaded.
  - A raw resource the plan already has an extractor or supply for comes
    only from those (⛔ ones up to their limit), as ⚡ Build chain reuses
    them. Otherwise new extractors are added, on normal purity, up to what
    the map's sites give (see World nodes). An intermediate supply ("90
    plates/min from the other factory") is used before making more.
  - 🎯 targets (goals, and generators' MW) are met together. If the limits
    can't take them all, every target is scaled by the same factor, and
    the dialog says so: "The limits allow 50% of the 🎯 targets; the plan
    is built for that."
  - **Max** goals and Max generators get as much as the limits allow, after
    the targets. Several Max goals each get the same share of what they
    could reach alone. Max generators count as one goal, of MW, so plants
    that burn each other's waste make the most power together. A Max goal
    with no ⛔ limit upstream is reported, and nothing is proposed.
  - New extractors are flexible, so a Max goal takes in whatever other
    resources stretch the limited one the furthest. That answers "how much
    can I get from this node?": one normal uranium node (Mk.3, 240/min) with
    a Max Nuclear Power Plant makes 30 GW on standard recipes (12 plants);
    add a Max plutonium plant and its waste makes 15 GW more (6 plants),
    without any uranium waste left. With every alternate, 136 GW, and 168 GW
    with a Ficsonium plant too. Likewise 120 iron ore makes 153 Reinforced
    Iron Plates/min with oil-based alternates.
  - Byproduct water isn't piped back: it's free from any Water Extractor,
    and piping it back closes loops that keep a waste chain from getting its
    waste. It shows as spare output (pipe it back by hand if you like).
  - Each recipe the program picks becomes one flexible group. When it runs
    a recipe further than its main product's users take, for the byproduct
    (2 Rubber refineries for 10 rubber and 40 heavy oil residue), the extra
    is a second group whose main product stays unconnected, so the solver
    pulls its byproduct. An input fed by several pulled producers gets
    shares equal to the planned flows.
  - The plan is then checked with the solver. An input a spare byproduct
    doesn't fully reach gets a belt from a maker of the item with some left
    over. Whatever is still short gets another group of the recipe whose
    byproduct feeds it, run for that byproduct (Quartz Purification for its
    dissolved silica), or else what ⚡ Build chain would add. That can cost
    a little more than the program planned (see Follow-ups).
  - Fractional machines are fine; the plan's machine mode shows them as
    usual.
  - **Don't use** (a row of resource chips in the dialog, under the
    objective; picking one re-solves at once): avoided resources get no new
    extractor and no supply, so they come only from the plan's own
    extractors and supplies. A goal that can't be made without one is
    reported and nothing is proposed: "Plastic needs Crude Oil. Take it off
    "Don't use", or give the plan its own extractor or supply of it." With
    every alternate, 5 Modular Frames/min normally take a plastic and rubber
    chain; without oil, Steel Cast Plate and Stitched Iron Plate.
- **World nodes:** the summary lists the resource nodes and well
  satellites the plan's extractors use against what the map has (hover for
  each purity), in red with a note when there are more than exist. A
  ⛔ limited group counts the sites it lists; a flexible one the extractors
  it needs, whole, on its purity. Water Extractors aren't counted. The
  counts are the default map's (from the wiki), or the plan's own, edited
  under Settings → World nodes (1.2's World Randomization moves nodes);
  *Reset* goes back to the map's. ✨ Optimize never plans past them.
- **Don't use** (Settings, and the ✨ Optimize dialog): raw resources this
  plan shouldn't mine anew ("build this without oil"), saved with the plan
  (`PlanSettings.avoid`). ✨ Optimize and ⚡ Build chain both follow it (see
  above); the solver doesn't, so a plan built by hand can still use them.
  It's per plan, not a preference, since it's about this factory.
- **Recipes** (Settings → Recipes, a preference): which recipes the planner
  may use. Pickers, the recipe dropdown, ⚡ Build chain and ✨ Optimize only
  offer usable ones; a plan keeps the recipes it already has. The rules
  (`recipeAccess` in `src/planner/progress.ts`):
  - **Game progress** (optional; "Everything unlocked" by default): the HUB
    tier reached and the MAM research done. A recipe is unlocked when any
    schematic that unlocks it is: a milestone of that tier or lower
    ("Up to Tier 4" is Tiers 0–4), ticked research, or an alternate whose
    required milestones and research are all done (its hard drive can be
    found). Plastic needs Tier 5 (Oil Processing); Pure Iron Ingot too;
    Nitro Rocket Fuel needs the Rocket Fuel research.
  - **Locks by hand**, on top, for any recipe, standard or alternate (an
    alternate you haven't found, a recipe you don't want). A recipe progress
    hasn't unlocked yet shows what it needs instead ("Tier 5 (Oil
    Processing)", "Research: Quartz").
  - The dialog lists every recipe with a Standard / Alternate filter and a
    search; *All on* / *All off* apply to what's shown.
- **Preferences** apply to every plan: usable recipes and game progress,
  belt line style (angled, straight or curved), whether ⚡ Build chain
  reuses nodes, the recipe last picked per item, whether the recipe picker
  compares at the node's rate, and what ✨ Optimize minimizes.

## Build steps

All eight steps are done for v1; see the polish backlog for what's next.

1. Planner page: hash routes (`#/planner`, `#/balancer`), base-pack loading,
   icon component.
2. Flow calculation (`src/planner/solve.ts`), pure and tested.
3. Canvas: node cards, item ports, typed connections, edge labels, split/merge
   badges with the balancer popup.
4. Adding nodes: drag from a port into empty space to pick a producer or
   consumer; search palette.
5. Inspector: recipe and alternate switching, machine, count and clock,
   Somersloops, purity sites, ⛔ / 🎯 anchors, machine-mode toggle.
6. Plan summary panel.
7. Saving: autosave to localStorage, multiple plans, JSON export/import,
   undo/redo.
8. Plan settings: usable recipes and game progress, belt/pipe tier, default machine mode.

## Follow-ups

Everything deferred from v1 is prioritized in [roadmap.md](roadmap.md): the
"Build faster" automation milestone first, then the optimizer and power
planning, then nice-to-haves. Mod tooling is deferred. When an item ships,
document its behaviour here and mark it done in the roadmap.

Known v1 limits that the roadmap addresses:

- Several Max goals behind one limit split it evenly; there is no per-branch
  share yet (roadmap #7).
- A byproduct maker shared by two stages (one Heavy Oil Residue refinery
  serving a uranium and a plutonium chain) grows for the later stage, but
  only the earlier stage's spare reaches the byproduct's consumer there.
  ✨ Optimize works around it by adding a producer for the rest.
- Loops of main products (Recycled Plastic ⇄ Recycled Rubber) are still
  pulled; they settle as long as each round of the loop needs less than it
  makes. A loop that needs more than it makes reports that it never
  settles.
