/**
 * Headless smoke test of the built client bundle: executes lib/client.js in
 * the module-loader closure shape with shimmed globals, drives apply()
 * through a stub runtime-inject context, and server-renders the registered
 * tab component (initial loading state; then with items + streams).
 */
import { createRequire } from "node:module";
const PNPM = "/Users/dev/projects/deepseek-harness/node_modules/.pnpm/";
const reactRequire = createRequire(`${PNPM}react@18.3.1/node_modules/react/index.js`);
const React = reactRequire("react");
const { renderToString } = createRequire(
  `${PNPM}react-dom@18.3.1_react@18.3.1/node_modules/react-dom/server.js`,
)("react-dom/server");
const jsxRuntime = reactRequire("react/jsx-runtime");

globalThis.window = globalThis;
globalThis.document = {
  createElement: () => ({
    style: {},
    dataset: {},
    setAttribute() {},
    remove() {},
    appendChild() {},
  }),
  head: { appendChild() {} },
  body: { appendChild() {} },
};

const reactDomClient = {
  createRoot: () => ({ render: () => undefined, unmount: () => undefined }),
};
let registration = null;
const loaded = [];
globalThis.__ModuleLoader__ = {
  load({ id, factory }) {
    loaded.push(id);
    const require = (spec) => {
      if (spec === "react") return React;
      if (spec === "react/jsx-runtime") return jsxRuntime;
      if (spec === "react-dom/client") return reactDomClient;
      throw new Error(`unexpected require "${spec}"`);
    };
    const exports = factory(require);
    globalThis.__loadedExports = globalThis.__loadedExports ?? {};
    globalThis.__loadedExports[id] = exports;
  },
};

await import("../lib/client.js");

const id = loaded[0];
const exports = globalThis.__loadedExports[id];
process.stdout.write(`registered bundle id: ${id}\n`);
if (id !== "dsh-shorts-wall") throw new Error("bundle id mismatch");
if (exports.inject !== undefined)
  throw new Error("static inject must not be declared (hard dependency would fail the whole boot)");

const makeCtx = (effects) => ({
  effect(fn) {
    const d = fn();
    effects.push(d);
    return () => d();
  },
  inject(deps, callback) {
    if (JSON.stringify(deps) === JSON.stringify(["locale"])) return { dispose() {} }; // locale child fiber: dormant in tests
    if (JSON.stringify(deps) !== JSON.stringify(["betterSidebar"]))
      throw new Error(`unexpected inject deps ${JSON.stringify(deps)}`);
    const sctx = {
      effect(fn) {
        const d = fn();
        effects.push(d);
        return () => d();
      },
      betterSidebar: {
        registerTab(descriptor) {
          if (registration !== null) throw new Error("registerTab called twice");
          registration = descriptor;
          return () => {
            registration = null;
          };
        },
      },
    };
    callback(sctx);
    return { dispose() {} };
  },
});

const effects = [];
// Floating-window era: apply mounts the window host on document.body (the
// stubbed document supports appendChild). betterSidebar is no longer used.
exports.apply(makeCtx(effects));
process.stdout.write("apply mounted floating window path ✓\n");

// Render assertions live in e2e-client.mjs (real createRoot + jsdom): the
// floating window mounts through DOM APIs the stub here doesn't fully own.
for (const d of effects) d();
process.stdout.write("SMOKE TEST PASSED\n");
