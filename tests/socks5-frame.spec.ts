import { describe, expect, it } from "vitest";
import {
  SOCKS5_GREETING,
  createProxyFetch,
  socks5ConnectFrame,
  socks5ReplyRemainder,
} from "../src/proxy-fetch.ts";

const u8 = (...bytes: number[]): Buffer => Buffer.from(new Uint8Array(bytes));

describe("socks5 frames", () => {
  it("greeting proposes NO AUTH only", () => {
    expect([...SOCKS5_GREETING]).toEqual([0x05, 0x01, 0x00]);
  });

  it("connect frame carries the hostname (remote DNS) and port", () => {
    const f = socks5ConnectFrame("www.youtube.com", 443);
    expect(f.length).toBe(7 + "www.youtube.com".length);
    expect(f[0]).toBe(0x05);
    expect(f[1]).toBe(0x01); // CONNECT
    expect(f[3]).toBe(0x03); // ATYP domain
    expect(f[4]).toBe("www.youtube.com".length);
    expect(f.subarray(5, 5 + (f[4] ?? 0)).toString()).toBe("www.youtube.com");
    const portAt = 5 + (f[4] ?? 0);
    expect((f[portAt] ?? 0) * 256 + (f[portAt + 1] ?? 0)).toBe(443);
  });

  it("rejects hostnames that cannot fit the one-byte length field", () => {
    expect(() => socks5ConnectFrame("a".repeat(256), 443)).toThrow();
  });

  it("skips the bound address of IPv4 / domain / IPv6 replies", () => {
    const v4 = u8(0x05, 0x00, 0x00, 0x01, 1, 2, 3, 4, 0x01, 0xbb);
    expect(socks5ReplyRemainder(v4)).toEqual(u8(0x01, 0xbb));
    const domain = Buffer.concat([
      u8(0x05, 0x00, 0x00, 0x03, 9),
      Buffer.from("localhost"),
      u8(0x00, 0x50),
    ]);
    expect(socks5ReplyRemainder(domain)).toEqual(u8(0x00, 0x50));
    const v6 = Buffer.concat([
      u8(0x05, 0x00, 0x00, 0x04),
      Buffer.from(new Uint8Array(16)),
      u8(0x01, 0xbb),
    ]);
    expect(socks5ReplyRemainder(v6)).toEqual(u8(0x01, 0xbb));
  });

  it("createProxyFetch rejects unsupported proxy schemes loudly", () => {
    expect(() => createProxyFetch("ftp://127.0.0.1:21", 1000)).toThrow(/unsupported scheme/);
  });
});
