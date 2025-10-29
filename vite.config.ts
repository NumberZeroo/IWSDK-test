import { optimizeGLTF } from "@iwsdk/vite-plugin-gltf-optimizer";
import { injectIWER } from "@iwsdk/vite-plugin-iwer";
import { discoverComponents, generateGLXF } from "@iwsdk/vite-plugin-metaspatial";
import { compileUIKit } from "@iwsdk/vite-plugin-uikitml";
import { defineConfig } from "vite";
import mkcert from "vite-plugin-mkcert";
import type { ServerOptions } from "https";

export default defineConfig({
  plugins: [
    mkcert(), // abilita cert/key dev
    injectIWER({
      device: "metaQuest3",
      activation: "always", //Da mettere localhost
      verbose: true,
    }),
    discoverComponents({
      outputDir: "metaspatial/components",
      include: /\.(js|ts|jsx|tsx)$/,
      exclude: /node_modules/,
      verbose: false,
    }),
    generateGLXF({
      metaSpatialDir: "metaspatial",
      outputDir: "public/glxf",
      verbose: false,
      enableWatcher: true,
    }),
    compileUIKit({ sourceDir: "ui", outputDir: "public/ui", verbose: true }),
    optimizeGLTF({ level: "medium" }),
  ],
  server: {
    host: "0.0.0.0",
    port: 8081,
    open: true,
    https: {} as ServerOptions,
    proxy: {
      // tutte le chiamate a /api/* verranno inoltrate a Flask
      "/api": {
        target: "http://172.19.186.119:5000", // indirizzo del server Flask da modificare se necessario
        changeOrigin: true,
        // rimuove il prefisso /api prima di inoltrare
        rewrite: (path) => path.replace(/^\/api/, ""),
        // secure è utile solo se il target è https self-signed; qui è http ma lasciarlo non fa danni
        secure: false,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: process.env.NODE_ENV !== "production",
    target: "esnext",
    rollupOptions: { input: "./index.html" },
  },
  esbuild: { target: "esnext" },
  optimizeDeps: {
    exclude: ["@babylonjs/havok"],
    esbuildOptions: { target: "esnext" },
  },
  publicDir: "public",
  base: "./",
});
