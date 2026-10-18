import { defineConfig } from 'vite';

// Keep the native SQLite package outside the main-process bundle. Its platform
// binding is shipped in node_modules/better-sqlite3/prebuilds and must resolve
// relative to the package, not the generated .vite/build directory.
export default defineConfig({
  build: {
    rollupOptions: {
      external: ['better-sqlite3'],
    },
  },
});
