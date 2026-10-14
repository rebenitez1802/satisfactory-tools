# Satisfactory Tools

A small collection of browser tools for planning factories in the game
[Satisfactory](https://www.satisfactorygame.com/). Built with React + Vite and
deployed to GitHub Pages. The first tool is a **load-balancer graph builder**.

## Tools

### Load Balancer

Given an input belt rate (parts/min) and a set of output rates that add up to
the input, it produces a graph of **splitters** and **mergers** that splits the
input into exactly those outputs.

In Satisfactory:

- a **splitter** has 1 input and divides it **evenly** across its 2 or 3 outputs;
- a **merger** sums its (up to 3) inputs into 1 output.

#### How the solver works

1. The output rates are reduced to coprime integer ratios `r₁ : r₂ : … : rₖ`,
   with `N = Σ rᵢ`. We work in **units** where 1 unit = `input / N`.
2. We pick `B`, the smallest **3-smooth** number (a number whose only prime
   factors are 2 and 3: 1, 2, 3, 4, 6, 8, 9, 12, 16, 18, 24, …) with `B ≥ N`.
   The belt is grown to `B` units and the extra `B − N` units are looped back.
3. The `B`-unit trunk is divided **recursively**: at each belt carrying `V`
   units, split evenly by 2 or 3, then partition the amounts that belt must still
   deliver across the sub-belts — cutting an amount **only** where it crosses a
   sub-belt boundary. Recurse until a sub-belt carries exactly one output's
   amount.
4. Each output collects its (few) delivered pieces through a small merger tree.
   The looped-back units rejoin the input before the trunk.
5. At steady state the loop forces every unit belt to carry `input / N`, so each
   output hits its target rate. The trunk carries `input · B / N` (always
   `< 2 × input`).

Keeping belts **aggregated** — rather than fanning the whole belt out to `N`
unit streams and merging them back — is what keeps the graph small. For example
`136 → 60 / 40 / 36` (ratio 15:10:9) builds **5 splitters + 4 mergers**, and a
coprime split like `100 → 37 / 63` stays at ~5 splitters instead of ~100.

When `N` is itself 3-smooth (e.g. splitting into 2, 3, 4, 6, 8, 9 … equal parts),
`B = N`, there is no leftover, and the graph is a **pure tree with no loops**.
Otherwise (fifths, sevenths, elevenths, thirteenths, …) a **feedback loop** is
introduced — the same trick real Satisfactory "odd belt balancers" use.

> The construction is compact and provably correct, though not guaranteed
> minimal; the per-level split choice is a greedy (fewest cuts) heuristic.

Every generated graph is checked by a **flow simulator** that iterates the
network to steady state and confirms each output matches its target before the
graph is displayed, so loop designs are proven correct, not guessed.

### Production Chains

Plan a factory from resource nodes to products. Add a miner on the nodes you
have, or a goal for what you want, and build the chain on a canvas. The planner
works out rates, machine counts (fractional, or whole and underclocked),
overclocking, Somersloops and power. Set 🎯 targets on goals and ⛔ limits on
sources or machine groups, and everything else sizes itself. It works forward
("what can I make from this?"), backward ("what do I need?"), or both.

Power plants are part of the plan: coal, fuel, biomass and nuclear generators
take a 🎯 MW target or burn all the fuel they can get, and the summary shows
power used, made and the net. Spare byproducts flow on into the chains they
feed, so a nuclear plant's waste can be planned all the way to plutonium and
Ficsonium fuel rods, with a warning for any waste left over.

When one output feeds several belts, the ⑂ badge opens a load balancer for
those exact rates. Plans live in tabs, autosave in the browser, and export as
JSON.

Game content comes from swappable **data packs**, so mods can add machines,
resources and recipes. See [docs/data-model.md](docs/data-model.md) and
[docs/production-planner.md](docs/production-planner.md). What's coming next is
in [docs/roadmap.md](docs/roadmap.md).

## Development

```bash
npm install
npm run dev        # local dev server
npm test           # run the test suite
npm run build      # production build into dist/
npm run typecheck  # type-check only
npm run data:base  # regenerate public/packs/base (game data + icons)
```

## Deployment

Pushing to `main` runs `.github/workflows/deploy.yml`, which tests, builds, and
publishes `dist/` to GitHub Pages. Enable it once under **Settings → Pages →
Build and deployment → Source: GitHub Actions**. The site is served at
`https://<user>.github.io/satisfactory-tools/` (the Vite `base` is set to match).

---

A free, non-commercial fan tool, not affiliated with Coffee Stain Studios. Game
content and icons © Coffee Stain Studios. Icons come from the
[Official Satisfactory Wiki](https://satisfactory.wiki.gg/), and recipe data from
[greeny/SatisfactoryTools](https://github.com/greeny/SatisfactoryTools) (MIT).
