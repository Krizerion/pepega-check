# 🐸 Pepega Check

**Who pressed what, and when.** A frontend-only Angular app that reads
[Warcraft Logs](https://www.warcraftlogs.com) reports and draws every pull of a boss fight on a
timeline: boss ability casts, personal defensives, immunities, potions & healthstones, healing
cooldowns, offensive cooldowns and deaths — for every raider, filterable by category.

There is no backend and no database. The app talks to the Warcraft Logs v2 GraphQL API directly
from your browser; credentials live in your browser's localStorage only.

## Views

- **Pull view** — one pull, one row per raider (grouped under Tanks / Healers / DPS headers), with
  all boss casts merged into a sticky horizontal lane at the top (click its label to expand into
  per-ability rows). Phase transitions are drawn as dashed vertical lines, and the "Cast lines"
  toggle extends every boss cast down through the raider rows.
- **Player view** — click any raider (in the sidebar or on a row label) to flip the axis: one row
  per pull, showing everything that raider pressed on every attempt, with the wipe point marked.
  A reference boss lane (from the longest included pull) sits on top, and selected boss abilities
  are overlaid as small ticks on each pull row. Untick pulls in the sidebar to exclude them.
- **Pull analysis** — the 📋 Analysis toggle shows a death log for the selected pull (who died,
  to what, and whether they pressed a defensive or health pot in the 12s before) plus a heuristic
  wipe summary: first blood, deadliest mechanic, death spirals and the likely wipe starter. The
  "Ignore after N deaths" selector greys out everything on the timeline past the Nth death.

Hover any icon for the ability name and timestamp. Use the role and category chips to filter
(health pots/stones and combat pots are separate), the boss ability picker to focus on specific
mechanics, and the −/+ controls to zoom the time axis.

## Getting started

```bash
npm install
npm start
```

Then open <http://localhost:4200>.

1. Create an API client at <https://www.warcraftlogs.com/api/clients> (any redirect URL — only the
   client-credentials flow is used).
2. Open **⚙ Settings** in the app and paste the client ID and secret. They are stored in
   localStorage and sent exclusively to `warcraftlogs.com`.
3. Paste a report URL (e.g. `https://www.warcraftlogs.com/reports/AbCdEf123...`) or a bare report
   code and hit **Load**.

If your browser blocks the token request, generate a token yourself and paste it under
**Settings → Advanced**:

```bash
curl -u CLIENT_ID:CLIENT_SECRET -d grant_type=client_credentials https://www.warcraftlogs.com/oauth/token
```

No credentials? Hit **Demo** for a bundled sample prog night.

## Ability classification

Casts are classified by a curated spell-ID catalog in
[`src/app/core/data/ability-catalog.ts`](src/app/core/data/ability-catalog.ts), grouped into:
defensives, immunities, healing CDs, offensive CDs, movement, utility, and potions/healthstones.
Unknown consumables fall back to name matching (`*Potion*`, `*Healthstone*`, …), so new expansion
consumables keep working. Add spell IDs to the catalog to track more abilities — everything else
picks them up automatically.

## Deploying for your guild (GitHub Pages)

Every push to `main` deploys automatically via
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) — lint, tests, production build
(base href `/pepega-check/`), then GitHub Pages. If the first run cannot enable Pages by itself,
flip **Settings → Pages → Source** to *GitHub Actions* once.

The site is served at `https://<user>.github.io/pepega-check/`.

### Shared credentials without exposing them

A static site cannot keep a secret — anything in the bundle is public. To let teammates use the
app with **zero setup**, deploy the tiny token broker in
[`worker/wcl-token-worker.js`](worker/wcl-token-worker.js) as a free Cloudflare Worker: it holds
the client ID/secret server-side and hands the app a bearer token, restricted by `Origin` to your
Pages site. Then point the app at it:

```json
// public/app-config.json
{ "tokenUrl": "https://your-worker.your-subdomain.workers.dev" }
```

Token resolution order in the app: locally saved credentials (Settings) → the deployment's
`tokenUrl` broker → error. Realistic worst case if someone finds the worker URL: they spend your
API rate limit on public data — the secret itself never leaves the worker.

## Tech

Angular 21 (zoneless, standalone components, signals, native control flow), strict TypeScript,
ESLint (angular-eslint flat config), Prettier, Vitest.

```bash
npm test       # unit tests
npm run lint   # eslint
npm run build  # production build
```
