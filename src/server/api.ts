/**
 * JSON API route: dual-source feeds and Bilibili play-url resolution.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { BiliShortsError, BiliShortsFeed } from "../bilibili-shorts.ts";
import { DEFAULT_QUERY, YtError, YtFeed } from "../youtube.ts";
import { readJsonBody, writeJson, type RouteHandler } from "./http.ts";

interface ApiOptions {
  fence(req: IncomingMessage): boolean;
  ytFeed: YtFeed;
  biliShorts: BiliShortsFeed;
}

type RotationEntry = { query: string; region: string };

function readRotation(value: unknown): RotationEntry[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(
    (x): x is RotationEntry =>
      typeof x === "object" &&
      x !== null &&
      typeof (x as Record<string, unknown>)["query"] === "string" &&
      (x as Record<string, unknown>)["query"] !== "",
  );
}

function apiMethod(pathname: string): string {
  if (pathname.startsWith("/bilibili/api/")) return pathname.slice("/bilibili/api/".length);
  if (pathname.startsWith("/shorts/api/")) return pathname.slice("/shorts/api/".length);
  return "";
}

/** Build the /shorts/api and legacy /bilibili/api handler. */
export function createApiHandler(options: ApiOptions): RouteHandler {
  return async (req, res) => {
    if (!options.fence(req)) {
      writeJson(res, 403, {
        ok: false,
        error: { code: "forbidden", message: "forbidden" },
      });
      return;
    }

    const rawPath = new URL(req.url ?? "/", "http://dsh.internal").pathname;
    let pathname: string;
    try {
      pathname = decodeURIComponent(rawPath);
    } catch {
      pathname = rawPath;
    }
    const method = apiMethod(pathname);
    if (req.method !== "POST") {
      writeJson(res, 405, {
        ok: false,
        error: { code: "method-error", message: "method not allowed" },
      });
      return;
    }

    try {
      const body = await readJsonBody(req);
      if (method === "play") {
        if (body["kind"] === "bili") {
          const bvid = body["bvid"];
          const cid = body["cid"];
          if (typeof bvid !== "string" || bvid.trim() === "" || typeof cid !== "number") {
            writeJson(res, 400, {
              ok: false,
              error: { code: "bad-request", message: "bvid and cid are required" },
            });
            return;
          }
          const urls = await options.biliShorts.play(bvid, cid);
          writeJson(res, 200, { ok: true, value: { play: { urls } } });
          return;
        }
        writeJson(res, 400, {
          ok: false,
          error: { code: "bad-request", message: "only kind=bili is supported" },
        });
        return;
      }

      if (method !== "feed") {
        writeJson(res, 404, {
          ok: false,
          error: { code: "not-found", message: "unknown API method" },
        });
        return;
      }

      const source = typeof body["source"] === "string" ? body["source"] : "";
      if (source === "bilibili") {
        const rotation = readRotation(body["rotation"]);
        const rotated =
          body["rotate"] === true && rotation !== undefined && rotation.length > 0
            ? options.biliShorts.next(rotation)
            : undefined;
        const rawQuery = body["query"];
        const query =
          rotated?.query ??
          (typeof rawQuery === "string" && rawQuery.trim() !== ""
            ? rawQuery.trim().slice(0, 60)
            : "美女 舞蹈");
        const pageNo =
          typeof body["page"] === "number" && body["page"] >= 1 ? Math.floor(body["page"]) : 1;
        const { items, hasMore } = await options.biliShorts.page(query, pageNo);
        writeJson(res, 200, {
          ok: true,
          value: { bili: items, hasMore, page: pageNo, query, region: rotated?.region },
        });
        return;
      }

      if (source !== "youtube") {
        writeJson(res, 400, {
          ok: false,
          error: { code: "bad-request", message: "source must be youtube or bilibili" },
        });
        return;
      }

      const rawQuery = body["query"];
      const rotate = body["rotate"] === true;
      const rotation = readRotation(body["rotation"]);
      const rotated = rotate
        ? rotation !== undefined && rotation.length > 0
          ? options.ytFeed.nextRotatedQueryFrom(rotation)
          : options.ytFeed.nextRotatedQuery()
        : undefined;
      const query =
        rotated?.query ??
        (typeof rawQuery === "string" && rawQuery.trim() !== ""
          ? rawQuery.trim().slice(0, 60)
          : DEFAULT_QUERY);
      const { items, hasMore, query: used } = await options.ytFeed.page(query, {
        shorts: body["shorts"] !== false,
      });
      writeJson(res, 200, {
        ok: true,
        value: { yt: items, hasMore, page: 1, query: used, region: rotated?.region },
      });
    } catch (error) {
      const presentable = error instanceof YtError || error instanceof BiliShortsError;
      writeJson(res, presentable ? 400 : 500, {
        ok: false,
        error: {
          code: presentable ? "resolve-failed" : "internal",
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  };
}
