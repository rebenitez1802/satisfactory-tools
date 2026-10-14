# AGENTS.md

Guide for AI coding agents (and humans) starting a fresh session in this repo.
Read this first; `README.md` has the user-facing write-up of the load-balancer
algorithm. The production planner is specified in `docs/production-planner.md`
(behaviour plus deferred follow-ups), and its game data in `docs/data-model.md`.

## What this is

**Satisfactory Tools** — a static, client-only website with planning helpers
for the factory game [Satisfactory](https://www.satisfactorygame.com/).
There is no backend, no database, and no API calls; everything runs in the
browser.

- **Live site:** https://rebenitez1802.github.io/satisfactory-tools/
- **Repo:** `rebenitez1802/satisfactory-tools` (GitHub)

### Tools

| Tool | Status | Entry point |
| --- | --- | --- |
| Load Balancer | Shipped (PR #1, polished in PR #2) | `src/components/LoadBalancerTool.tsx` |
| Production Chains | v1 shipped (PR #3); follow-ups in `docs/production-planner.md` | `src/components/planner/PlannerTool.tsx` |

**Load Balancer:** given an input belt rate and a list of desired output rates,
build a graph of splitters (1 → 2 or 3, even split) and mergers (≤3 → 1) that
divides the input exactly. Ratios that aren't made of halves and thirds use
feedback loops, as real in-game "odd" balancers do. If the outputs add up to
less than the input, the remainder goes to an auto-added red **Leftover**
output. Every generated graph is checked by a flow simulator before it is shown.

**Production Chains:** a production planner edited **right in the graph**
(React Flow). Nodes are machine groups: recipes, extractors on resource nodes,
supplies and goals. Goals carry a 🎯 target or Max, any node can be ⛔
limited, and the solver sizes the rest (forward, backward or both). Splits
open a read-only load balancer. Plans live in tabs and autosave to
localStorage. Game data comes from **mod-ready data packs** (see "Production
chains" below).

Tools are hash-routed (`#/planner`, `#/balancer`, see `src/useHashRoute.ts`).
The balancer can be opened with rates prefilled:
`#/balancer?in=120&out=90|Iron Plate&out=30|Iron Rod`.

## Tech stack

- **Vite 5 + React 18 + TypeScript 5** (strict mode, `noUnusedLocals`,
  `noUnusedParameters`). No router, no state library, no CSS framework.
- **`@xyflow/react` (React Flow v12)** draws the graphs. We picked it on purpose:
  the production-chain tool needs interactive node editing (drag, connect),
  not just static diagrams. Build new graph-based tools on React Flow too.
- **Vitest 2** for tests, in the `node` environment (no DOM/component tests yet).
- Plain CSS in `src/styles.css`: dark theme with CSS variables on `:root`
  (`--accent` amber, `--green`, `--blue`, `--red`, …).
- Node 20 (matches CI). Dependencies are managed with npm (`package-lock.json`).

## Commands

```bash
npm install
npm run dev        # Vite dev server at http://localhost:5173/ (base "/")
npm test           # vitest run: balancer, catalog and planner suites
npm run test:watch
npm run typecheck  # tsc -b --noEmit
npm run build      # tsc -b && vite build → dist/ (base "/satisfactory-tools/")
npm run preview    # serve the built dist/ locally (under /satisfactory-tools/)
npm run data:base  # regenerate public/packs/base (game data + icons); needs Node ≥ 22.6
```

`data:base` runs `scripts/*.ts` directly with Node's TypeScript type stripping,
which is why it needs a newer Node than CI. CI never runs the scripts; the
generated pack is committed.

Before you call a change done, run `npm test` and `npm run build`. The build
also type-checks, and CI runs the same two steps.

## Deployment

- A push to `main` runs `.github/workflows/deploy.yml`: `npm ci` →
  `npm test` → `npm run build` → upload `dist/` → `actions/deploy-pages`.
  It can also be started by hand (`workflow_dispatch`).
- A failing test **blocks the deploy**.
- GitHub Pages serves the site from a sub-path, so `vite.config.ts` sets
  `base: '/satisfactory-tools/'` for builds and `vite preview`. Dev and test
  use `/`.
  **Don't hard-code absolute asset paths** like `/foo.png`. Import assets
  through Vite, or prefix them with `import.meta.env.BASE_URL`.
- One-time manual setting (already done): repo Settings → Pages → Source:
  **GitHub Actions**.
- There are no preview deploys for PRs. Check changes locally with
  `npm run dev`, or with `npm run build && npm run preview` to test the
  sub-path build.

## Workflow conventions

- Branches: `rebenitez1802/<topic>`. Open PRs against `main`. They are merged
  with merge commits, and merging deploys the site.
- Don't push to `main` directly. Every merge goes live.
- The user works visually: **UI changes should be checked with screenshots**,
  not just reasoning. The habit so far: install Playwright in a scratch folder
  `.context/pw/` (its own `package.json`, so it never touches the app's
  dependencies), run the dev server, and save screenshots under `.context/`.
  `.context/` is gitignored and belongs to one workspace, so a fresh workspace
  has to set it up again:
  ```bash
  mkdir -p .context/pw && cd .context/pw && npm init -y >/dev/null \
    && npm i -D playwright && npx playwright install chromium
  ```

## Code map

```
docs/                       data-model.md, production-planner.md (spec + follow-ups)
scripts/                    Build-time importers (Node, not shipped): greeny data → base pack, wiki icons
public/packs/base/          The base data pack: pack.json + icons/ (fetched at runtime)
src/
  main.tsx                  React root
  App.tsx                   Header + tool tabs + footer; mounts the active tool
  useHashRoute.ts           #/planner, #/balancer routing
  styles.css                Global styling (dark theme, CSS variables)
  catalog/                  Game data, framework-free: types, pack format, buildCatalog merge, icon helpers
  planner/                  Planner logic, framework-free: plan types, rates/power, solve.ts
                            (targets & limits), create/edit/place helpers
  components/planner/       Planner UI: PlannerTool (state, tabs, history), PlanCanvas (React Flow),
                            nodes.tsx (cards), Inspector, Picker, RecipeSelect, BalancerPopup, planner.css
  components/
    LoadBalancerTool.tsx    Left panel UI (input, outputs, belt tier, toggles) → calls solve()
    GraphView.tsx           React Flow canvas: custom node/edge types, handle
                            placement, rate badges, hover/click-to-pin highlighting
    beltRouting.ts          Lane router: predicts each orthogonal belt path and nudges
                            it so parallel belts don't overlap each other or nodes
  solver/                   Framework-agnostic logic. NO React imports here.
    index.ts                Public barrel — import from '../solver'
    types.ts                Graph model: GNode (source|sink|splitter|merger), GEdge, SolveInput/Result
    ratios.ts               rates → coprime integer ratios (handles decimals like 12.5)
    builder.ts              Recursive divide-and-partition balancer construction (3-smooth B, loopbacks)
    simulate.ts             Fixed-point steady-state flow simulator (the correctness check)
    solve.ts                Entry point: validate → leftover → reduce → build → simulate → warnings
    layout.ts               Longest-path layering; 'LR' or 'BT' (BT is the UI default)
    __tests__/solver.test.ts
```

### How the load-balancer pipeline works

`LoadBalancerTool` → `solve(input)` → `buildBalancer(ratios)` → `simulate(graph)`
checks that every sink gets its target rate, or `solve` returns `ok: false` →
`GraphView` runs `layoutGraph`, assigns handles, computes lanes, and renders.

- `GEdge.feedback` only affects layout and drawing: layering skips it, and it
  is drawn as a loop. The simulator treats it like any other belt.
- `simulate()` **mutates** `graph.edges[*].flow` in place. The UI reads those
  flows.
- `SolveResult.warnings` covers: leftover, loopbacks used (info), and belts over
  the chosen belt tier's limit (`beltMax`; internal belts can carry more than
  the input when there are loops).

## Conventions and style

- Match the existing style: no semicolons, single quotes, 2-space indent,
  trailing commas, named exports (`export function Foo`). No ESLint or Prettier
  is set up, so copy what's around you.
- Each module starts with a short comment explaining *why* it works the way it
  does (see `builder.ts`, `simulate.ts`, `layout.ts`). Keep that up for new
  modules.
- Keep algorithms pure and testable under `src/solver/` (or a similar
  framework-free folder for new tools). React components only handle UI and
  state.
- Solver changes need tests. Correctness tests should **simulate** the built
  graph and compare actual flows with the targets, not snapshot the graph's
  shape.
- Rates are parts/min, stored as JS numbers. Compare floats with a tolerance;
  see `REL_TOL` and the checks in `solve.ts`.
- Game rules this code relies on: a splitter divides evenly over its
  **connected** outputs (2 or 3); a merger takes up to 3 inputs. Belt tiers
  (parts/min): Mk.1 60, Mk.2 120, Mk.3 270, Mk.4 480, Mk.5 780, Mk.6 1200.

## Production chains: how it's built

Requirements agreed with the user (2026-10-13), now implemented:

- **Mod-extensible game data is a hard requirement.** Content comes from data
  packs (`src/catalog/pack.ts`): a base pack plus optional mod packs that add,
  patch or remove entities. Ids are namespaced: `base:Desc_IronIngot_C`.
  - **Don't** hard-code TypeScript unions of item or machine names, and don't
    put game data in `switch` statements. Machine abilities (overclock,
    Somersloop slots, extraction, ports, the items that go in upgrade slots)
    are data on the machine.
  - Icons come with each pack; `Icon` falls back to an initials placeholder.
  - The base pack is generated by `npm run data:base` from greeny's
    `data1.0.json` (MIT, pinned commit) plus `scripts/base-overlay.ts`. Icons
    are from satisfactory.wiki.gg (© Coffee Stain), credited in the footer.
- **Editing happens in the graph**, with an inspector for details.
- **The solver** (`src/planner/solve.ts`) is the source of truth for rates.
  Its rules, including targets, limits, open ends and fair shares between Max
  goals, are in `docs/production-planner.md`. Change the doc and the tests
  with the code.
- Vanilla math lives in `src/planner/rates.ts`. Power scales with
  clock^1.321929, and Somersloops multiply power by (1 + filled/slots)². Slots
  can be partly filled.

## Gotchas

- Opening `dist/index.html` straight from disk won't work, because asset
  paths assume `/satisfactory-tools/`. Use `npm run preview`.
- `GraphView` estimates node and badge sizes (`NODE_SIZE`, `BADGE_H`,
  `badgeWidth`) so it can route belts before React Flow has measured anything.
  If you change node CSS sizes in `styles.css`, update those constants too, or
  belts will attach and route in the wrong places.
- Layout pins the source alone in rank 0 and puts all sinks in one final rank.
  This is on purpose, so input and outputs read clearly.
- The `.context/` folder is gitignored. Don't keep anything there that other
  sessions need. Durable notes belong in this file or in the repo.
- `planner.css` loads **before** `styles.css`, because `main.tsx` imports
  `App` first. Planner rules that override global ones need a second class,
  e.g. `.tool.pn-tool`.
- React Flow stops pointer events on the canvas and on nodes from bubbling.
  "Click outside to close" listeners must use the **capture** phase
  (`addEventListener('pointerdown', fn, true)`).
- Don't read refs that are updated during render from inside a state
  updater. StrictMode re-runs updaters after the next render, and they see
  the new ref value. Compute the next state in the event handler instead (see
  tab Undo in `PlannerTool.tsx`).
- Planner handles are ids `in:<itemId>` / `out:<itemId>`, and each one covers
  its whole item icon. Connection gestures are handled in `PlanCanvas.tsx`
  (`onConnectStart`/`onConnectEnd`, `nodeAt`).
