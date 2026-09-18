/*
 * Monta o pacote.zip que vai para o servidor por FTP.
 *
 * Existe porque o servidor não compila: o build precisa de ~2,2 GB de memória
 * e a máquina da Central não tem. Compila-se aqui, envia-se o resultado.
 *
 * Escreve o ZIP à mão, com zlib do próprio Node, por dois motivos:
 *
 * 1. Nenhuma dependência. O resto do projeto segue essa regra e não há razão
 *    para abrir exceção num script de empacotamento.
 *
 * 2. SEPARADOR DE CAMINHO. O `Compress-Archive` do PowerShell grava os nomes
 *    com barra invertida (`.output\server\index.mjs`). No Linux, boa parte dos
 *    descompactadores trata a barra invertida como parte do NOME do arquivo —
 *    o resultado é uma pasta cheia de arquivos de nome esquisito em vez da
 *    árvore de diretórios, e o servidor não sobe. Aqui o nome de cada entrada
 *    é montado com barra normal, por construção.
 *
 * USO, na pasta do projeto, depois de `npm run build`:
 *
 *   node ferramentas/empacotar.mjs
 *
 * O que entra, na RAIZ do zip, sem pasta a mais por fora:
 *
 *   .output/       a aplicação compilada
 *   ferramentas/   backup, redefinir senha, e este script
 *   OPERACAO.md    o manual do TI
 *
 * O que NÃO entra, e o motivo de cada um:
 *
 *   node_modules/  o .output/ é autossuficiente; não precisa
 *   src/           código-fonte não vai para servidor de produção
 *   dados/         JAMAIS. Já levou uma conta de teste de uma máquina para o
 *                  servidor uma vez. O banco do servidor é do servidor.
 *   .env           segredos não viajam em zip
 */
import { createWriteStream, readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";
import { deflateRawSync, crc32 } from "node:zlib";

const RAIZ = resolve(process.cwd());
const DESTINO = join(RAIZ, "pacote.zip");

const ENTRADAS = [
  { caminho: ".output", tipo: "pasta" },
  { caminho: "ferramentas", tipo: "pasta" },
  { caminho: "OPERACAO.md", tipo: "arquivo" },
];

/* Nomes de arquivo que não podem entrar, por mais que estejam nas pastas acima. */
const PROIBIDOS = new Set([".env", ".env.local", ".DS_Store"]);

function listar(dir) {
  const achados = [];
  for (const nome of readdirSync(dir)) {
    const completo = join(dir, nome);
    if (statSync(completo).isDirectory()) achados.push(...listar(completo));
    else if (!PROIBIDOS.has(nome)) achados.push(completo);
  }
  return achados;
}

/*
 * Data e hora no formato do MS-DOS, que é o que o ZIP guarda: 16 bits para a
 * data e 16 para a hora, com o ano contado a partir de 1980 e os segundos em
 * passos de 2. Formato antigo, mas é o que a especificação pede.
 */
function dataDos(d) {
  const data = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  return { data, hora };
}

function main() {
  for (const e of ENTRADAS) {
    if (!existsSync(join(RAIZ, e.caminho))) {
      console.error(`Não encontrei ${e.caminho} em ${RAIZ}.`);
      if (e.caminho === ".output") {
        console.error("Rode `npm run build` antes — é ele que gera essa pasta.");
      }
      process.exit(1);
    }
  }

  const arquivos = [];
  for (const e of ENTRADAS) {
    const completo = join(RAIZ, e.caminho);
    if (e.tipo === "pasta") arquivos.push(...listar(completo));
    else arquivos.push(completo);
  }

  const locais = [];
  const central = [];
  let deslocamento = 0;

  for (const completo of arquivos) {
    // A barra normal entra aqui, e é o ponto inteiro deste script.
    const nome = relative(RAIZ, completo).split(sep).join("/");
    const conteudo = readFileSync(completo);
    const comprimido = deflateRawSync(conteudo, { level: 9 });
    const soma = crc32(conteudo);
    const { data, hora } = dataDos(statSync(completo).mtime);
    const nomeBytes = Buffer.from(nome, "utf8");

    const cabecalhoLocal = Buffer.alloc(30);
    cabecalhoLocal.writeUInt32LE(0x04034b50, 0); // assinatura
    cabecalhoLocal.writeUInt16LE(20, 4); // versão necessária
    cabecalhoLocal.writeUInt16LE(0x0800, 6); // nome em UTF-8
    cabecalhoLocal.writeUInt16LE(8, 8); // método: deflate
    cabecalhoLocal.writeUInt16LE(hora, 10);
    cabecalhoLocal.writeUInt16LE(data, 12);
    cabecalhoLocal.writeUInt32LE(soma, 14);
    cabecalhoLocal.writeUInt32LE(comprimido.length, 18);
    cabecalhoLocal.writeUInt32LE(conteudo.length, 22);
    cabecalhoLocal.writeUInt16LE(nomeBytes.length, 26);
    cabecalhoLocal.writeUInt16LE(0, 28); // sem campo extra

    locais.push(cabecalhoLocal, nomeBytes, comprimido);

    const cabecalhoCentral = Buffer.alloc(46);
    cabecalhoCentral.writeUInt32LE(0x02014b50, 0);
    cabecalhoCentral.writeUInt16LE(20, 4); // versão de quem gravou
    cabecalhoCentral.writeUInt16LE(20, 6); // versão necessária
    cabecalhoCentral.writeUInt16LE(0x0800, 8);
    cabecalhoCentral.writeUInt16LE(8, 10);
    cabecalhoCentral.writeUInt16LE(hora, 12);
    cabecalhoCentral.writeUInt16LE(data, 14);
    cabecalhoCentral.writeUInt32LE(soma, 16);
    cabecalhoCentral.writeUInt32LE(comprimido.length, 20);
    cabecalhoCentral.writeUInt32LE(conteudo.length, 24);
    cabecalhoCentral.writeUInt16LE(nomeBytes.length, 28);
    cabecalhoCentral.writeUInt32LE(0o644 << 16, 38); // permissões, para o Linux
    cabecalhoCentral.writeUInt32LE(deslocamento, 42);

    central.push(cabecalhoCentral, nomeBytes);
    deslocamento += cabecalhoLocal.length + nomeBytes.length + comprimido.length;
  }

  const corpoCentral = Buffer.concat(central);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(corpoCentral.length, 12);
  fim.writeUInt32LE(deslocamento, 16);

  const saida = createWriteStream(DESTINO);
  for (const parte of locais) saida.write(parte);
  saida.write(corpoCentral);
  saida.write(fim);
  saida.end();

  saida.on("close", () => {
    const tamanho = statSync(DESTINO).size;
    console.log(`Pacote gravado: ${DESTINO}`);
    console.log(`Arquivos: ${arquivos.length}`);
    console.log(`Tamanho: ${(tamanho / 1024 / 1024).toFixed(2)} MB`);
    console.log("");
    console.log("Na raiz do zip: .output/  ferramentas/  OPERACAO.md");
    console.log("Envie por FTP e extraia na pasta do serviço. Não precisa de npm lá.");
  });
}

main();
