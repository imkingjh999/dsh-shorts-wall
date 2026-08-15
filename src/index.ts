/**
 * dsh-bilibili-sidebar host half: the /bilibili JSON API (YouTube Shorts
 * search feed) and the /bilibili/proxy media route (Referer-gated ytimg
 * thumbnails with Range passthrough). Every route passes the same
 * browser-trust fence as the /api gateway (Host-header loopback or the web
 * runtime's trusted hosts) — a DNS-rebinding / cross-site defense, not
 * authentication.
 *
 * Personal-use watching only: the proxy allowlist covers the YouTube
 * thumbnail CDN and nothing else; playback runs in the official embed
 * player (never proxied); there is no login and no signature forging.
 */
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { DEFAULT_QUERY, YtError, YtFeed } from './youtube.ts'
import { BiliShortsError, BiliShortsFeed } from './bilibili-shorts.ts'
import { createProxyFetch } from './proxy-fetch.ts'

/** Plugin identity for cordis.yml rows. */
export const name = 'dsh-shorts-wall'

/** Services required before mounting: the webserver routes and the web runtime's trusted hosts. */
export const inject = ['webServer', 'webRuntime']

export type { YtVideo } from './youtube.ts'

/** Structural subset of the host cordis context this plugin touches. */
interface HostContext {
  effect(callback: () => () => void, label?: string): () => void
  webServer: {
    register(route: { kind: 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }): () => void
  }
  webRuntime: { trustedHosts: readonly string[] }
}

/** Optional plugin config (profile patch row `bilibili-sidebar`). */
interface PluginConfig {
  extraAllowSuffixes?: string[]
  /** Optional HTTP CONNECT proxy (e.g. http://127.0.0.1:7890) for feed scraping egress. */
  resolveProxyUrl?: string
}

/** Proxy allowlist: YouTube thumbnails only (playback is the official embed,
 *  loaded directly by the browser — never proxied). */
const BASE_ALLOW_SUFFIXES = [
  'ytimg.com',
  // Bilibili covers (hdslb) + progressive-mp4 streams (bilivideo).
  'bilibili.com',
  'hdslb.com',
  'bilivideo.com',
  'bilivideo.net',
  'bilivideo.cn',
  'akamaized.net',
]

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const MAX_BODY_BYTES = 1 << 16
const PROXY_TIMEOUT_MS = 60_000

/** Whether a request's Host header names the loopback authority. */
function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/** Whether the request authority matches a trustedHosts entry (exact host or host:port). */
function isTrustedAuthority(hostUrl: URL, trustedHosts: readonly string[]): boolean {
  return trustedHosts.some((entry) => {
    try {
      const entryUrl = new URL(`http://${entry}`)
      const sameHost = entryUrl.hostname === hostUrl.hostname
      const entryPort = entryUrl.port !== '' ? entryUrl.port : '80'
      const hostPort = hostUrl.port !== '' ? hostUrl.port : '80'
      return sameHost && entryPort === hostPort
    } catch {
      return false
    }
  })
}

/**
 * Decide whether one request may reach the plugin routes: our Host header
 * (loopback or trusted) and no cross-site browser markers.
 */
function isTrustedRequest(req: IncomingMessage, trustedHosts: readonly string[]): boolean {
  const host = req.headers.host
  if (typeof host !== 'string' || host === '') return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** Whether an upstream URL's host is on the proxy allowlist (exact or subdomain of a suffix). */
export function isAllowedProxyHost(rawUrl: string, extraSuffixes: readonly string[] = []): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  const host = url.hostname.toLowerCase()
  const suffixes = [...BASE_ALLOW_SUFFIXES, ...extraSuffixes.map(s => s.toLowerCase())]
  return suffixes.some(suffix => host === suffix || host.endsWith(`.${suffix}`))
}

/** Read and parse the (bounded) JSON request body. */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk as Buffer | string)
    total += buffer.length
    if (total > MAX_BODY_BYTES) throw new YtError('request body too large')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new YtError('request body is not valid JSON')
  }
}

