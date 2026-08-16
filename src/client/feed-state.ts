/**
 * Data hooks for the shorts feed: batch loading (fixed keyword or host-side
 * multilingual rotation), seamless tail auto-append, navigation with a
 * stale-closure-proof index, and the user-managed rotation list persisted
 * in localStorage. Extracted from ShortsFeed so the component stays layout.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_QUERY, type YtVideo } from "../youtube.ts";
import type { BiliShort } from "../bilibili-shorts.ts";
import type { RotatedEntry } from "./rotation.ts";

export { useRotation, type RotatedEntry } from "./rotation.ts";

/** Which site the feed pulls from. */
export type FeedSource = "youtube" | "bilibili";
const SOURCE_KEY = "dsh-bilibili-sidebar:source";
const QUERY_KEY = "dsh-bilibili-sidebar:q:youtube";

/** Fetch one batch from the host API. YouTube: rotate/fixed keyword;
 *  bilibili: page-numbered search of its own keyword. */
async function fetchBatch(
  source: FeedSource,
  mode: "rotate" | "fixed",
  query: string,
  page: number,
  rotation: readonly RotatedEntry[],
): Promise<{
  yt: YtVideo[];
  bili: BiliShort[];
  query?: string;
  region?: string;
}> {
  const res = await fetch("/shorts/api/feed", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      source === "bilibili"
        ? mode === "rotate"
          ? {
              page,
              source: "bilibili",
              rotate: true,
              ...(rotation.length > 0 ? { rotation } : {}),
            }
          : { page, source: "bilibili", query }
        : mode === "rotate"
          ? {
              page: 1,
              source: "youtube",
              rotate: true,
              shorts: true,
              ...(rotation.length > 0 ? { rotation } : {}),
            }
          : { page: 1, source: "youtube", query, shorts: true },
    ),
  });
  const body = (await res.json()) as {
    ok: boolean;
    value?: {
      yt?: YtVideo[];
      bili?: BiliShort[];
      query?: string;
      region?: string;
    };
    error?: { message?: string };
  };
  if (!body.ok || body.value === undefined) throw new Error(body.error?.message ?? "列表加载失败");
  return {
    yt: body.value.yt ?? [],
    bili: body.value.bili ?? [],
    query: body.value.query,
    region: body.value.region,
  };
}

/** Fisher–Yates shuffle (returns a new array; feed batches play in random
 *  order so every session start and every 换一批 feels fresh even when the
 *  upstream ordering is fixed). */
export function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Resolve a bilibili short's mp4 candidates through the host play route. */
export async function fetchBiliPlay(bvid: string, cid: number): Promise<string[]> {
  const res = await fetch("/shorts/api/play", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "bili", bvid, cid }),
  });
  const body = (await res.json()) as {
    ok: boolean;
    value?: { play: { urls: string[] } };
    error?: { message?: string };
  };
  if (!body.ok || body.value === undefined)
    throw new Error(body.error?.message ?? "播放地址获取失败");
  return body.value.play.urls;
}

export interface FeedItem {
  kind: "yt" | "bili";
  id: string;
  yt?: YtVideo;
  bili?: BiliShort;
}

export interface ShotsFeedState {
  /** YT source unusable right now (consecutive playback failures) — show a
   *  banner suggesting the Bilibili source instead of per-card retries. */
  ytDown: boolean;
  /** Report a YT playback outcome (ok=true resets the fail streak). */
  noteYtOutcome: (ok: boolean) => void;
  source: FeedSource;
  setSource: (s: FeedSource) => void;
  items: FeedItem[];
  idx: number;
  usedQuery: string;
  /** The actively selected keyword (label for the chip). */
  activeQuery: string;
  /** Pick a keyword from the list: reload immediately under it. */
  selectQuery: (q: string) => void;
  /** Refresh the VIDEO batch: same keyword, fresh results. */
  refreshVideos: () => void;
  region: string;
  busy: boolean;
  error: string | null;
  mode: "rotate" | "fixed";
  /** Manual next/prev: append the next batch at the tail, reset the error budget. */
  next: () => void;
  prev: () => void;
  /** Jump to a uniformly random index (🎲 button; avoids the current one). */
  jumpRandom: () => void;
  /** Consecutive auto-skip budget (shared with the card's error path). */
  autoSkipRef: { current: number };
  /** Reload page 1 (keyword change / retry / panel reset). */
  reload: (q: string | null) => void;
  /** Pin a fixed keyword (enter in the search box). */
  pin: (q: string) => void;
  dismissError: () => void;
}

