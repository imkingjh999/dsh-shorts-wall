# dsh-shorts-wall (English)

> Repo: <https://github.com/imkingjh999/dsh-shorts-wall> · issues welcome

A DeepSeek Harness (DSH) plugin that adds a **vertical shorts carousel** tab to the [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) sidebar — swipe through short videos with the mouse wheel, auto-advance on end.

> Personal viewing only. Uses anonymous public APIs and official embeds; no login, no signature forging.

## Features

- **Dual source** — switch with the `YT` / `B站` chips in the header (remembered):
  - **YouTube Shorts**: multilingual keyword rotation (editable in the ⚙ panel); official iframe embed with a wheel-catcher veil and a watchdog that keeps auto-advancing even when the event channel is blocked.
  - **Bilibili vertical**: same ⚙ keyword-list UX as YouTube (add/edit/remove, rotation, persisted; defaults: 美女舞蹈 / 美女翻唱 / COS小姐姐) with a portrait preflight (concurrent `view` calls confirm 9:16), **native mp4 playback** through the host proxy — real ended/error events, the most reliable auto-advance; paged tail-append.
- **9:16 locked** — the player box is the largest vertical rectangle inscribed in the card; shorts fill edge to edge.
- **Controls** — wheel / `↑↓` / `j`·`k` / ‹ › buttons to navigate; click the video to pause; 🔊 per-feed sound (persisted).
- **Auto-advance** — end events advance; deterministic per-video errors auto-skip (3-in-a-row circuit breaker); dead videos skip after a 4s watchdog.
- **i18n** — the UI follows the DSH host language (中文 / English), switching live.
- **Keyword management** — the ⚙ panel offers **preset packs** (KPOP fancam / Beauty girls / Cosplay / Beach & swimwear / Stage — one click replaces the list, ＋ appends with dedup) plus **custom** entries (add one by one, or batch-paste `keyword | region` lines), persisted per source.

## Install

Requires DSH ≥ 0.1.0 with a web profile and dsh-better-sidebar installed.

```bash
dsh plugin --profile web add dsh-better-sidebar
cd ~/.dsh/profiles/web
pnpm add link:~/projects/dsh-plugins/dsh-shorts-wall
# append "dsh-shorts-wall" to dsh.profile.bundles in package.json
pnpm install
# restart dsh web, then hard-refresh (⌘⇧R / Ctrl+Shift+R)
```

A「Shorts」tab appears in the sidebar `+` menu.

## Configuration (optional)

```yaml
# profile cordis.patch.yml
- id: bilibili-sidebar
  config:
    extraAllowSuffixes: [cdn.example.com]   # extra proxy allowlist suffixes
    resolveProxyUrl: http://127.0.0.1:7890  # optional personal proxy for feed scraping
```

## Architecture

- **Host** (`src/index.ts`): `POST /bilibili/api/feed` (youtube shorts search · bilibili vertical search) + `POST /bilibili/api/play` (bilibili mp4) + `GET /bilibili/proxy` (browser-trust fence + CDN allowlist, Range passthrough).
- **Resolvers** (`src/youtube.ts`, `src/bilibili-shorts.ts`): anonymous search scraping / portrait preflight / progressive-mp4 playurl.
- **Client** (`src/client/`): thin render components over three hooks — `embed-events` (player event plumbing), `feed-state` (batch/append/navigation), `card-timers` (cover/title timing) — plus `i18n` (zh/en).

## Known limits

- YouTube source needs the machine/browser to reach YouTube (mainland networks flap; `resolveProxyUrl` covers feed scraping, playback still needs browser reach).
- Anonymous bilibili tops out at ~480p/720p; higher needs login (out of scope).
- Host-side error messages surface in Chinese; UI chrome is bilingual.

## Development

```bash
pnpm install
pnpm test          # vitest (resolvers, lifecycle, i18n)
pnpm typecheck
pnpm run build
node tests/smoke-client.mjs && node tests/e2e-client.mjs
```

## License

MIT
