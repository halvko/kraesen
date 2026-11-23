# Kraesen

A meal planner for macro goals and a limited selection of wares: whatever is
in the fridge, the garden or the freezer, plus a few wares you are willing to
buy. Claude picks ingredients and writes the recipe; the app computes the exact
grams so the meal hits your protein, carb, fat and energy target.

It is a PWA with no backend. Everything is stored in the browser (IndexedDB),
and each user pastes their own Claude API key.

## Using it

1. **Settings**: enter your daily goals (protein, carbs, fat, kcal), any food
   preferences every meal must follow ("pescatarian, no sweeteners"), and
   paste a Claude API key from console.anthropic.com. Export a JSON backup now and
   then; the key is never exported.
2. **Wares**: add what you have. Home-grown produce is added by hand with its
   macros per 100 g. Packaged products can be scanned: the barcode is looked up
   in [Open Food Facts](https://world.openfoodfacts.org); if it is not there,
   photograph the nutrition label and Claude reads the values for you to
   confirm. Each ware is on the "use" list (what you have at home), the "buy"
   list or neither, and is marked available, frozen or out: a ware can be on
   your use list and out right now, like garden courgettes in winter.
3. **Plan**: pick a share of your daily goals (or type a target), say how
   willing you are to shop, optionally add a wish ("something warm"), and
   generate. Your food preferences always apply. You see each portion fit Claude tries, then the recipe.

## How meal planning works

`src/claude.ts` runs a tool-use loop with two tools:

- `compute_portions`: Claude names a set of wares and optional gram bounds;
  `src/solver.ts` finds the grams that minimise the relative error over the
  four macros (bounded least squares, deterministic) and reports the deviation.
- `submit_recipe`: Claude picks one of those solutions by id and writes the
  steps. The recipe's amounts come from that solution, never from Claude.

The app also enforces the "willing to buy" limit and rejects wares that are
out or not on a list.

## Development

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # solver unit tests
npm run lint
npm run build
```

Camera access needs HTTPS or localhost.

## Deploying to GitHub Pages

The `Deploy` workflow builds and publishes `main` on every push.

1. In the repository, open **Settings → Pages** and set **Source** to
   **GitHub Actions**.
2. Push to `main` (or run the `Deploy` workflow by hand). Without a custom
   domain the app is served from `https://halvko.github.io/kraesen/`.

### Custom subdomain

1. At your DNS provider, add a `CNAME` record for the subdomain (for example
   `kraesen.example.com`) pointing to `halvko.github.io`. On Cloudflare, set it
   to DNS only (grey cloud) so GitHub can issue the HTTPS certificate.
2. In **Settings → Pages**, enter the same domain under **Custom domain**,
   wait for the DNS check, then tick **Enforce HTTPS** (the camera only works
   over HTTPS). With Actions deploys this setting, not the file, attaches the
   domain, so do it first.
3. Add a file `public/CNAME` containing just the domain, e.g.
   `kraesen.example.com`, and merge it to `main`. The deploy workflow sees the
   file and builds for the domain root (`/`) instead of `/kraesen/`; merged
   before step 2, the site at the `github.io` address would load no assets.

Data lives per address, and after the switch the `github.io` address redirects
to the new domain. Anyone already using the app there should export a JSON
backup before step 2, and import it on the new domain.

## Review CI

Pull requests get Claude reviewers (`.github/reviewers/`, ported from Must),
including a UI design reviewer that drives the built app in a headless browser
and takes screenshots. PR descriptions must include a screenshot or video of
the change. See `.github/reviewers/README.md`; the reviewers need the
`CLAUDE_CODE_OAUTH_TOKEN` repository secret.
