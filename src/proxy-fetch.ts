/**
 * Optional proxy tunnel for the host-side page fetches: HTTP CONNECT or
 * SOCKS5.
 *
 * Rationale: bilibili APIs are reachable directly, but the YouTube search
 * page (and any future source) may need a personal VPN/clash egress on
 * mainland networks — free public proxies do NOT work (datacenter IPs are
 * themselves blocked). This module turns `http://host:port` or
 * `socks5://host:port` into a fetch-like function so feed scraping can
 * egress through it while media streaming stays direct. Only https targets
 * are tunneled; http falls back to a direct fetch. SOCKS5 requests carry the
 * target hostname (ATYP domain) so DNS resolves on the proxy side — local
 * DNS poisoning cannot redirect the tunnel.
 */
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";

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
  /** Marker distinguishing tunneled (buffered) responses from fetch Responses. */
  readonly tunnel: true;
}

/** Whether a response object came from {@link createProxyFetch} (buffered body, no stream). */
export function isTunnelResponse(response: unknown): response is TunnelResponse {
  return (
    typeof response === "object" &&
    response !== null &&
    (response as { tunnel?: unknown }).tunnel === true
  );
}

const REDIRECT_LIMIT = 5;

/** SOCKS5 greeting: VER 5, one auth method, NO AUTHENTICATION. */
export const SOCKS5_GREETING = Buffer.from(new Uint8Array([0x05, 0x01, 0x00]));

/**
 * Build a SOCKS5 CONNECT request frame for a target hostname (ATYP
 * domain-name, so the proxy resolves DNS). Exported for the unit spec.
 */
export function socks5ConnectFrame(host: string, port: number): Buffer {
  const name = new Uint8Array(Buffer.from(host));
  if (name.length > 255) throw new Error("socks5: target hostname too long");
  const frame = new Uint8Array(7 + name.length);
  frame[0] = 0x05; // VER
  frame[1] = 0x01; // CMD CONNECT
  frame[2] = 0x00; // RSV
  frame[3] = 0x03; // ATYP domain-name
  frame[4] = name.length;
  frame.set(name, 5);
  const at = 5 + name.length;
  frame[at] = (port >> 8) & 0xff;
  frame[at + 1] = port & 0xff;
  return Buffer.from(frame);
}

/** Skip a SOCKS5 reply's bound-address field: 4 bytes of the matched tail. */
export function socks5ReplyRemainder(reply: Buffer): Buffer | undefined {
  if (reply.length < 4 || reply[0] !== 0x05) return undefined;
  const atyp = reply[3];
  if (atyp === undefined) return undefined;
  if (atyp === 0x01) return reply.subarray(8);
  if (atyp === 0x04) return reply.subarray(20);
  if (atyp !== 0x03) return undefined;
  const nameLen = reply[4];
  if (nameLen === undefined) return undefined;
  return reply.subarray(5 + nameLen);
}

/** Number of bytes the SOCKS5 reply head occupies before/including the port. */
function socksReplyNeeds(reply: Buffer): number {
  const atyp = reply[3];
  if (atyp === 0x01) return 4 + 4 + 2;
  if (atyp === 0x04) return 4 + 16 + 2;
  // domain: need byte 4 (name length) first
  if (reply.length < 5) return 5;
  return 5 + (reply[4] ?? 0) + 2;
}

/**
 * SOCKS5 CONNECT tunnel (no-auth, remote DNS). Resolves with a raw socket
 * spliced to the target; rejects on handshake/transport failure.
 */
