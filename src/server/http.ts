/**
 * Shared HTTP primitives for the shorts-wall host routes: JSON helpers,
 * proxy-host allowlisting, and egress selection. Request trust fencing lives
 * on the composition's `connection` service (`requestRejection`), consumed in
 * the plugin entry.
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
  /** dsh ≥0.2.1 trust fence: Host/Origin check plus browser auth. */
  connection: { requestRejection(req: IncomingMessage): number | undefined };
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
 * WSL setups commonly export one pointing at a local clash/v2ray exit
 * (HTTP or SOCKS5 — `socks5://` resolves DNS on the proxy side).
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
    if (
      typeof value === "string" &&
      (value.startsWith("http://") ||
        value.startsWith("socks5://") ||
        value.startsWith("socks5h://"))
    ) {
      return value;
    }
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
  return proxyUrl !== undefined ? createProxyFetch(proxyUrl, 60_000) : undefined;
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
