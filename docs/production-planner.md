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
- **Shortcuts:** ⌘/Ctrl + C, V, D (with the belts between copied nodes),
  ⌘/Ctrl + Z / Shift+Z, Delete.
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

Deferred on purpose. Grouped roughly by size; nothing here blocks using v1.

### Planning engine

- **Mode 2: auto-build.** From a goal (or a goal plus inputs), fill in the
  chain with default or preferred recipes, as flexible nodes the user can
  then edit.
- **Mode 3: optimize.** Pick recipes and share scarce resources with an LP
  solver (e.g. `javascript-lp-solver`). Same targets and limits as v1, so the
  UI stays the same. This lifts the v1 simplifications listed above.
- **Split shares on outputs.** Let the user set "2 : 1" between consumers from
  the ⑂ badge or the belt inspector, instead of the even fair share between
  Max goals. Shares already exist for several producers feeding one input.
- **Byproduct-driven chains.** A chain fed only by a byproduct (Heavy Oil
  Residue → fuel) gets no flow unless it has a goal; forward flow from surplus
  would fix it.
- **1.2 game options:** the power consumption multiplier and the recipe cost
  multiplier. The user will provide the exact rules; the power one is a single
  plan setting.
- **Generators as nodes:** fuel in, MW out, nuclear waste as a byproduct, and
  the plan's net power.
- **World limits:** node counts per resource and purity for the default map,
  with custom counts for World Randomization saves (counts per resource are
  on the [wiki](https://satisfactory.wiki.gg/wiki/Resource_node)).

### Game data and mods

- **Mod packs in the UI:** upload a pack JSON, validate it (zod), store it in
  IndexedDB, and enable or disable packs per plan. The catalog merge already
  supports this (`buildCatalog`).
- **Importers:** one from the game's own `en-US.json` (Docs), so new patches
  don't wait on upstream data, and one from ContentLib JSON for mods.
- **Verify in game:** Somersloop slots on the Smelter. The game data says 0;
  the wiki and other tools say 1, which is what we use.

### Planner UX

- **Belt counts:** an edge is a logical flow between two groups, not one
  physical belt. Instead of turning red over the tier limit, say "needs 3×
  Mk.2 belts".
- **Compare recipes at this node's rate:** an option in the recipe picker to
  scale every recipe to the node's current output ("for your 90 screws/min:
  22.5 rods vs 1.7 steel beams").
- **Inspector width:** the docked inspector narrows the canvas, and cards on
  the right can slide under it. Consider auto-pan or a slimmer panel.
- **Default zoom** makes cards small on wide plans.
- **Auto-layout** button (dagre or elk) for messy plans.
- **Share a plan as a link** (plan compressed into the URL).

### Load balancer

- Offer the same belt line style preference (angled, straight, curved) in the
  balancer.