/**
 * The whole feed lifecycle. `idxRef`/`itemsRef` mirror the latest state for
 * event callbacks that fire from stale closures (end/watchdog events fire
 * minutes after mount — reading captured state would freeze the chain).
 */
export function useShotsFeed(
  rotation: readonly RotatedEntry[],
  biliRotation: readonly RotatedEntry[],
): ShotsFeedState {
  const [items, setItems] = useState<FeedItem[]>([]);
  const itemsRef = useRef<FeedItem[]>([]);
  itemsRef.current = items;
  const [source, setSourceState] = useState<FeedSource>(() => {
    try {
      return localStorage.getItem(SOURCE_KEY) === "bilibili" ? "bilibili" : "youtube";
    } catch {
      return "youtube";
    }
  });
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const setSource = useCallback((next: FeedSource): void => {
    try {
      localStorage.setItem(SOURCE_KEY, next);
    } catch {
      /* optional */
    }
    sourceRef.current = next; // sync: the immediate reload below must see it
    setSourceState(next);
    // reload immediately under the new source
    void loadRef.current?.(next === "bilibili" ? "" : null);
  }, []);
  /** Page cursor for the bilibili source (append keeps paging forward). */
  const biliPageRef = useRef(0);
  const loadRef = useRef<((q: string | null) => Promise<void>) | null>(null);
  const [idx, setIdx] = useState(0);
  const idxRef = useRef(0);
  const setIdxTracked = useCallback((value: number | ((cur: number) => number)): void => {
    setIdx((cur) => {
      const nextVal = typeof value === "function" ? value(cur) : value;
      idxRef.current = nextVal;
      return nextVal;
    });
  }, []);

  const [usedQuery, setUsedQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [region, setRegion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"rotate" | "fixed">("rotate");
  const [query, setQuery] = useState(() => {
    try {
      return localStorage.getItem(QUERY_KEY) ?? DEFAULT_QUERY;
    } catch {
      return DEFAULT_QUERY;
    }
  });
  /** Consecutive auto-skips (error-driven); manual navigation resets it. */
  const autoSkipRef = useRef(0);
  const loadingRef = useRef(false);

  useEffect(() => {
    if (error !== null) {
      const t = window.setTimeout(() => {
        setError(null);
      }, 6000);
      return () => {
        window.clearTimeout(t);
      };
    }
  }, [error]);

  /** Replace the list with one batch (page-1 semantics). */
  const load = useCallback(
    async (q: string | null): Promise<void> => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setBusy(true);
      setError(null);
      try {
        const src = sourceRef.current;
        const useMode = q === null || q === "" ? "rotate" : "fixed";
        const activeRotation = src === "bilibili" ? biliRotation : rotation;
        const batch = await fetchBatch(src, useMode, q ?? query, 1, activeRotation);
        const fresh: FeedItem[] =
          src === "bilibili"
            ? shuffled(batch.bili).map((b) => ({
                kind: "bili" as const,
                id: `bili:${b.bvid}`,
                bili: b,
              }))
            : shuffled(batch.yt).map((y) => ({
                kind: "yt" as const,
                id: `yt:${y.videoId}`,
                yt: y,
              }));
        if (fresh.length === 0) {
          setError(
            src === "bilibili" ? "没有搜到竖屏视频，换个词试试" : "没有搜到 Shorts，换个词试试",
          );
          return;
        }
        // Random starting page (1-3): combined with the shuffle, every session
        // start lands on a different batch even under a fixed keyword.
        biliPageRef.current = src === "bilibili" ? 1 + Math.floor(Math.random() * 3) : 1;
        setItems(fresh);
        idxRef.current = 0;
        setIdx(0);
        if (batch.query !== undefined) {
          setUsedQuery(batch.query);
          setActiveQuery(batch.query);
        }
        setRegion(batch.region ?? "");
        setMode(useMode);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        loadingRef.current = false;
        setBusy(false);
      }
    },
    [query, rotation, biliRotation],
  );
  loadRef.current = (q: string | null): Promise<void> => {
    return load(q);
  };

  /** Load one specific bilibili page under `q` (replaces the list). Used by
   *  refreshVideos to page forward instead of replaying page 1. */
  const loadBiliPage = useCallback(
    async (q: string, pageNo: number): Promise<void> => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setBusy(true);
      setError(null);
      try {
        const batch = await fetchBatch("bilibili", "fixed", q, pageNo, biliRotation);
        const fresh = shuffled(batch.bili).map((b) => ({
          kind: "bili" as const,
          id: `bili:${b.bvid}`,
          bili: b,
        }));
        if (fresh.length === 0) {
          // Past the last page: wrap back to page 1 so the button always yields.
          biliPageRef.current = 1;
          const first = await fetchBatch("bilibili", "fixed", q, 1, biliRotation);
          setItems(
            shuffled(first.bili).map((b) => ({
              kind: "bili" as const,
              id: `bili:${b.bvid}`,
              bili: b,
            })),
          );
          idxRef.current = 0;
          setIdx(0);
          if (first.query !== undefined) {
            setUsedQuery(first.query);
            setActiveQuery(first.query);
          }
          return;
        }
        setItems(fresh);
        idxRef.current = 0;
        setIdx(0);
        if (batch.query !== undefined) {
          setUsedQuery(batch.query);
          setActiveQuery(batch.query);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        loadingRef.current = false;
        setBusy(false);
      }
    },
    [biliRotation],
  );

  /** Append the next batch when the tail is reached (seamless playback). */
  const loadMore = useCallback(async (): Promise<void> => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setBusy(true);
    try {
      const src = sourceRef.current;
      const nextPage = src === "bilibili" ? biliPageRef.current + 1 : 1;
      const activeRotation = src === "bilibili" ? biliRotation : rotation;
      const batch = await fetchBatch(src, mode, query, nextPage, activeRotation);
      const fresh: FeedItem[] =
        src === "bilibili"
          ? shuffled(batch.bili).map((b) => ({
              kind: "bili" as const,
              id: `bili:${b.bvid}`,
              bili: b,
            }))
          : shuffled(batch.yt).map((y) => ({
              kind: "yt" as const,
              id: `yt:${y.videoId}`,
              yt: y,
            }));
      if (fresh.length === 0) return;
      // Compute the append OUTSIDE the state updater (updaters must stay
      // pure — setState calls inside one are dropped in React 18 batches).
      const prevItems = itemsRef.current;
      const seen = new Set(prevItems.map((item) => item.id));
      const add = fresh.filter((item) => !seen.has(item.id));
      if (add.length === 0 && prevItems.length > 0) {
        // All duplicates (tiny keyword pools): replace so the feed replays
        // instead of stalling at the tail forever.
        if (src === "bilibili") biliPageRef.current = nextPage;
        setItems(fresh);
        setIdxTracked(0);
        return;
      }
      if (src === "bilibili") biliPageRef.current = nextPage;
      setItems([...prevItems, ...add]);
      // Land on the first fresh video of the appended segment — staying
      // parked at the old tail made the append invisible to the viewer.
      setIdxTracked(prevItems.length);
      if (batch.query !== undefined) setUsedQuery(batch.query);
      setRegion(batch.region ?? "");
    } catch {
      // transient network error: the next end/watchdog retry re-triggers
    } finally {
      loadingRef.current = false;
      setBusy(false);
    }
  }, [mode, query, rotation, biliRotation]);

  // Load page 1 on mount (start the rotation).
  useEffect(() => {
    void load(null);
  }, [load]);

  const next = useCallback((): void => {
    autoSkipRef.current = 0;
    const cur = idxRef.current;
    const tail = Math.max(itemsRef.current.length - 1, 0);
    if (cur >= tail && itemsRef.current.length > 0) {
      void loadMore();
      return;
    }
    setIdxTracked(cur + 1);
  }, [loadMore, setIdxTracked]);

  // YT-down detection: track consecutive error-driven skips at the feed
  // level. Three in a row without a successful PLAY means the platform is
  // blocked (bot wall / network) — surface「YT 暂不可用」instead of endless
  // per-card failure cards.
  const [ytDown, setYtDown] = useState(false);
  const ytFailStreakRef = useRef(0);
  const noteYtOutcome = useCallback((ok: boolean): void => {
    if (ok) {
      ytFailStreakRef.current = 0;
      if (ytDownRef.current) setYtDown(false);
      return;
    }
    ytFailStreakRef.current += 1;
    if (ytFailStreakRef.current >= 3 && !ytDownRef.current) setYtDown(true);
  }, []);
  const ytDownRef = useRef(false);
  ytDownRef.current = ytDown;

  const prev = useCallback((): void => {
    setIdxTracked((cur) => Math.max(cur - 1, 0));
  }, [setIdxTracked]);

  /** Uniform random jump; with >1 items it never lands on the current one. */
  const jumpRandom = useCallback((): void => {
    const n = itemsRef.current.length;
    if (n <= 1) return;
    const cur = idxRef.current;
    const pick = Math.floor(Math.random() * (n - 1));
    setIdxTracked(pick >= cur ? pick + 1 : pick);
  }, [setIdxTracked]);

  const pin = useCallback(
    (q: string): void => {
      try {
        localStorage.setItem(QUERY_KEY, q);
      } catch {
        /* optional */
      }
      setQuery(q);
      void load(q);
    },
    [load],
  );

  /** Pick a keyword chip: pin + reload under it. */
  const selectQuery = useCallback(
    (q: string): void => {
      setActiveQuery(q);
      pin(q);
    },
    [pin],
  );

  /** "More videos": bilibili pages FORWARD under the same keyword (page 1
   *  is a fixed ordering — re-fetching it would replay from the first video,
   *  the reported bug); youtube re-searches page 1 (its ordering shuffles
   *  between requests, so it genuinely yields new videos). Falls back to the
   *  active source's first rotation keyword when none is selected. */
  const refreshVideos = useCallback((): void => {
    const fallback =
      sourceRef.current === "bilibili"
        ? (biliRotation[0]?.query ?? "美女 舞蹈")
        : (rotation[0]?.query ?? DEFAULT_QUERY);
    const q = activeQuery !== "" ? activeQuery : fallback;
    if (sourceRef.current === "bilibili") {
      // Bilibili: replace with the NEXT page (fresh videos, not a replay).
      biliPageRef.current += 1;
      void loadBiliPage(q, biliPageRef.current);
      return;
    }
    void load(q);
  }, [load, activeQuery, rotation, biliRotation]);

  return {
    ytDown,
    noteYtOutcome,
    source,
    setSource,
    items,
    idx,
    usedQuery,
    activeQuery,
    selectQuery,
    refreshVideos,
    region,
    busy,
    error,
    mode,
    next,
    prev,
    jumpRandom,
    autoSkipRef,
    reload: load,
    pin,
    dismissError: () => {
      setError(null);
    },
  };
}
