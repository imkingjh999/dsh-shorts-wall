import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { YtFeed, collectShortsEntries, collectVideoRenderers, extractInitialData, parseDurationText } from '../src/youtube.ts'

// A minimal search-results fixture shaped like the real page: ytInitialData
// with three videoRenderer entries (one without duration — a live/shorts —
// which the feed filters out). Built programmatically to avoid hand-nested
// JSON typos.
const renderer = (videoId: string, title: string, author: string, lengthText?: string): unknown => ({
  videoRenderer: {
    videoId,
    title: { runs: [{ text: title }] },
    ownerText: { runs: [{ text: author }] },
    ...(lengthText !== undefined ? { lengthText: { simpleText: lengthText } } : {}),
  },
})
const fixtureData = {
  contents: {
    twoColumnSearchResultsRenderer: {
      primaryContents: {
        sectionListRenderer: {
          contents: [
            { itemSectionRenderer: { contents: [
              renderer('dQw4w9WgXcQ', 'Kpop Dance Cover 舞蹈翻跳', 'Dance Channel', '3:41'),
              renderer('abc123XYZ_-', '直播中 Live Now', 'Live Channel'),
              renderer('ZZZ999zzz9Y', '1 小時爵士舞', 'Jazz Studio', '1:02:03'),
            ] } },
          ],
        },
      },
    },
  },
}
const fixture = `<!doctype html><html><body><script>var ytInitialData = ${JSON.stringify(fixtureData)};</script></body></html>`

const fixtures = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures')
const realPage = readFileSync(join(fixtures, 'yt_search.html'), 'utf8')
const realShortsPage = readFileSync(join(fixtures, 'yt_shorts_search.html'), 'utf8')

describe('parseDurationText', () => {
  it('parses mm:ss and h:mm:ss', () => {
    expect(parseDurationText('3:41')).toBe(221)
    expect(parseDurationText('1:02:03')).toBe(3723)
    expect(parseDurationText(undefined)).toBe(0)
    expect(parseDurationText('x:y')).toBe(0)
  })
})

describe('ytInitialData extraction', () => {
  it('extracts and collects videoRenderers, skipping entries without duration at feed level', () => {
    const data = extractInitialData(fixture)
    expect(data).toBeDefined()
    const all = [...collectVideoRenderers(data!).values()]
    expect(all.length).toBe(3) // collector keeps all; the feed filters
    const first = all[0]!
    expect(first).toMatchObject({
      videoId: 'dQw4w9WgXcQ',
      title: 'Kpop Dance Cover 舞蹈翻跳',
      authorName: 'Dance Channel',
      durationSec: 221,
      thumbUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    })
  })

  it('parses the real captured search page', () => {
    const data = extractInitialData(realPage)
    expect(data).toBeDefined()
    const all = [...collectVideoRenderers(data!).values()]
    expect(all.length).toBeGreaterThan(5)
    for (const v of all.slice(0, 8)) {
      expect(v.videoId).toMatch(/^[A-Za-z0-9_-]{11}$/)
      expect(v.title.length).toBeGreaterThan(0)
      expect(v.thumbUrl).toContain('i.ytimg.com/vi/')
    }
  })
})

describe('YtFeed', () => {
  it('scrapes one query page and filters duration-less entries', async () => {
    const seen: string[] = []
    const fetchMock = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString()
      seen.push(url)
      return new Response(fixture, { status: 200, headers: { 'content-type': 'text/html' } })
    }) as unknown as typeof fetch
    const feed = new YtFeed(fetchMock)
    const p1 = await feed.page('跳舞')
    expect(p1.query).toBe('跳舞')
    expect(p1.items.length).toBe(2) // the live entry (no duration) is dropped
    expect(p1.hasMore).toBe(false) // one anonymous page per query, no pagination
    expect(seen[0]).toContain('search_query=')
  })

  it('collects shorts entries from the real captured shorts page', () => {
    const data = extractInitialData(realShortsPage)
    expect(data).toBeDefined()
    const items = [...collectShortsEntries(data!).values()]
    expect(items.length).toBeGreaterThanOrEqual(10)
    for (const v of items.slice(0, 5)) {
      expect(v.videoId).toMatch(/^[A-Za-z0-9_-]{11}$/)
      expect(v.title.length).toBeGreaterThan(0)
      expect(v.isShorts).toBe(true)
      expect(v.thumbUrl).toContain('ytimg.com')
    }
  })

  it('parses the legacy reelItemRenderer shape too', () => {
    const legacy = {
      itemSectionRenderer: { contents: [{ reelItemRenderer: { videoId: 'dQw4w9WgXcQ', headline: { simpleText: '热舞 Shorts' }, viewCountText: { simpleText: '1万次观看' } } }] },
    }
    const items = [...collectShortsEntries(legacy).values()]
    expect(items.length).toBe(1)
    expect(items[0]).toMatchObject({ videoId: 'dQw4w9WgXcQ', title: '热舞 Shorts', isShorts: true })
  })

  it('serves shorts pages with the shorts filter and keeps duration-less entries', async () => {
    const seen: string[] = []
    const shortsFixture = {
      contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [
        { itemSectionRenderer: { contents: [
          { shortsLockupViewModel: {
            entityId: 'shorts-shelf-item-AAAAAAAAAAA',
            accessibilityText: '竖屏热舞, 100次观看 - 播放 Shorts 短视频',
            onTap: { innertubeCommand: { reelWatchEndpoint: { videoId: 'AAAAAAAAAAA', thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/AAAAAAAAAAA/frame0.jpg' }] } } } },
            overlayMetadata: { primaryText: { content: '竖屏热舞' }, secondaryText: { content: '100次观看' } },
          } },
        ] } },
      ] } } } },
    }
    const fetchMock = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString()
      seen.push(url)
      return new Response(`<!doctype html><script>var ytInitialData = ${JSON.stringify(shortsFixture)};</script>`, { status: 200 })
    }) as unknown as typeof fetch
    const feed = new YtFeed(fetchMock)
    const page = await feed.page('美女', { shorts: true })
    expect(page.items.length).toBe(1)
    expect(page.items[0]).toMatchObject({ videoId: 'AAAAAAAAAAA', title: '竖屏热舞', isShorts: true })
    expect(seen[0]).toContain('sp=EgIYAQ%3D%3D')
  })

  it('surfaces a friendly error when the page carries no data', async () => {
    const fetchMock = (async (): Promise<Response> => new Response('<html>consent wall</html>')) as unknown as typeof fetch
    const feed = new YtFeed(fetchMock)
    await expect(feed.page('dance')).rejects.toThrow(/未取到搜索数据/)
  })
})
