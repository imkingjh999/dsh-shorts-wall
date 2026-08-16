/**
 * tsdown build for dsh-shorts-wall:
 *
 * - the host half: lib/index.js (ESM node) — the /bilibili JSON API + media
 *   proxy routes;
 * - two browser client bundles (lib/client.js and lib/client-registry.js,
 *   CJS closure factory), one per install channel:
 *   - `lib/client.js` serves the official profile channel, registering with
 *     the package-name id `dsh-shorts-wall`;
 *   - `lib/client-registry.js` serves the plugin-registry channel
 *     (dsh.plugin.json), registering with the manifest id
 *     `dsh-external/dsh-shorts-wall`.
 *
 * Both client bundles replicate the official DSH client-bundle preset:
 * externals resolve through the loader module table at runtime (react +
 * cordis + platform modules), everything else is inlined, and each artifact
 * registers itself via window.__ModuleLoader__.load({ id, factory }) with
 * the (require) => exports CJS closure shape.
 */
import { builtinModules } from "node:module";
import type { UserConfig } from "tsdown";

/** Node builtins must never survive into the browser module-loader factory. */
const NODE_BUILTINS = new Set([...builtinModules, ...builtinModules.map((id) => `node:${id}`)]);

/** Module specifiers the web shell shares into the frozen module table. */
const CLIENT_EXTERNALS = [
  "react",
  "react/jsx-runtime",
  "react-dom",
  "react-dom/client",
  "cordis",
  "@deepseek-ai/dsh-client-ui-slots",
  "@deepseek-ai/dsh-client-web-react",
  "@deepseek-ai/dsh-client-ui-primitives",
  "@deepseek-ai/dsh-client-schema-form",
  "@deepseek-ai/dsh-client-runtime/client",
];

/** One client bundle build for a plugin id (see the file doc). */
function clientBundle(pluginId: string, entryFile: string): UserConfig {
  return {
    entry: { client: "src/client/index.tsx" },
    outDir: "lib",
    format: "cjs",
    platform: "browser",
    dts: false,
    sourcemap: true,
    clean: false,
    external: [...CLIENT_EXTERNALS],
    define: {
      "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production"),
      "import.meta.env.MODE": JSON.stringify(process.env.NODE_ENV ?? "production"),
      "import.meta.env": JSON.stringify({
        MODE: process.env.NODE_ENV ?? "production",
      }),
      "import.meta.resolve": "undefined",
    },
    inputOptions: {
      resolve: {
        conditionNames: ["browser", "import", "require", "default"],
      },
    },
    noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
    plugins: [
      {
        name: "dsh-client-bundle-purity",
        resolveId(source: string) {
          if (NODE_BUILTINS.has(source)) {
            throw new Error(
              `client bundle purity: Node builtin "${source}" cannot run in the browser module table`,
            );
          }
          if (source.startsWith("@deepseek-ai/") && !CLIENT_EXTERNALS.includes(source)) {
            throw new Error(
              `client bundle purity: "${source}" is not a platform module — ` +
                "cross-plugin value imports are forbidden; collaborate through cordis services",
            );
          }
          return null;
        },
      },
    ],
    outputOptions: {
      entryFileNames: entryFile,
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(pluginId)}, factory: (require) => {`,
      footer: `return module.exports; } });`,
      intro: "var module = { exports: {} }; var exports = module.exports;",
      codeSplitting: false,
    },
  };
}

export default [
  {
    entry: { index: "src/index.ts" },
    outDir: "lib",
    format: ["esm"],
    platform: "node",
    target: "es2024",
    dts: false,
    clean: false,
    fixedExtension: false,
  },
  // Official profile channel: bundle id = package name.
  clientBundle("dsh-shorts-wall", "client.js"),
  // Plugin-registry channel: bundle id = manifest id (dsh.plugin.json).
  clientBundle("dsh-external/dsh-shorts-wall", "client-registry.js"),
] satisfies UserConfig[];
