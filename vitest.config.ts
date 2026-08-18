import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    // dsh-float-window ships TypeScript source. Files resolved from inside
    // node_modules do not inherit this repo's tsconfig jsx setting, so pin
    // the automatic JSX runtime explicitly (otherwise Vite falls back to
    // React.createElement and FloatWindow throws "React is not defined").
    jsx: "automatic",
  },
  test: {
    environment: "node",
    include: ["tests/**/*.spec.ts"],
  },
  resolve: {
    // The spec files import src/ directly, and src/client/shell.tsx imports
    // the dsh-float-window source package (npm), whose own react import
    // resolves through its .pnpm peer directory — which can drift from this
    // package's copy if resolutions ever diverge → two physical React copies
    // → "Invalid hook call". Dedupe pins every react resolution to one copy.
    dedupe: ["react", "react-dom"],
  },
});
