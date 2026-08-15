# dsh-shorts-wall (English)

> Repo: <https://github.com/imkingjh999/dsh-shorts-wall> · issues welcome

中文 | [English](README_EN.md)

A **vertical shorts wall** plugin for DeepSeek Harness (DSH) running as a **draggable floating window**: drag/resize freely, snap it to the screen's right edge to dock as a slim rail (click to expand), or close it and recall from the bottom-right launcher; with dsh-better-sidebar installed it also registers a sidebar tab (optional, not a dependency). Dual source: **YouTube Shorts** + **Bilibili vertical** — wheel/keys/buttons to advance, auto-next on end, auto-append at the tail.

> Personal viewing only. Anonymous public APIs and official playback channels throughout: no login, no cracking, no signature forging. Respect each platform's terms of service.

## Features

### Dual-source carousel

Header `YT` / `B站` chips switch sources (remembered), with a "Switching…" toast.

| | YouTube Shorts | Bilibili vertical |
|---|---|---|
| Playback | Official iframe embed | **Native mp4 `<video>`** (host-proxied, Range seek works) |
| Content | Anonymous search (shorts filter) | Anonymous search + **portrait preflight** (concurrent `view` calls confirm 9:16; landscape dropped) |
| Auto-advance | End events + watchdog fallback | Native events (most reliable) |
| Tail append | Same-keyword re-search, deduped | Paged append |

### Keywords

- The **active keyword shows as a chip** in the header (right of the B站 chip); click it to open the **keyword picker** and switch with one click
- **"More videos"** fetches a fresh batch under the SAME keyword (not a keyword change)
- **⚙ keyword panel**:
  - **Preset packs** (click to replace the list, ＋ to append with dedup): KPOP fancam / Fashion / Costume / Pets / POV / Beach & swimwear / Stage
  - **Custom**: add one by one, or batch-paste `keyword | region` lines
  - Inline edit / reorder / delete / reset; per-source lists persisted independently (localStorage)

### Playback experience

- **9:16 locked**: the player is the largest vertical rectangle inscribed in the card — width and height both fit the viewport
- **Navigation**: wheel (debounced) / `↑↓` / `j`·`k` / ‹ › buttons; a wheel-catcher veil over the iframe (wheel never swallowed), click to hand control to the player for 6s
- **Auto-play chain**: end → next; tail → append; dead items auto-skip (3-in-a-row breaker); platform-level YT outage shows a "YouTube unavailable" banner with a one-click switch to Bilibili
- **Sound**: text buttons "Sound on / Muted" (no emoji), preference persisted; hint pill on muted cards
- **Intro chrome**: cover lifts after 1s, title hides after 2s (hover to see) — never blocks the picture
- **i18n**: UI follows the DSH host language (中文 / English), switching live

## Install

Requires DSH ≥ 0.1.0 with a web profile. better-sidebar is optional (adds a sidebar tab when present).

```bash
dsh plugin --profile web add dsh-better-sidebar        # if missing
dsh plugin --profile web add github:imkingjh999/dsh-shorts-wall
# restart dsh web, then hard-refresh (⌘⇧R / Ctrl+Shift+R)
```

A「Shorts」tab appears in the sidebar `+` menu.

<details>
<summary>Local development install (link)</summary>

```bash
cd ~/.dsh/profiles/web
pnpm add link:~/projects/dsh-plugins/dsh-shorts-wall
# append "dsh-shorts-wall" to dsh.profile.bundles in package.json
pnpm install && pnpm run build   # in the plugin directory
```
</details>

## Configuration (optional)

In the profile's `cordis.patch.yml`:

```yaml
- id: shorts-wall
  config:
    extraAllowSuffixes: [cdn.example.com]   # extra proxy allowlist suffixes
    resolveProxyUrl: http://127.0.0.1:7890  # optional personal proxy for feed scraping
```

## Architecture

- **Host** (`src/index.ts`): `POST /shorts/api/feed` (youtube shorts search · bilibili vertical search) + `POST /shorts/api/play` (bilibili mp4) + `GET /shorts/proxy` (browser-trust fence + CDN allowlist + Range passthrough). Legacy `/bilibili/*` prefixes kept for compat.
- **Resolvers** (`src/youtube.ts`, `src/bilibili-shorts.ts`): YT anonymous search `shortsLockupViewModel` (+ legacy `reelItemRenderer`); Bilibili search + concurrent portrait preflight + html5 mp4 playurl.
- **Client** (`src/client/`): thin render components over three behavior hooks — `embed-events` (YT player events/watchdog), `feed-state` (dual-source batches/append/keywords), `card-timers` (cover/title timing) — plus `i18n` (zh/en). better-sidebar is a runtime soft dependency (dormant when absent).

## Known limits

- The **YouTube source** needs the browser to reach YouTube; during platform risk-control (bot walls) that source is unavailable — the plugin shows a clear banner and a one-click switch to Bilibili, which is unaffected.
- Anonymous quality tier: YT per the official embed; Bilibili ~480p/720p (higher needs login — out of scope).
- YT anonymous search has no pagination: ~15–30 items per batch; appends re-search the same keyword with dedup.

## Development

```bash
pnpm install
pnpm test        # vitest: resolvers / lifecycle (jsdom) / i18n dictionaries
pnpm typecheck
pnpm run build   # tsdown: host ESM + dual-channel client CJS factories
node tests/smoke-client.mjs && node tests/e2e-client.mjs   # headless smoke + jsdom render e2e
```

## License

MIT
