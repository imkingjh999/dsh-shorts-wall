/**
 * Media proxy route: allowlisted CDN fetches with Range and redirect support.
 */
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { createProxyFetch, isTunnelResponse } from "../proxy-fetch.ts";
import {
  DESKTOP_UA,
  isAllowedProxyHost,
  isTunnelHost,
  PROXY_TIMEOUT_MS,
  writeJson,
  type RouteHandler,
} from "./http.ts";

type Tunnel = ReturnType<typeof createProxyFetch> | undefined;

interface ProxyOptions {
  fence(req: IncomingMessage): boolean;
  extraAllowSuffixes: readonly string[];
  tunnel: Tunnel;
}

/** Build the /shorts/proxy and legacy /bilibili/proxy handler. */
export function createProxyHandler(options: ProxyOptions): RouteHandler {
  return async (req, res) => {
    if (!options.fence(req)) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", "http://dsh.internal").searchParams.get("u");
    if (url === null || !isAllowedProxyHost(url, options.extraAllowSuffixes)) {
      writeJson(res, 400, {
        ok: false,
        error: { code: "bad-request", message: "missing or disallowed upstream host" },
      });
      return;
    }

    const range = typeof req.headers.range === "string" ? req.headers.range : undefined;
    try {
      // Follow redirects manually so every hop stays inside the allowlist: an
      // allowed CDN must not be able to bounce the proxy to an arbitrary host.
      let currentUrl = url;
      let upstream: Response | Awaited<ReturnType<NonNullable<Tunnel>>> | undefined;
      for (let hop = 0; hop < 5; hop++) {
        const mediaHeaders = {
          "user-agent": DESKTOP_UA,
          accept: "*/*",
          ...(range !== undefined ? { range } : {}),
        };
        // YouTube thumbnails are small and may need the tunnel; large Bilibili
        // streams always take the direct streaming path.
        const response =
          options.tunnel !== undefined && isTunnelHost(currentUrl)
            ? await options.tunnel(currentUrl, {
                redirect: "manual",
                signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
                headers: mediaHeaders,
              })
            : await fetch(currentUrl, {
                redirect: "manual",
                signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
                headers: mediaHeaders,
              });

        const location = response.headers.get("location");
        if (response.status >= 300 && response.status < 400) {
          if (location === null) {
            upstream = response;
            break;
          }
          const nextUrl = new URL(location, currentUrl).toString();
          if (!isAllowedProxyHost(nextUrl, options.extraAllowSuffixes)) {
            writeJson(res, 400, {
              ok: false,
              error: { code: "bad-request", message: "redirect target host is not allowed" },
            });
            return;
          }
          if (!isTunnelResponse(response)) {
            await response.body?.cancel().catch(() => undefined);
          }
          currentUrl = nextUrl;
          continue;
        }
        upstream = response;
        break;
      }

      if (upstream === undefined) {
        writeJson(res, 502, {
          ok: false,
          error: { code: "upstream", message: "too many redirects" },
        });
        return;
      }
      if (!upstream.ok && upstream.status !== 206) {
        writeJson(res, 502, {
          ok: false,
          error: { code: "upstream", message: `upstream responded ${upstream.status}` },
        });
        return;
      }

      const headers: Record<string, string> = { "cache-control": "public, max-age=1800" };
      for (const header of [
        "content-type",
        "content-length",
        "content-range",
        "accept-ranges",
        "etag",
        "last-modified",
      ]) {
        const value = upstream.headers.get(header);
        if (value !== null) headers[header] = value;
      }

      if (isTunnelResponse(upstream)) {
        const body = Buffer.from(await upstream.arrayBuffer());
        if (headers["content-length"] === undefined) {
          headers["content-length"] = String(body.byteLength);
        }
        res.writeHead(upstream.status, headers);
        res.end(req.method === "HEAD" ? undefined : body);
        return;
      }

      res.writeHead(upstream.status, headers);
      if (req.method === "HEAD" || upstream.body === null) {
        res.end();
        return;
      }
      req.on("close", () => {
        void upstream.body?.cancel().catch(() => undefined);
      });
      await pipeline(
        Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream),
        res,
      );
    } catch (error) {
      if (!res.headersSent) {
        writeJson(res, 502, {
          ok: false,
          error: {
            code: "upstream",
            message: error instanceof Error ? error.message : String(error),
          },
        });
      } else {
        res.destroy();
      }
    }
  };
}
