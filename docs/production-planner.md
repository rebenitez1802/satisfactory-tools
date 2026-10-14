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
2. **Auto-build.** Given a goal, the app fills in the chain using default
   recipes (later).
3. **Optimize.** Given inputs and goals, the app picks recipes and shares
   scarce resources with an LP solver (later). It uses the same targets and
   limits as v1, so the UI doesn't change.

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

Edges are belts or pipes you draw, carrying one item from an output port to
an input port of the same item. Connections are explicit; nothing is wired up
implicitly by item.

## Targets and limits

Every number you type is either a **target** (on goals) or a **limit** (on a
⛔ node). Every other node is **flexible**: it is sized from those numbers and
never overwrites them.

- A flexible recipe node keeps your clock and Somersloops as preferences, and
  its machine count is derived.
- A flexible extractor or supply shows what it needs to provide.

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
  (default: equal).
- Several numeric goals behind one bottleneck are scaled together; several
  Max goals share the limits evenly (each uses the same fraction of them).
- A chain driven only by a byproduct with no goal downstream gets no flow.

## Presentation

- **Machine mode** (per plan): *fractional* (2.4 machines at your clock) or
  *whole* (3 machines underclocked to 80%). Power is always costed as built.
  Limited nodes keep your count and run at the clock they need.
- **Ports** show needed vs supplied. Unconnected inputs are listed as missing
  inputs: things to import. Outputs show surplus.
- **Edges** show rate and item. They warn when over the selected belt or pipe
  tier.
- **Splits and merges:** an output port feeding several edges gets a splitter
  badge. Clicking it opens a read-only load-balancer popup for those rates, with
  surplus as the leftover output, plus "Open in Load Balancer". Inputs fed by
  several edges get a merger badge.
- **Summary:** total MW, buildings by type, shards and Somersloops, raw
  resources, net outputs, surplus, missing inputs, bottlenecks.
- **Cards** are compact, in the style of Satisfactory Modeler: machine and
  count in the middle, input items on the left edge, outputs on the right.
  Details are in the hover tooltip; editing happens in the inspector.

## Interaction

- **Plans are tabs.** One saved plan per tab, autosaved to localStorage.
  **+** opens a blank plan and asks for its name; × deletes, with an Undo
  notice. Export/Import move plans as JSON.
- **Quick start:** "⛏ + Resource" (what you have) or "🎯 + Goal" (what you
  want); an empty plan offers both.
- **Connections:** the whole item icon is the handle.
  - Drag onto a card to connect the matching port.
  - Drag onto empty canvas to pick a producer or consumer.
  - Drag a connected input away to move its belt, or drop it on empty canvas
    to delete it.
  - Click an item to open its picker; the new node is placed beside the card.
- **Editing:** select a node to edit it in the inspector. The recipe picker
  shows ingredient and product icons with per-machine rates. Somersloops are a
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
- **Preferences** apply to every plan: unlocked alternates, and belt line
  style (angled, straight or curved).

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
8. Plan settings: allowed alternates, belt/pipe tier, default machine mode.

## Follow-ups

Everything deferred from v1 is prioritized in [roadmap.md](roadmap.md): the
"Build faster" automation milestone first, then the optimizer and power
planning, then nice-to-haves. Mod tooling is deferred. When an item ships,
document its behaviour here and mark it done in the roadmap.

Known v1 limits that the roadmap addresses:

- Several Max goals behind one limit split it evenly; there is no per-branch
  share yet (roadmap #7).
- An edge over its belt tier turns red instead of saying how many belts it
  needs (#4).
- A chain fed only by a byproduct gets no flow unless it has a goal (#12).
