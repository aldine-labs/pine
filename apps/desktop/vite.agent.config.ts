import { defineConfig } from "vite";

// Pi is ESM-only and relies on `import.meta.url`. Keep the isolated agent
// process and all of its chunks in ESM instead of emitting runtime `require()`
// calls or rewriting Pi's module metadata for CommonJS.
export default defineConfig({
  build: {
    lib: {
      entry: "src/agent.ts",
      fileName: () => "agent.mjs",
      formats: ["es"],
    },
    rollupOptions: {
      external: [
        "@anthropic-ai/sandbox-runtime",
        "@earendil-works/pi-ai",
        "@earendil-works/pi-coding-agent",
        "yaml",
        // This bundle runs in Electron's Node-enabled utility process. Vite's
        // browser externalization otherwise replaces Node built-ins with empty
        // shims (for example, AsyncLocalStorage becomes undefined).
        /^node:/,
      ],
      output: {
        chunkFileNames: "[name]-[hash].mjs",
      },
    },
  },
});
