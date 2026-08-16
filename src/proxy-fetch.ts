/**
 * Optional HTTP-CONNECT proxy tunnel for the host-side page fetches.
 *
 * Rationale: bilibili APIs are reachable directly, but the YouTube search
 * page (and any future source) may need a personal VPN/clash egress on
 * mainland networks — free public proxies do NOT work (datacenter IPs are
 * themselves blocked). This module turns `http://host:port` into a
 * fetch-like function so feed scraping can egress through it while media
 * streaming stays direct. Only https targets are tunneled; http falls back
 * to a direct fetch.
 */
import http from "node:http";
import https from "node:https";
import type { IncomingMessage } from "node:http";

/** Minimal fetch-init subset the resolvers use. */
export interface TunnelInit {
  headers?: Record<string, string>;
  redirect?: "follow" | "manual";
  signal?: AbortSignal;
}

/** Built like fetch's Response over the tunneled bytes. */
export interface TunnelResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

const REDIRECT_LIMIT = 5;

/** One tunneled https request (no redirect handling). */
function tunnelOnce(
  proxyUrl: URL,
  targetUrl: URL,
  headers: Record<string, string>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<TunnelResponse> {
  return new Promise((resolve, reject) => {
    const proxyPort = proxyUrl.port !== "" ? Number(proxyUrl.port) : 80;
    const req = http.request({
      host: proxyUrl.hostname,
      port: proxyPort,
      method: "CONNECT",
      path: `${targetUrl.hostname}:${targetUrl.port === "" ? 443 : targetUrl.port}`,
      headers: {
        host: `${targetUrl.hostname}:${targetUrl.port === "" ? 443 : targetUrl.port}`,
      },
      timeout: timeoutMs,
    });
    const fail = (error: unknown): void => {
      req.destroy();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const onAbort = (): void => fail(new Error("aborted"));
    signal?.addEventListener("abort", onAbort, { once: true });
    req.on("timeout", () => fail(new Error("proxy connect timeout")));
    req.on("error", fail);
    req.on("connect", (res: IncomingMessage, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        fail(new Error(`proxy CONNECT rejected: ${res.statusCode ?? "unknown"}`));
        return;
      }
      const tls = https.request(
        {
          socket,
          servername: targetUrl.hostname,
          method: "GET",
          path: targetUrl.pathname + targetUrl.search,
          headers: { ...headers, host: targetUrl.hostname },
          timeout: timeoutMs,
        } as unknown as https.RequestOptions,
        (tres) => {
          const chunks: Buffer[] = [];
          tres.on("data", (chunk) => {
            chunks.push(Buffer.from(chunk));
          });
          tres.on("error", fail);
          tres.on("end", () => {
            signal?.removeEventListener("abort", onAbort);
            const body = Buffer.concat(chunks);
            const headerRecord: Record<string, string> = {};
            for (const [name, value] of Object.entries(tres.headers)) {
              if (typeof value === "string") headerRecord[name.toLowerCase()] = value;
              else if (Array.isArray(value)) headerRecord[name.toLowerCase()] = value.join(", ");
            }
            const status = tres.statusCode ?? 502;
            resolve({
              ok: status >= 200 && status < 300,
              status,
              headers: {
                get: (name: string) => headerRecord[name.toLowerCase()] ?? null,
              },
              text: () => Promise.resolve(body.toString("utf8")),
              json: () => Promise.resolve(JSON.parse(body.toString("utf8"))),
              arrayBuffer: () => {
                const copy = new ArrayBuffer(body.byteLength);
                new Uint8Array(copy).set(body);
                return Promise.resolve(copy);
              },
            });
          });
        },
      );
      tls.on("timeout", () => {
        tls.destroy();
        fail(new Error("tls timeout"));
      });
      tls.on("error", fail);
      tls.end();
    });
    req.end();
  });
}

/**
 * Build a fetch-like function egressing https requests through an
 * HTTP CONNECT proxy (manual/follow redirects supported).
 */
export function createProxyFetch(
  proxyUrlRaw: string,
  timeoutMs: number,
): (url: string, init?: TunnelInit) => Promise<TunnelResponse> {
  const proxyUrl = new URL(proxyUrlRaw);
  return async (url, init = {}) => {
    let target = new URL(url);
    const redirect = init.redirect ?? "follow";
    if (target.protocol !== "https:") {
      return (await fetch(url, {
        headers: init.headers,
        redirect,
        signal: init.signal,
      })) as TunnelResponse;
    }
    for (let hop = 0; hop <= REDIRECT_LIMIT; hop++) {
      const response = await tunnelOnce(
        proxyUrl,
        target,
        init.headers ?? {},
        init.signal,
        timeoutMs,
      );
      const location = response.headers.get("location");
      if (
        redirect !== "follow" ||
        response.status < 300 ||
        response.status >= 400 ||
        location === null
      ) {
        return response;
      }
      target = new URL(location, target);
    }
    throw new Error("proxy fetch: too many redirects");
  };
}
