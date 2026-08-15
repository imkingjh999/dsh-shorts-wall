/**
 * Bilibili vertical-shorts resolver: the anonymous search API (vertical=1
 * filter) + a concurrent per-result `view` preflight that keeps only true
 * portrait videos (height > width) and collects their cid for the html5
 * progressive-mp4 playurl — the same playback path the original bilibili
 * feed used (native <video>, no iframe, no watchdog needed).
 */

/** One normalized bilibili shorts entry, ready for the sidebar feed. */
export interface BiliShort {
  bvid: string
  title: string
  authorName: string
  durationSec: number
  coverUrl: string
  cid: number
}

/** Failure with a user-presentable message. */
export class BiliShortsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BiliShortsError'
  }
}

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const API = 'https://api.bilibili.com'
const PAGE_TIMEOUT_MS = 12_000
const SEARCH_PAGE_SIZE = 20
/** How many view-preflights run concurrently per search page. */
const PREFLIGHT_CONCURRENCY = 5

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Strip the <em class="keyword"> highlight tags the search API embeds. */
export function stripTitleHtml(title: string): string {
  return title.replaceAll(/<[^>]+>/g, '')
}

/** "3:41" → seconds (the search API returns duration as "m:ss"). */
export function parseDurationText(text: string | undefined): number {
  if (text === undefined) return 0
  const parts = text.split(':').map(p => Number.parseInt(p, 10))
  if (parts.length === 0 || parts.some(p => !Number.isFinite(p))) return 0
  return parts.reduce((acc, p) => acc * 60 + p, 0)
}

/** Narrow one search result entry to the fields we keep. */
function mapSearchEntry(raw: Record<string, unknown>): { bvid: string; title: string; authorName: string; durationSec: number; coverUrl: string } | undefined {
  const bvid = str(raw['bvid'])
  if (bvid === undefined || !bvid.startsWith('BV')) return undefined
  return {
    bvid,
    title: stripTitleHtml(str(raw['title']) ?? ''),
    authorName: str(raw['author']) ?? '未知UP主',
    durationSec: parseDurationText(str(raw['duration'])),
    coverUrl: str(raw['pic']) ?? '',
  }
}

/**
 * The bilibili shorts feed: one search page, portrait-preflighted.
 * The search API ranks mixed content; the concurrent `view` preflight drops
 * every non-portrait entry so the carousel only ever receives 9:16 videos.
 */
export class BiliShortsFeed {
  private readonly fetchImpl: typeof fetch

  constructor(fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl
  }

  /** One JSON GET with desktop headers. */
  private async getJson(url: string): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(url, {
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      headers: {
        'user-agent': DESKTOP_UA,
        accept: 'application/json',
        'accept-language': 'zh-CN,zh;q=0.9',
        referer: 'https://www.bilibili.com/',
      },
    }).catch(() => {
      throw new BiliShortsError('连不上 B 站（api.bilibili.com）')
    })
    if (!response.ok) throw new BiliShortsError(`B 站接口 HTTP ${response.status}`)
    const body = await response.json() as Record<string, unknown>
    const code = num(body['code']) ?? -1
    if (code !== 0) throw new BiliShortsError(`B 站接口错误：${str(body['message']) ?? `code ${code}`}`)
    return (body['data'] ?? {}) as Record<string, unknown>
  }

  /** Fetch one view record (cid + dimension) — undefined on any failure. */
  private async view(bvid: string): Promise<{ cid: number; portrait: boolean } | undefined> {
    try {
      const data = await this.getJson(`${API}/x/web-interface/view?bvid=${bvid}`)
      const cid = num(data['cid'])
      const dim = data['dimension'] as Record<string, unknown> | undefined
      const w = num(dim?.['width']) ?? 0
      const h = num(dim?.['height']) ?? 0
      if (cid === undefined) return undefined
      return { cid, portrait: h > w && h > 0 }
    } catch {
      return undefined // preflight failures just drop the candidate
    }
  }

  /** One feed page: search (vertical filter) → keep portrait entries only. */
  async page(keyword: string, page: number): Promise<{ items: BiliShort[]; hasMore: boolean }> {
    const q = keyword.trim().slice(0, 60)
    if (q === '') throw new BiliShortsError('搜索词不能为空')
    const data = await this.getJson(
      `https://api.bilibili.com/x/web-interface/wbi/search/type?search_type=video&keyword=${encodeURIComponent(q)}&vertical=1&page=${page}&pagesize=${SEARCH_PAGE_SIZE}`,
    )
    const list = data['result']
    const entries = (Array.isArray(list) ? list : [])
      .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
      .map(mapSearchEntry)
      .filter((x): x is NonNullable<ReturnType<typeof mapSearchEntry>> => x !== undefined)

    // Concurrent portrait preflight (bounded workers keep the API polite).
    const out: BiliShort[] = []
    let cursor = 0
    const worker = async (): Promise<void> => {
      while (cursor < entries.length && out.length < SEARCH_PAGE_SIZE) {
        const entry = entries[cursor++]!
        const view = await this.view(entry.bvid)
        if (view === undefined || !view.portrait) continue
        out.push({ ...entry, cid: view.cid })
      }
    }
    await Promise.all(Array.from({ length: Math.min(PREFLIGHT_CONCURRENCY, Math.max(entries.length, 1)) }, worker))
    return { items: out, hasMore: Array.isArray(list) && list.length >= SEARCH_PAGE_SIZE }
  }

  /** Client-list rotation cursor (host-side session state). */
  private rotateIndex = -1

  /** The next keyword from the client-provided rotation list. */
  next(list: { query: string; region: string }[]): { query: string; region: string } {
    this.rotateIndex = (this.rotateIndex + 1) % list.length
    return list[this.rotateIndex]!
  }

  /** Progressive-mp4 play URLs for one bvid (html5 platform, anonymous). */
  async play(bvid: string, cid: number): Promise<string[]> {
    const data = await this.getJson(
      `${API}/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=64&platform=html5&high_quality=1&fnval=1`,
    )
    const durl = data['durl']
    const urls = Array.isArray(durl)
      ? durl
          .filter((d): d is Record<string, unknown> => typeof d === 'object' && d !== null)
          .map(d => str(d['url']))
          .filter((u): u is string => u !== undefined)
      : []
    if (urls.length === 0) throw new BiliShortsError('未取到播放地址（可能需要登录或地区限制）')
    return urls
  }
}
