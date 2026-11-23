# Kraesen

A meal planner for macro goals and a limited selection of foods: whatever is
in the fridge, the garden or the freezer, plus a few foods you are willing to
buy. Claude picks ingredients and writes the recipe; the app computes the exact
grams so the meal hits your protein, carb, fat and energy target.

It is a PWA with no backend. Everything is stored in the browser (IndexedDB),
and each user pastes their own Claude API key.

Claude only ever uses what you list. That makes it work for restricted diets:
it never adds a food, a garnish or a seasoning you did not put there.

## Using it

The first time, Cook shows four short steps: your daily goals, your food rules
("pescatarian, no sweeteners", or none), a Claude API key from
console.anthropic.com (checked with a tiny request), and your first foods.

- **Kitchen**: every food has one setting for where it is. **Home** (fridge,
  cupboard, garden), **Freezer**, **Shop** (not at home, but you would buy it)
  or **Not now** (kept with its macros; Claude never sees it), like garden
  courgettes in winter. Home-grown produce is added by hand with its macros per
  100 g. Packaged products can be scanned: the barcode is looked up in
  [Open Food Facts](https://world.openfoodfacts.org); if it is not there,
  photograph the nutrition label and Claude reads the values for you to confirm.
  **Staples** lists the seasonings Claude may add (salt, pepper, spices). With
  none listed, recipes come without seasoning.
- **Cook**: pick ¼, ⅓ or ½ of your day (or adjust the numbers), say how much
  shopping is fine, optionally add a wish ("something warm"), and make a meal.
  "Check what's in" fixes stale stock without leaving the screen. You see each
  portion fit Claude tries, then the recipe, with a To buy list when it uses
  shop foods.
- **Settings** (the gear): goals, food rules, the API key, and a JSON
  backup. The key is never exported.

## How meal planning works

`src/claude.ts` runs a tool-use loop with two tools:

- `compute_portions`: Claude names a set of foods and optional gram bounds;
  `src/solver.ts` finds the grams that minimise the relative error over the
  four macros (bounded least squares, deterministic) and reports the deviation.
- `submit_recipe`: Claude picks one of those solutions by id and writes the
  steps. The recipe's amounts come from that solution, never from Claude.

The prompt lists the foods in HOME, FREEZER and SHOP groups with the STAPLES,
and says that nothing else may be used, mentioned or suggested. The app
enforces what it can: it only accepts offered foods, counts shop foods against
the shopping limit, and only lets an extra be one of the staples (or water):
the tool's schema lists them as the only choices, and the app checks it. In the code a food is still a `Ware`.

Data saved by the first version (a list and a status per food) is upgraded on
load; when a case is unclear, the food gets the state that offers Claude less.

## Development

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests
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
