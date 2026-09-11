// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
  tanstackStart: {
    server: { entry: "server" },
  },

  /*
   * Alvo do build: servidor Node, não Cloudflare Workers.
   *
   * O padrão do wrapper é `cloudflare-module`, e o Workers não é Node — não tem
   * sistema de arquivos nem `node:sqlite`, que é onde o banco desta aplicação
   * vive. O app roda num servidor da própria Central, então o alvo certo é o
   * genérico de Node.
   *
   * O resultado do build vira `.output/server/index.mjs`, que se executa com
   * `node .output/server/index.mjs` e escuta na porta de PORT.
   */
  nitro: {
    preset: "node-server",
  },
});