function socksConnect(
  proxyUrl: URL,
  targetUrl: URL,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<Socket> {
  const proxyPort = proxyUrl.port !== "" ? Number(proxyUrl.port) : 1080;
  const targetPort = targetUrl.port === "" ? 443 : Number(targetUrl.port);
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: proxyUrl.hostname, port: proxyPort });
    socket.setTimeout(timeoutMs);
    const fail = (error: unknown): void => {
      socket.destroy();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const onAbort = (): void => fail(new Error("aborted"));
    signal?.addEventListener("abort", onAbort, { once: true });
    socket.on("timeout", () => fail(new Error("proxy connect timeout")));
    socket.on("error", fail);
    let stage: "greeted" | "requested" = "greeted";
    const reader = (): void => {
      const reply = socket.read();
      if (reply === null) return;
      if (stage === "greeted") {
        if (reply.length < 2 || reply[0] !== 0x05 || reply[1] !== 0x00) {
          fail(new Error(`socks5: unacceptable auth methods (reply ${reply.subarray(0, 2).toString("hex")})`));
          return;
        }
        stage = "requested";
        socket.write(new Uint8Array(socks5ConnectFrame(targetUrl.hostname, targetPort)));
        return;
      }
      // reply stage: need VER REP RSV ATYP [+ addr] + port
      if (reply.length < 4 || reply[0] !== 0x05) {
        fail(new Error("socks5: malformed reply"));
        return;
      }
      if (reply[1] !== 0x00) {
        fail(new Error(`socks5: connect rejected (code 0x${reply[1].toString(16)})`));
        return;
      }
      const need = socksReplyNeeds(reply);
      if (reply.length < need) {
        // wait for the rest of the frame (rare: server flushed early)
        socket.unshift(new Uint8Array(reply));
        socket.once("readable", () => {
          const full = socket.read();
          if (full !== null && full.length >= need && full[1] === 0x00) {
            signal?.removeEventListener("abort", onAbort);
            socket.setTimeout(0);
            socket.removeAllListeners("readable");
            // whatever follows the bound addr belongs to the target stream
            const rest = full.subarray(need);
            socket.unshift(new Uint8Array(rest));
            resolve(socket);
          } else if (full !== null && full.length >= 4) {
            fail(new Error(`socks5: connect rejected (code 0x${full[1].toString(16)})`));
          }
        });
        return;
      }
      signal?.removeEventListener("abort", onAbort);
      socket.setTimeout(0);
      socket.removeAllListeners("readable");
      const rest = reply.subarray(need);
      socket.unshift(new Uint8Array(rest));
      resolve(socket);
    };
    socket.on("readable", reader);
    socket.on("connect", () => socket.write(new Uint8Array(SOCKS5_GREETING)));
  });
}

/** HTTP CONNECT tunnel. Resolves with a raw socket spliced to the target. */
function httpConnect(
  proxyUrl: URL,
  targetUrl: URL,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<Socket> {
  const proxyPort = proxyUrl.port !== "" ? Number(proxyUrl.port) : 80;
  return new Promise((resolve, reject) => {
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
      signal?.removeEventListener("abort", onAbort);
      resolve(socket as unknown as Socket);
    });
    req.end();
  });
}

/** One tunneled https request (no redirect handling). */
function tunnelOnce(
  proxyUrl: URL,
  targetUrl: URL,
  headers: Record<string, string>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<TunnelResponse> {
  const open =
    proxyUrl.protocol === "socks5:" || proxyUrl.protocol === "socks5h:"
      ? socksConnect
      : httpConnect;
  return open(proxyUrl, targetUrl, timeoutMs, signal).then(
    (socket) =>
      new Promise<TunnelResponse>((resolve, reject) => {
        const fail = (error: unknown): void => {
          socket.destroy();
          reject(error instanceof Error ? error : new Error(String(error)));
        };
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
                tunnel: true,
                headers: {
                  get: (name) => headerRecord[name.toLowerCase()] ?? null,
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
      }),
  );
}

/**
 * Build a fetch-like function egressing https requests through an HTTP
 * CONNECT or SOCKS5 proxy (manual/follow redirects supported). Non-https
 * targets fall back to a direct fetch and return the plain Response.
 */
export function createProxyFetch(
  proxyUrlRaw: string,
  timeoutMs: number,
): (url: string, init?: TunnelInit) => Promise<TunnelResponse | Response> {
  const proxyUrl = new URL(proxyUrlRaw);
  if (
    proxyUrl.protocol !== "http:" &&
    proxyUrl.protocol !== "socks5:" &&
    proxyUrl.protocol !== "socks5h:"
  ) {
    throw new Error(`proxy: unsupported scheme ${proxyUrl.protocol}`);
  }
  return async (url, init = {}) => {
    let target = new URL(url);
    const redirect = init.redirect ?? "follow";
    if (target.protocol !== "https:") {
      return fetch(url, {
        headers: init.headers,
        redirect,
        signal: init.signal,
      });
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
