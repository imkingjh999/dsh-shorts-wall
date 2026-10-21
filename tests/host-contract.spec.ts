import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as hostEntry from "../src/index.ts";

/**
 * dsh 0.2.1 compatibility contract: the removed `webRuntime` service must
 * never come back as an inject (the plugin would sit pending forever), and
 * the built host bundle must carry the `connection` fence so a stale lib/
 * cannot ship unnoticed.
 */
describe("dsh >=0.2.1 host contract", () => {
  it("injects webServer + connection, never the removed webRuntime", () => {
    expect(hostEntry.inject).toEqual(["webServer", "connection"]);
  });

  it("built lib/index.js uses requestRejection and drops webRuntime", () => {
    const built = readFileSync(join(import.meta.dirname, "../lib/index.js"), "utf8");
    expect(built).toContain("requestRejection");
    expect(built).not.toContain("webRuntime");
  });
});
