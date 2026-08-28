import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig(({ command }) => {
  if (command === "serve") {
    return {
      root: ".",
      server: {
        open: "/demo/index.html",
        port: 5173,
      },
    };
  }

  return {
    build: {
      lib: {
        entry: resolve(__dirname, "src/index.ts"),
        name: "RetellChat",
        fileName: () => "retell-chat-widget.js",
        formats: ["iife"],
      },
      outDir: "dist",
      emptyOutDir: true,
      cssCodeSplit: false,
    },
  };
});
