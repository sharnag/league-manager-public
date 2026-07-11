# league-manager-public

Public CDN mirror for the **League Manager** app's scoring logic.

This repo exists for one reason: the public WordPress embed needs to load
`pointsCore.js` (the standings/points calculation) from a CDN, and
[jsDelivr](https://www.jsdelivr.com/) can only serve files from **public** GitHub
repos. The main `league-manager` app repo is private, so this small public repo
holds a copy of that one file.

## ⚠️ Do not edit files here directly

`src/utils/pointsCore.js` is a **generated mirror** — the source of truth lives in
the private `league-manager` repo at the same path. Edits made here will be
overwritten on the next sync. Change the logic there instead, then run the sync
script (from the private repo):

```bash
npm run sync:points
# or: ./scripts/sync-points-core.sh
```

That copies the current file here, pushes it, and purges the jsDelivr cache.

## CDN URL

The embed imports the file from:

```
https://cdn.jsdelivr.net/gh/sharnag/league-manager-public@main/src/utils/pointsCore.js
```

- `@main` always serves the latest pushed version, but jsDelivr caches it for up
  to ~12 hours. The sync script purges the cache automatically; you can also purge
  manually at
  `https://purge.jsdelivr.net/gh/sharnag/league-manager-public@main/src/utils/pointsCore.js`.
- For guaranteed-immutable, instantly-updating URLs, pin to a commit SHA instead
  of `@main` (e.g. `@e2c1778`) and bump it in the embed on each change.

## What's safe to be public

`pointsCore.js` has no framework dependencies, no secrets, and no database access —
it's pure functions that turn match rows into points and standings. The embed
reads data separately from read-only Supabase `public_*` views using a
publishable (anon) key.
