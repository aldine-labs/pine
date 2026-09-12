import { defineConfig } from "vite";

// Keep Electron runtime modules out of the production bundle. Electron Forge
// derives its default externals from the build host, which may not recognize
// prefix-only Node modules that are available in Electron's newer Node runtime.
export default defineConfig({
  build: {
    rollupOptions: {
      external: ["node:sqlite"],
    },
  },
});
