# 🐸 Pepega Check

**Who pressed what, and when.** A frontend-only Angular app that reads
[Warcraft Logs](https://www.warcraftlogs.com) reports and draws every pull of a boss fight on a
timeline: boss ability casts, personal defensives, immunities, potions & healthstones, healing
cooldowns, offensive cooldowns and deaths — for every raider, filterable by category.

There is no backend and no database. The app talks to the Warcraft Logs v2 GraphQL API directly
from your browser; credentials live in your browser's localStorage only.

## Views

- **Pull view** — one pull, one row per raider (grouped tank → healer → dps), plus a row per boss
  ability at the top (with cast counts). Phase transitions are drawn as dashed vertical lines.
- **Player view** — click any raider (in the sidebar or on a row label) to flip the axis: one row
  per pull, showing everything that raider pressed on every attempt, with the wipe point marked.
  Select boss abilities in the filter bar to overlay their casts as small ticks on each pull.

Hover any icon for the ability name and timestamp. Use the category chips to filter, the boss
ability picker to focus on specific mechanics, and the −/+ controls to zoom the time axis.

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

## Tech

Angular 21 (zoneless, standalone components, signals, native control flow), strict TypeScript,
ESLint (angular-eslint flat config), Prettier, Vitest.

```bash
npm test       # unit tests
npm run lint   # eslint
npm run build  # production build
```
