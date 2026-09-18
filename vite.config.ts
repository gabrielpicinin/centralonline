// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

/*
 * Opções do Nitro, separadas aqui por causa de um descompasso de tipos.
 *
 * `preset` escolhe o alvo do build; `plugins` registra código que roda na
 * SUBIDA do servidor — antes de a porta abrir. Esse segundo ponto é o que
 * importa: todo o resto deste projeto carrega por demanda (a entrada de SSR
 * entra por `defineLazyEventHandler`, e o banco só é importado quando alguém
 * chama uma função de servidor), então uma variável de ambiente faltando não
 * derrubava a subida — derrubava a primeira pessoa a usar o sistema. Ver
 * src/nitro/conferir-ambiente.ts.
 *
 * O `as` não esconde erro nenhum: o tipo publicado pelo wrapper declara apenas
 * `preset`, `output` e `cloudflare`, mas em tempo de execução ele repassa o
 * objeto inteiro ao Nitro — `{ defaultPreset: ..., ...userNitroOpts }`, em
 * node_modules/@lovable.dev/vite-tanstack-config/dist/index.js. `plugins` é
 * opção legítima do Nitro e chega lá. O tipo é que está mais estreito que o
 * comportamento, e a afirmação abaixo diz só isso.
 */
const opcoesNitro = {
  /*
   * Alvo do build: servidor Node, não Cloudflare Workers.
   *
   * O padrão do wrapper é `cloudflare-module`, e o Workers não é Node — não
   * tem sistema de arquivos nem `node:sqlite`, que é onde o banco desta
   * aplicação vive. O app roda num servidor da própria Central, então o alvo
   * certo é o genérico de Node.
   *
   * O resultado do build vira `.output/server/index.mjs`, que se executa com
   * `node .output/server/index.mjs` e escuta na porta de PORT.
   */
  preset: "node-server",
  plugins: ["src/nitro/conferir-ambiente.ts"],
} as { preset: string };

export default defineConfig({
  // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
  tanstackStart: {
    server: { entry: "server" },
  },

  vite: {
    server: {
      /*
       * O servidor de desenvolvimento escuta SÓ no computador local.
       *
       * O padrão do wrapper é `::`, que é toda interface — e num servidor com
       * Apache na frente isso significa que a aplicação fica alcançável
       * direto, pela rede inteira, contornando o proxy e o HTTPS que o proxy
       * um dia vai terminar. Foi o que aconteceu: `npm run dev` exposto em
       * 0.0.0.0:8080 na rede interna.
       *
       * Escutar em toda interface é uma decisão de quem implanta, não um
       * padrão que se herda sem perceber. Aqui o padrão passa a ser o seguro;
       * quem precisar do contrário troca este valor conscientemente.
       *
       * Vale só para `npm run dev`. O servidor compilado não passa por aqui —
       * lá a interface vem de HOST/NITRO_HOST, e o padrão do Nitro continua
       * sendo toda interface. Ver OPERACAO.md.
       */
      host: "127.0.0.1",

      /*
       * O domínio interno, aceito pelo servidor de desenvolvimento.
       *
       * O Vite libera por padrão `localhost`, subdomínios de `.localhost` e
       * endereços IP — nada mais. Por isso `http://fin.central.online/`
       * responde "Blocked request. This host is not allowed": o nome não está
       * na lista, e a checagem existe justamente para isso.
       *
       * O nome vai literal, e NÃO `true`. A documentação do Vite marca `true`
       * como perigoso porque abre caminho a DNS rebinding — nas palavras dela,
       * "allows any website to send requests to your dev server (...) allowing
       * them to download your source code and content". Num servidor que
       * guarda dados financeiros, trocar uma linha de configuração por isso é
       * um mau negócio.
       *
       * ESTA LINHA É TEMPORÁRIA. Ela só tem efeito em `npm run dev`; o
       * servidor compilado não sobe o Vite, e portanto nem lê isto. Ela existe
       * porque hoje o servidor está rodando o modo de desenvolvimento em
       * produção, que é o problema de verdade. Quando a implantação passar a
       * usar `npm run build` + `node .output/server/index.mjs`, esta linha
       * pode ser apagada sem substituir por nada.
       */
      allowedHosts: ["fin.central.online"],
    },
  },

  nitro: opcoesNitro,
});
