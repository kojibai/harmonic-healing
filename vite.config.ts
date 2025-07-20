import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import nodePolyfills from "rollup-plugin-polyfill-node";
import { NodeGlobalsPolyfillPlugin } from "@esbuild-plugins/node-globals-polyfill";
import { NodeModulesPolyfillPlugin } from "@esbuild-plugins/node-modules-polyfill";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      buffer: "buffer/",
      process: "process/browser",
      util: "util/",
      stream: "stream-browserify",
      crypto: "crypto-browserify",
      assert: "assert/",
      zlib: "browserify-zlib",
    },
  },
  optimizeDeps: {
    exclude: ["buffer"], // Exclude buffer to avoid conflicts
    esbuildOptions: {
      define: {
        global: "globalThis",
      },
      plugins: [
        NodeGlobalsPolyfillPlugin({
          buffer: true,
          process: true,
        }),
        NodeModulesPolyfillPlugin(),
      ],
    },
    include: [
      "process",
      "util",
      "stream-browserify",
      "crypto-browserify",
      "assert",
      "browserify-zlib",
    ],
  },
  build: {
    rollupOptions: {
      plugins: [nodePolyfills()],
    },
  },
  assetsInclude: ["**/*.wasm"],
  worker: {
    format: "es", // Required for using `?worker` syntax in imports
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name].js`,
      },
    },
  },
  server: {
    host: true, // Listen on all interfaces (0.0.0.0)
    port: 80,   // Serve on port 80 for default access
  },
});