/** Write a JSON response. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** Host plugin body: register the API and proxy routes. */
export function apply(ctx: HostContext, config?: PluginConfig): void {
  const rawConfig = (config ?? {}) as Partial<PluginConfig>
  const extraAllowSuffixes = Array.isArray(rawConfig.extraAllowSuffixes)
    ? rawConfig.extraAllowSuffixes.filter((s): s is string => typeof s === 'string')
    : []
  const fence = (req: IncomingMessage): boolean => isTrustedRequest(req, ctx.webRuntime.trustedHosts)
  // Scraping egress optionally goes through a personal proxy (mainland
  // networks reach YouTube intermittently). Unset = direct fetch.
  const scrapeFetch = typeof rawConfig.resolveProxyUrl === 'string' && rawConfig.resolveProxyUrl !== ''
    ? (createProxyFetch(rawConfig.resolveProxyUrl, 20_000) as unknown as typeof fetch)
    : fetch
  const ytFeed = new YtFeed(scrapeFetch)
  const biliShorts = new BiliShortsFeed(scrapeFetch)

  // ── JSON API: YouTube Shorts search feed ────────────────────────────────
  // /shorts/* is the canonical prefix; /bilibili/* stays mounted for older
  // cached client bundles (same handler).
  const apiHandler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!fence(req)) {
        writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
        return
      }
      const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://dsh.internal').pathname)
      // Both prefixes serve this handler: strip whichever one matched.
      const method = pathname.startsWith('/bilibili/api/')
        ? pathname.slice('/bilibili/api/'.length)
        : pathname.startsWith('/shorts/api/') ? pathname.slice('/shorts/api/'.length) : ''
      if (req.method !== 'POST') {
        writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
        return
      }
      try {
        const body = await readJsonBody(req)
        if (method === 'play') {
          if (body['kind'] === 'bili') {
            const bvid = body['bvid']
            const cid = body['cid']
            if (typeof bvid !== 'string' || bvid.trim() === '' || typeof cid !== 'number') {
              writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'bvid and cid are required' } })
              return
            }
            const urls = await biliShorts.play(bvid, cid)
            writeJson(res, 200, { ok: true, value: { play: { urls } } })
            return
          }
          writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'only kind=bili is supported' } })
          return
        }
        if (method !== 'feed') {
          writeJson(res, 404, { ok: false, error: { code: 'not-found', message: 'unknown API method' } })
          return
        }
        const source = typeof body['source'] === 'string' ? body['source'] : ''
        if (source === 'bilibili') {
          // Rotate mode: the client's keyword list rides the request (its
          // cursor lives host-side per session, same as the YT rotation).
          const customList = Array.isArray(body['rotation'])
            ? body['rotation']
                .filter((x): x is { query: string; region: string } =>
                  typeof x === 'object' && x !== null
                  && typeof (x as Record<string, unknown>)['query'] === 'string' && (x as Record<string, unknown>)['query'] !== '')
            : undefined
          const rotated = body['rotate'] === true && customList !== undefined && customList.length > 0
            ? biliShorts.next(customList)
            : undefined
          const rawQuery = body['query']
          const query = rotated?.query
            ?? (typeof rawQuery === 'string' && rawQuery.trim() !== '' ? rawQuery.trim().slice(0, 60) : '美女 舞蹈')
          const pageNo = typeof body['page'] === 'number' && body['page'] >= 1 ? Math.floor(body['page']) : 1
          const { items, hasMore } = await biliShorts.page(query, pageNo)
          writeJson(res, 200, { ok: true, value: { bili: items, hasMore, page: pageNo, query, region: rotated?.region } })
          return
        }
        if (source !== 'youtube') {
          writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'source must be youtube or bilibili' } })
          return
        }
        const rawQuery = body['query']
        const rotate = body['rotate'] === true
        // User-managed rotation list (client persists it): [{query, region}].
        const customList = Array.isArray(body['rotation'])
          ? body['rotation']
              .filter((x): x is { query: string; region: string } =>
                typeof x === 'object' && x !== null
                && typeof (x as Record<string, unknown>)['query'] === 'string' && (x as Record<string, unknown>)['query'] !== '')
          : undefined
        const rotated = rotate
          ? (customList !== undefined && customList.length > 0 ? ytFeed.nextRotatedQueryFrom(customList) : ytFeed.nextRotatedQuery())
          : undefined
        const query = rotated?.query
          ?? (typeof rawQuery === 'string' && rawQuery.trim() !== '' ? rawQuery.trim().slice(0, 60) : DEFAULT_QUERY)
        const { items, hasMore, query: used } = await ytFeed.page(query, { shorts: body['shorts'] !== false })
        writeJson(res, 200, { ok: true, value: { yt: items, hasMore, page: 1, query: used, region: rotated?.region } })
      } catch (error) {
        const presentable = error instanceof YtError || error instanceof BiliShortsError
        writeJson(res, presentable ? 400 : 500, {
          ok: false,
          error: {
            code: presentable ? 'resolve-failed' : 'internal',
            message: error instanceof Error ? error.message : String(error),
          },
        })
      }
  }
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/bilibili/api',
    handler: async (req, res) => apiHandler(req, res),
  }), 'shorts-wall: /bilibili/api compat routes')
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/shorts/api',
    handler: async (req, res) => apiHandler(req, res),
  }), 'shorts-wall: /shorts/api routes')

  // ── Media proxy: stream ytimg thumbnails with Range passthrough ─────────
  const proxyHandler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!fence(req)) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405)
        res.end()
        return
      }
      const url = new URL(req.url ?? '/', 'http://dsh.internal').searchParams.get('u')
      if (url === null || !isAllowedProxyHost(url, extraAllowSuffixes)) {
        writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'missing or disallowed upstream host' } })
        return
      }
      const range = typeof req.headers.range === 'string' ? req.headers.range : undefined
      try {
        const upstream = await fetch(url, {
          redirect: 'follow',
          signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
          headers: {
            'user-agent': DESKTOP_UA,
            accept: '*/*',
            ...(range !== undefined ? { range } : {}),
          },
        })
        if (!upstream.ok && upstream.status !== 206) {
          writeJson(res, 502, {
            ok: false,
            error: { code: 'upstream', message: `upstream responded ${upstream.status}` },
          })
          return
        }
        const headers: Record<string, string> = { 'cache-control': 'public, max-age=1800' }
        for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
          const value = upstream.headers.get(header)
          if (value !== null) headers[header] = value
        }
        res.writeHead(upstream.status, headers)
        if (req.method === 'HEAD' || upstream.body === null) {
          res.end()
          return
        }
        req.on('close', () => { void upstream.body?.cancel().catch(() => undefined) })
        await pipeline(Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream), res)
      } catch (error) {
        if (!res.headersSent) {
          writeJson(res, 502, {
            ok: false,
            error: { code: 'upstream', message: error instanceof Error ? error.message : String(error) },
          })
        } else {
          res.destroy()
        }
      }
  }
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/bilibili/proxy',
    handler: async (req, res) => proxyHandler(req, res),
  }), 'shorts-wall: /bilibili/proxy compat routes')
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/shorts/proxy',
    handler: async (req, res) => proxyHandler(req, res),
  }), 'shorts-wall: /shorts/proxy media route')
}

