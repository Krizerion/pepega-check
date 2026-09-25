# 🐸 Pepega Check

**Who pressed what, and when.** A frontend-only Angular app that reads
[Warcraft Logs](https://www.warcraftlogs.com) reports and draws every pull of a boss fight on a
timeline: boss ability casts, personal defensives, immunities, potions & healthstones, healing
cooldowns, offensive cooldowns and deaths — for every raider, filterable by category.

There is no backend and no database. The app talks to the Warcraft Logs v2 GraphQL API directly
from your browser; credentials live in your browser's localStorage only. What that means for data
handling is spelled out in [`public/privacy.html`](public/privacy.html), which ships as a static
page alongside the app.

## Layout

The chrome is deliberately thin — every pixel it takes is a pixel the timeline does not get.

- **App bar** — the report you are reading, a button to swap it, attribution and Settings.
- **Context bar** — boss picker, pull stepper, the Timeline / Raider / Analysis switch, and zoom.
- **Filter strip** — one scrollable row of category chips. Each chip's caret opens a popover
  listing that category's abilities, so you can hide a single spell without turning off its whole
  category. Icons there carry Wowhead tooltips.
- **Rail** — pulls and raiders. It collapses below 1080px and becomes a drawer on phones.

## Views

- **Timeline (pull view)** — one pull, one row per raider (grouped under Tanks / Healers / DPS
  headers), with all boss casts merged into a sticky horizontal lane at the top (click its label to
  expand into per-ability rows). Phase transitions are drawn as dashed vertical lines, and the
  "Cast lines" toggle extends every boss cast down through the raider rows.
- **Raider (player view)** — click any raider (in the rail or on a row label) to flip the axis: one
  row per pull, showing everything that raider pressed on every attempt, with the wipe point
  marked. A reference boss lane (from the longest included pull) sits on top, and selected boss
  abilities are overlaid as small ticks on each pull row. Untick pulls in the rail to exclude them.
- **Analysis** — scoped to this pull or every included pull. It holds a death log, damage taken by
  mechanic and by raider, avoidable damage, a utility/cooldown table, and a phase breakdown showing
  where pulls actually end.

The death log is the detailed half: one card per death covering the last 12 seconds, with a health
trace, every hit that landed (with health either side, overkill and absorbs), the cooldowns they
pressed, the ones that were available and unused, and incoming healing. Long runs of HoT ticks fold
into a single line that expands to show which healer and which spell. "Ignore after N deaths" greys
out everything on the timeline past the Nth death, so a wipe's tail does not drown the start.

Hover any icon for the ability name and timestamp; click a marker to pin its Wowhead tooltip.

Ability names that link to Wowhead show the live Wowhead spell tooltip on hover, via their
[tooltip widget](https://wow.zamimg.com/js/tooltips.js) loaded in `index.html`. Links rendered
after page load are re-scanned by the `appWowhead` directive in
[`src/app/core/wowhead`](src/app/core/wowhead/wowhead-tooltip.ts).

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
flip **Settings → Pages → Source** to _GitHub Actions_ once.

The site is served at `https://<user>.github.io/pepega-check/`.

### Shared credentials without exposing them

A static site cannot keep a secret — anything in the bundle is public. Two zero-setup options for
teammates; in both, the **client secret never ships**, only a bearer token that grants read access
to public Warcraft Logs data (worst case if extracted: someone spends your API rate limit).

**Option A — GitHub Actions secrets (recommended, no extra infrastructure):** add two repository
secrets under **Settings → Secrets and variables → Actions**:

- `WCL_CLIENT_ID`
- `WCL_CLIENT_SECRET`

The deploy workflow exchanges them for an access token at build time and embeds the token in
`app-config.json`. A weekly scheduled rebuild keeps the token fresh (WCL tokens live up to a
year, so even a quiet repo stays working).

**Option B — Cloudflare Worker token broker:** deploy
[`worker/wcl-token-worker.js`](worker/wcl-token-worker.js) as a free Worker holding the
credentials server-side, then set its URL in `public/app-config.json`:

```json
{ "tokenUrl": "https://your-worker.your-subdomain.workers.dev" }
```

Token resolution order in the app: locally saved credentials (Settings) → embedded shared token →
`tokenUrl` broker → error.

## Tech

Angular 21 (zoneless, standalone components, signals, native control flow), strict TypeScript,
ESLint (angular-eslint flat config), Prettier, Vitest.

```bash
npm test       # unit tests
npm run lint   # eslint
npm run build  # production build
```
