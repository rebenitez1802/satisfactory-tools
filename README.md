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
   with `N = Σ rᵢ`.
2. We pick `B`, the smallest **3-smooth** number (a number whose only prime
   factors are 2 and 3: 1, 2, 3, 4, 6, 8, 9, 12, 16, 18, 24, …) with `B ≥ N`.
3. A plain splitter tree divides the belt evenly into `B` equal **leaves** — this
   is always possible because `B` is a product of 2s and 3s.
4. Each output `i` is given exactly `rᵢ` leaves (merged back together). The
   leftover `B − N` leaves are routed **back** into the belt feeding the top of
   the tree.
5. At steady state the loop forces every leaf to carry `input / N`, so output `i`
   carries `rᵢ · input / N` — exactly its target rate. The feedback trunk carries
   `input · B / N` (always `< 2 × input`).

When `N` is itself 3-smooth (e.g. splitting into 2, 3, 4, 6, 8, 9 … equal parts),
`B = N`, there are no leftover leaves, and the graph is a **pure tree with no
loops**. Otherwise (fifths, sevenths, elevenths, thirteenths, …) exactly one
**feedback loop** is introduced — the same trick real Satisfactory "odd belt
balancers" use.

Every generated graph is checked by a **flow simulator** that iterates the
network to steady state and confirms each output matches its target before the
graph is displayed, so loop designs are proven correct, not guessed.

> These designs are provably correct but not necessarily minimal; a future pass
> can add the more compact community balancer patterns.

## Development

```bash
npm install
npm run dev        # local dev server
npm test           # run the solver test suite
npm run build      # production build into dist/
npm run typecheck  # type-check only
```

## Deployment

Pushing to `main` runs `.github/workflows/deploy.yml`, which tests, builds, and
publishes `dist/` to GitHub Pages. Enable it once under **Settings → Pages →
Build and deployment → Source: GitHub Actions**. The site is served at
`https://<user>.github.io/satisfactory-tools/` (the Vite `base` is set to match).

---

Not affiliated with Coffee Stain Studios.
