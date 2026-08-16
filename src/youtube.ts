/**
 * YouTube feed resolver: scrapes the anonymous search-results page (its
 * `ytInitialData` JSON embeds videoRenderer entries) and plays through the
 * official iframe embed player — no stream extraction, no signature
 * deciphering, no cookies. "Pages" rotate through a query list because the
 * anonymous search page has no pagination.
 */

/** One normalized YouTube video, ready for the sidebar feed. */
export interface YtVideo {
  videoId: string;
  title: string;
  authorName: string;
  durationSec: number;
  thumbUrl: string;
  /** Shorts entries carry no duration and play vertical. */
  isShorts?: boolean;
}

/** Failure with a user-presentable message. */
export class YtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YtError";
  }
}

const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const PAGE_TIMEOUT_MS = 20_000;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Multilingual bikini query rotation — one keyword per feed batch, cycling
 * so successive batches surface creators from different regions. Each entry
 * carries a display region (flag + name) the header shows after each 换一批.
 * Verified anonymously searchable: EN 40 / RU 40 / FR 34 / DE 25 / BR 25 /
 * JA 10 / ES 5 / TR 5 shorts per page (KO returned zero — dropped).
 */
export interface RotatedQuery {
  query: string;
  region: string;
}

export const BIKINI_QUERIES: readonly RotatedQuery[] = [
  { query: "fancam kpop girls dance", region: "🎤 KPOP 直拍" },
];

