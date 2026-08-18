import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.spec.ts"],
  },
  resolve: {
    // The spec files import src/ directly, and src/client/shell.tsx imports
    // the sibling dsh-float-window source package, whose own react import
    // would otherwise resolve against the parent workspace's separate react
    // install — two physical React copies → "Invalid hook call". Dedupe
    // pins every react resolution to this package's copy.
    dedupe: ["react", "react-dom"],
  },
});
