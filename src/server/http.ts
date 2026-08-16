/**
 * Shared HTTP primitives for the shorts-wall host routes: request trust
 * fencing, JSON helpers, proxy-host allowlisting, and egress selection.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { YtError } from "../youtube.ts";
import { createProxyFetch } from "../proxy-fetch.ts";

export type RouteHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

/** Structural subset of the host cordis context this plugin touches. */
export interface HostContext {
  effect(callback: () => () => void, label?: string): () => void;
  webServer: {
    register(route: {
      kind: "prefix";
      path: string;
      handler: RouteHandler;
    }): () => void;
  };
  webRuntime: { trustedHosts: readonly string[] };
}

/** Optional plugin config (profile patch row `shorts-wall`). */
export interface PluginConfig {
  extraAllowSuffixes?: string[];
  /** Optional HTTP CONNECT proxy (e.g. http://127.0.0.1:7890) for feed scraping egress. */
  resolveProxyUrl?: string;
}

/** Proxy allowlist: known YouTube/Bilibili media and thumbnail CDNs only. */
const BASE_ALLOW_SUFFIXES = [
  "ytimg.com",
  "bilibili.com",
  "hdslb.com",
  "bilivideo.com",
  "bilivideo.net",
  "bilivideo.cn",
  "akamaized.net",
];

export const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const MAX_BODY_BYTES = 1 << 16;
export const PROXY_TIMEOUT_MS = 60_000;

/**
 * Host suffixes that egress through the proxy when one is active: YouTube's
 * own domains only. Bilibili APIs/CDNs are mainland-direct (and overseas
 * CDNs often reject foreign IPs), so they always stay on the direct path.
 */
const TUNNEL_SUFFIXES = [
  "youtube.com",
  "youtube-nocookie.com",
  "ytimg.com",
  "googlevideo.com",
  "ggpht.com",
  "googleusercontent.com",
];

/**
 * Resolve the egress proxy: explicit config first, then the standard proxy
 * environment variables. Node's fetch ignores HTTP(S)_PROXY, but desktop and
 * WSL setups commonly export one pointing at a local clash/v2ray exit.
 */
export function detectProxyUrl(configured: string | undefined): string | undefined {
  if (typeof configured === "string" && configured !== "") return configured;
  for (const key of [
    "HTTPS_PROXY",
    "https_proxy",
    "HTTP_PROXY",
    "http_proxy",
    "ALL_PROXY",
    "all_proxy",
  ]) {
    const value = process.env[key];
    if (typeof value === "string" && value.startsWith("http://")) return value;
  }
  return undefined;
}

/** Whether a URL's host belongs to the tunnel-egress set. */
export function isTunnelHost(rawUrl: string): boolean {
  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  return TUNNEL_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/** Create the optional CONNECT tunnel used for YouTube-owned hosts. */
export function createTunnel(proxyUrl: string | undefined) {
  return proxyUrl !== undefined ? createProxyFetch(proxyUrl, 20_000) : undefined;
}

/** Whether a request's Host header names the loopback authority. */
function isLoopbackHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "[::1]") return true;
  const parts = hostname.split(".");
  return (
    parts.length === 4 &&
    parts[0] === "127" &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  );
}

/** Whether the request authority matches a trustedHosts entry. */
function isTrustedAuthority(hostUrl: URL, trustedHosts: readonly string[]): boolean {
  return trustedHosts.some((entry) => {
    try {
      const entryUrl = new URL(`http://${entry}`);
      const sameHost = entryUrl.hostname === hostUrl.hostname;
      const entryPort = entryUrl.port !== "" ? entryUrl.port : "80";
      const hostPort = hostUrl.port !== "" ? hostUrl.port : "80";
      return sameHost && entryPort === hostPort;
    } catch {
      return false;
    }
  });
}

/**
 * Decide whether one request may reach the plugin routes: the Host header is
 * loopback or trusted, and the request carries no cross-site browser markers.
 */
export function isTrustedRequest(
  req: IncomingMessage,
  trustedHosts: readonly string[],
): boolean {
  const host = req.headers.host;
  if (typeof host !== "string" || host === "") return false;
  let hostUrl: URL;
  try {
    hostUrl = new URL(`http://${host}`);
  } catch {
    return false;
  }
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts))
    return false;
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  const rawOrigin = req.headers.origin;
  const origin = Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin;
  if (origin === undefined || origin === "") return true;
  try {
    return new URL(origin).host === hostUrl.host;
  } catch {
    return false;
  }
}

/** Whether an upstream URL's host is on the proxy allowlist. */
export function isAllowedProxyHost(
  rawUrl: string,
  extraSuffixes: readonly string[] = [],
): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase();
  const suffixes = [...BASE_ALLOW_SUFFIXES, ...extraSuffixes.map((s) => s.toLowerCase())];
  return suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/** Read and parse the bounded JSON request body. */
export async function readJsonBody(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk as Buffer | string);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) throw new YtError("request body too large");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new YtError("request body is not valid JSON");
  }
}

/** Write a JSON response. */
export function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