/** Default client-side search keyword. */
export const DEFAULT_QUERY = "fancam kpop girls dance";

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** "3:41" / "1:02:03" → seconds; undefined when absent (live/shorts). */
export function parseDurationText(text: string | undefined): number {
  if (text === undefined) return 0;
  const parts = text.split(":").map((p) => Number.parseInt(p, 10));
  if (parts.some((p) => !Number.isFinite(p))) return 0;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/** Collect shorts entries out of a parsed ytInitialData blob: the modern
 *  shortsLockupViewModel plus the legacy reelItemRenderer, deduped by id. */
export function collectShortsEntries(
  node: unknown,
  out: Map<string, YtVideo> = new Map(),
): Map<string, YtVideo> {
  if (Array.isArray(node)) {
    for (const item of node) collectShortsEntries(item, out);
    return out;
  }
  if (typeof node !== "object" || node === null) return out;
  const record = node as Record<string, unknown>;

  const lockup = record["shortsLockupViewModel"];
  if (typeof lockup === "object" && lockup !== null) {
    const l = lockup as Record<string, unknown>;
    const onTap = (l["onTap"] as Record<string, unknown> | undefined)?.["innertubeCommand"] as
      | Record<string, unknown>
      | undefined;
    const endpoint = onTap?.["reelWatchEndpoint"] as Record<string, unknown> | undefined;
    const videoId = typeof endpoint?.["videoId"] === "string" ? endpoint["videoId"] : undefined;
    if (videoId !== undefined && VIDEO_ID.test(videoId) && !out.has(videoId)) {
      const overlay = l["overlayMetadata"] as Record<string, unknown> | undefined;
      const title =
        firstRunsText(overlay?.["primaryText"]) ??
        (typeof l["accessibilityText"] === "string"
          ? l["accessibilityText"].split(",")[0]
          : undefined);
      if (title !== undefined) {
        const thumbnail = endpoint?.["thumbnail"] as Record<string, unknown> | undefined;
        const thumbs = thumbnail?.["thumbnails"] as unknown[] | undefined;
        const firstThumb = thumbs?.[0] as Record<string, unknown> | undefined;
        const thumbUrl =
          typeof firstThumb?.["url"] === "string"
            ? firstThumb["url"]
            : `https://i.ytimg.com/vi/${videoId}/frame0.jpg`;
        out.set(videoId, {
          videoId,
          title,
          authorName: firstRunsText(overlay?.["secondaryText"]) ?? "Shorts",
          durationSec: 0,
          thumbUrl,
          isShorts: true,
        });
      }
    }
  }

  // legacy shape
  const reel = record["reelItemRenderer"];
  if (typeof reel === "object" && reel !== null) {
    const r = reel as Record<string, unknown>;
    const videoId =
      typeof r["videoId"] === "string" && VIDEO_ID.test(r["videoId"]) ? r["videoId"] : undefined;
    if (videoId !== undefined && !out.has(videoId)) {
      const title = firstRunsText(r["headline"]);
      if (title !== undefined) {
        out.set(videoId, {
          videoId,
          title,
          authorName: firstRunsText(r["viewCountText"]) ?? "Shorts",
          durationSec: 0,
          thumbUrl: `https://i.ytimg.com/vi/${videoId}/frame0.jpg`,
          isShorts: true,
        });
      }
    }
  }

  for (const value of Object.values(record)) collectShortsEntries(value, out);
  return out;
}

/**
 * Deep-walk a parsed ytInitialData blob and collect videoRenderer-shaped
 * entries (videoId + title text), deduped, in encounter order. The tree
 * shape differs per experiment flag, so key on the objects themselves.
 */
export function collectVideoRenderers(
  node: unknown,
  out: Map<string, YtVideo> = new Map(),
): Map<string, YtVideo> {
  if (Array.isArray(node)) {
    for (const item of node) collectVideoRenderers(item, out);
    return out;
  }
  if (typeof node !== "object" || node === null) return out;
  const record = node as Record<string, unknown>;
  if (
    typeof record["videoId"] === "string" &&
    VIDEO_ID.test(record["videoId"]) &&
    !out.has(record["videoId"])
  ) {
    const title = firstRunsText(record["title"]) ?? firstRunsText(record["headline"]);
    const author =
      firstRunsText(record["ownerText"]) ??
      firstRunsText(record["longBylineText"]) ??
      str(record["shortBylineText"]);
    const lengthText = firstRunsText(record["lengthText"]);
    const videoId = record["videoId"];
    if (title !== undefined) {
      out.set(videoId, {
        videoId,
        title,
        authorName: author ?? "未知频道",
        durationSec: parseDurationText(lengthText),
        thumbUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      });
    }
  }
  for (const value of Object.values(record)) collectVideoRenderers(value, out);
  return out;
}

/** runs[0].text / simpleText out of a YouTube text node. */
function firstRunsText(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const simple = str(record["simpleText"]);
  if (simple !== undefined) return simple;
  const runs = record["runs"];
  if (Array.isArray(runs) && runs.length > 0) {
    const first = runs[0] as Record<string, unknown> | undefined;
    return first === undefined ? undefined : str(first["text"]);
  }
  return undefined;
}

/** Extract the ytInitialData assignment out of a search page's HTML. */
export function extractInitialData(html: string): unknown {
  const m = html.match(/var ytInitialData\s*=\s*(\{[\s\S]*?\});<\/script>/);
  if (m?.[1] === undefined) return undefined;
  try {
    return JSON.parse(m[1]) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * The YouTube feed: one anonymous search-results page per query. The
 * anonymous page carries no pagination, so a "feed" is one query's results
 * (~20 videos); the client offers a keyword box to pull another batch.
 */
export class YtFeed {
  private readonly fetchImpl: typeof fetch;
  /** Query rotation cursor (host-side session state). */
  private rotateIndex = -1;

  constructor(fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl;
  }

  /** The next keyword in the built-in multilingual rotation. */
  nextRotatedQuery(): RotatedQuery {
    this.rotateIndex = (this.rotateIndex + 1) % BIKINI_QUERIES.length;
    return BIKINI_QUERIES[this.rotateIndex]!;
  }

  /** The next keyword from a user-managed rotation list (own cursor). */
  private customIndex = -1;
  nextRotatedQueryFrom(list: readonly RotatedQuery[]): RotatedQuery {
    this.customIndex = (this.customIndex + 1) % list.length;
    return list[this.customIndex]!;
  }

  /** One feed page: the anonymous search results for `query` (shorts filter when asked). */
  async page(
    query: string,
    options?: { shorts?: boolean },
  ): Promise<{ items: YtVideo[]; hasMore: boolean; query: string }> {
    const sp = options?.shorts === true ? "EgIYAQ%3D%3D" : "EgIQAQ%3D%3D";
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=${sp}`;
    const response = await this.fetchImpl(url, {
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      headers: {
        "user-agent": DESKTOP_UA,
        accept: "text/html",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
    }).catch((error: unknown) => {
      const cause = error instanceof Error ? error.message : String(error);
      throw new YtError(
        `连不上 YouTube（本机网络需要能直达 YouTube，或给插件配 resolveProxyUrl / HTTPS_PROXY 代理出口）：${cause}`,
      );
    });
    if (!response.ok) throw new YtError(`YouTube 搜索页 HTTP ${response.status}`);
    const html = await response.text();
    const data = extractInitialData(html);
    if (data === undefined) throw new YtError("YouTube 页面结构变化或被风控，未取到搜索数据");
    const items =
      options?.shorts === true
        ? [...collectShortsEntries(data).values()]
        : // regular videos: skip lives/shorts without a duration — the carousel
          // needs a finite end (shorts mode keeps everything: all finite)
          [...collectVideoRenderers(data).values()].filter((v) => v.durationSec > 0);
    return { items, hasMore: false, query };
  }
}
