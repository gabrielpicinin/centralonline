/*
 * O teste das duas chaves de meta — e da regra de que elas vêm dos DADOS.
 *
 * Angola não tem meta hoje e vai ter um dia; nesse dia, os blocos de meta têm
 * de aparecer sozinhos, sem mudança de código nem implantação. O Brasil tem
 * meta hoje e, se um dia vier sem, tem de se comportar igual. Por isso nada
 * aqui pergunta "qual é a base": as cargas são montadas com e sem as colunas,
 * e o que se confere é o que o dashboard desenharia com cada uma.
 *
 * O caminho é o inteiro: planilha em cp1252 → parser → banco → lerBase →
 * presença → blocos. É o mesmo que o envio e o dashboard percorrem.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Base } from "../src/lib/bases.ts";

/* Ver recorte.test.ts: a pasta do banco tem de existir antes do import. */
const PASTA = mkdtempSync(join(tmpdir(), "central-metas-"));
process.env.DADOS_DIR = PASTA;

type Banco = typeof import("../src/lib/banco.server.ts");
type Parsers = typeof import("../src/lib/parsers.ts");
type ModPresenca = typeof import("../src/lib/presenca.ts");
let banco: Banco;
let parsers: Parsers;
let presenca: ModPresenca;

before(async () => {
  banco = await import("../src/lib/banco.server.ts");
  parsers = await import("../src/lib/parsers.ts");
  presenca = await import("../src/lib/presenca.ts");
});

after(() => {
  banco.fechar();
  rmSync(PASTA, { recursive: true, force: true });
});

/*
 * Os blocos de cada grupo, escritos aqui por extenso. Se alguém tirar um bloco
 * da tabela de src/lib/presenca.ts, ou acrescentar um sem dizer a chave, o
 * primeiro teste avisa — a tabela é a resposta a "esqueci algum?".
 */
const GRUPO_A = [
  "cardMetaDeDizimos",
  "graficoDizimosVsMeta",
  "metaNosGraficosDiarios",
  "linhasDeMetaDaTabela",
] as const;
const GRUPO_B = ["secaoControleDeMetas", "filtroMeta"] as const;

/* ------------------------------------------------ montar uma planilha */

function cp1252(texto: string): Uint8Array {
  return new Uint8Array(
    [...texto].map((ch) => {
      const c = ch.charCodeAt(0);
      if (c > 0xff) throw new Error(`caractere fora do cp1252 no teste: ${ch}`);
      return c;
    }),
  );
}

const UNIDADES = ["Central Angola Sede", "Calumbiro", "Benguela"];

/**
 * Uma planilha na forma de Angola. `metasAnuais` são as colunas "Meta Anual
 * <unidade>" (nenhuma, se vazio); `meta` é o valor da coluna " Meta " de cada
 * lançamento — que existe sempre, como no arquivo real, preenchida ou não.
 */
async function planilhaDeAngola(opcoes: {
  metasAnuais?: Record<string, string>;
  meta?: (i: number) => string;
}) {
  const metasAnuais = opcoes.metasAnuais ?? {};
  const meta = opcoes.meta ?? (() => "");
  const colunas = [
    "Descrição CR. 1º Nível",
    "Descrição CR. 2º Nível",
    "Descrição Nat. 2º Nível",
    "Descrição Nat. 3º Nível",
    "Dt. Baixa",
    " Meta ",
    " Crédito ",
    " Débito ",
    " Crédito 2 ",
    " Débito 2 ",
    "Nro. Único Financeiro",
    ...Object.keys(metasAnuais),
  ];
  const linhas = UNIDADES.flatMap((unidade, u) =>
    [0, 1, 2, 3].map((i) => {
      const n = u * 4 + i;
      // Metade dízimo (crédito), metade despesa (débito), como na planilha real.
      const despesa = i % 2 === 1;
      return [
        "Central Angola",
        unidade,
        despesa ? "Custos Operacionais" : "Dízimos e Ofertas",
        despesa ? "Energia" : "PIX",
        `${String(n + 1).padStart(2, "0")}/0${(n % 9) + 1}/2026`,
        despesa ? meta(n) : "",
        despesa ? "0,00" : "1.000,00",
        despesa ? "250,00" : "0,00",
        despesa ? "0,00" : "1.000,00",
        despesa ? "250,00" : "0,00",
        `AO-${n}`,
        ...Object.values(metasAnuais),
      ];
    }),
  );
  const texto = [colunas, ...linhas].map((l) => l.join(";")).join("\r\n");
  return parsers.parseFile(new File([cp1252(texto)], "FINANCEIRO ANGOLA.csv"));
}

const METAS_ANUAIS = {
  "Meta Anual Central Angola Sede": "12.000.000,00",
  "Meta Anual Calumbiro": "3.000.000,00",
  "Meta Anual Benguela": "2.500.000,00",
  "Meta Anual Total Geral": "17.500.000,00",
};

/**
 * O que o envio faz, do parser ao banco — sem a tela. Devolve o aviso de
 * metas, para os testes conferirem que ele também obedece à regra.
 */
async function enviar(base: Base, brutas: Awaited<ReturnType<Parsers["parseFile"]>>) {
  const lida = parsers.normalizeFinancial(brutas, base);
  const carga = banco.iniciarCarga(base, ["FINANCEIRO.csv"], "Financeiro");
  banco.gravarLancamentos(carga, lida.rows);
  banco.gravarMetas(carga, lida.metaAnualPorUnidade, lida.metaAnualTotalGeral);
  banco.finalizarCarga(carga);
  return lida.unidadesSemMetaExata;
}

/** O que o dashboard desenharia: cada bloco, ligado ou não. */
function blocos(base: Base) {
  const p = banco.lerBase(base, null).presenca;
  return Object.fromEntries(
    [...GRUPO_A, ...GRUPO_B].map((b) => [b, presenca.desenha(p, b)]),
  ) as Record<(typeof GRUPO_A)[number] | (typeof GRUPO_B)[number], boolean>;
}

const todos = (mapa: Record<string, boolean>, grupo: readonly string[], valor: boolean) =>
  grupo.every((b) => mapa[b] === valor);

/* ------------------------------------------------------------- testes */

test("a tabela de blocos de meta é exatamente a dos dois grupos, cada um na sua chave", () => {
  assert.deepEqual(Object.keys(presenca.BLOCOS_DE_META).sort(), [...GRUPO_A, ...GRUPO_B].sort());
  for (const b of GRUPO_A) assert.equal(presenca.BLOCOS_DE_META[b], "metaDeDizimos", b);
  for (const b of GRUPO_B) assert.equal(presenca.BLOCOS_DE_META[b], "metasDeAplicacao", b);
});

test("carga sem colunas “Meta Anual” não desenha os blocos do grupo (A)", async () => {
  // A coluna " Meta " vem preenchida: as duas chaves são independentes.
  const aviso = await enviar("angola", await planilhaDeAngola({ meta: () => "Custeio" }));
  const b = blocos("angola");
  assert.ok(todos(b, GRUPO_A, false), `grupo (A) desenhado sem meta: ${JSON.stringify(b)}`);
  assert.ok(todos(b, GRUPO_B, true), "o grupo (B) não depende do (A)");
  assert.deepEqual(aviso, [], "sem meta nenhuma, não há aviso de unidade sem meta");
});

test("carga com a coluna “ Meta ” presente mas vazia em todas as linhas não desenha os blocos do grupo (B) — o caso de Angola hoje", async () => {
  // Vazia de verdade e "vazia" só com espaço: as duas contam como ausência.
  const aviso = await enviar(
    "angola",
    await planilhaDeAngola({
      metasAnuais: METAS_ANUAIS,
      meta: (i) => (i % 2 ? "   " : ""),
    }),
  );
  const b = blocos("angola");
  assert.ok(todos(b, GRUPO_B, false), `grupo (B) desenhado sem meta: ${JSON.stringify(b)}`);
  assert.ok(todos(b, GRUPO_A, true), "o grupo (A) não depende do (B)");
  assert.deepEqual(aviso, [], "todas as unidades têm coluna de meta com o nome exato");
});

test("a MESMA base, recarregada com as colunas preenchidas, passa a desenhar os dois grupos — sem nenhuma mudança de código", async () => {
  // Hoje: sem "Meta Anual" e com " Meta " vazia. Nada de meta na tela.
  await enviar("angola", await planilhaDeAngola({}));
  const hoje = blocos("angola");
  assert.ok(todos(hoje, GRUPO_A, false) && todos(hoje, GRUPO_B, false), JSON.stringify(hoje));

  // Um dia: a mesma base, a planilha com as colunas preenchidas.
  await enviar(
    "angola",
    await planilhaDeAngola({
      metasAnuais: METAS_ANUAIS,
      meta: (i) => ["Pessoal", "Custeio"][i % 2],
    }),
  );
  const depois = blocos("angola");
  assert.ok(
    todos(depois, GRUPO_A, true) && todos(depois, GRUPO_B, true),
    `a meta chegou e os blocos não ligaram: ${JSON.stringify(depois)}`,
  );
});

test("coluna “Meta Anual” presente mas vazia ou zerada conta como sem meta (A)", async () => {
  /*
   * A mesma pegadinha do (B): a coluna existir não basta. Vazia vira zero na
   * leitura, e zero desenharia "R$ 0,00" e "0%" como se fosse meta.
   */
  const vazias = Object.fromEntries(Object.keys(METAS_ANUAIS).map((k) => [k, ""]));
  await enviar("angola", await planilhaDeAngola({ metasAnuais: vazias }));
  assert.ok(todos(blocos("angola"), GRUPO_A, false));

  const zeradas = Object.fromEntries(Object.keys(METAS_ANUAIS).map((k) => [k, "0,00"]));
  await enviar("angola", await planilhaDeAngola({ metasAnuais: zeradas }));
  assert.ok(todos(blocos("angola"), GRUPO_A, false));
});

test("a presença é da carga, não do recorte: pastor de unidade sem meta continua vendo os blocos", async () => {
  /*
   * É o Brasil exatamente como hoje: uma unidade sem coluna de meta numa base
   * que tem meta mostra o card de meta — com zero, que é o que a planilha diz.
   * Desligar o bloco por unidade mudaria o dashboard de pastores que já usam.
   */
  const metas = { "Meta Anual Central Angola Sede": "12.000.000,00" };
  await enviar("angola", await planilhaDeAngola({ metasAnuais: metas, meta: () => "Custeio" }));
  const doPastor = banco.lerBase("angola", ["Benguela"]).presenca;
  assert.equal(doPastor.metaDeDizimos, true);
  assert.equal(doPastor.metasDeAplicacao, true);
  // E ele recebe só um sim ou não — nenhuma meta da outra unidade.
  assert.deepEqual(banco.lerBase("angola", ["Benguela"]).metaAnualPorUnidade, {});
});

test("sem arquivo de membresia, a carga diz que não tem membresia; com ele, que tem", async () => {
  await enviar("angola", await planilhaDeAngola({}));
  assert.equal(banco.lerBase("angola", null).presenca.membresia, false);

  const lida = parsers.normalizeFinancial(await planilhaDeAngola({}), "angola");
  const carga = banco.iniciarCarga("angola", ["FINANCEIRO.csv", "MEMBRESIA.csv"], "Financeiro");
  banco.gravarLancamentos(carga, lida.rows);
  banco.gravarMembresia(carga, [{ unidade: "Benguela", meses: { "jan/26": 120 } }]);
  banco.finalizarCarga(carga);
  assert.equal(banco.lerBase("angola", null).presenca.membresia, true);
});

test("base sem carga, ou pedido sem unidade, não desenha nada de meta", () => {
  assert.deepEqual(banco.lerBase("brasil", null).presenca, presenca.SEM_DADOS);
  assert.deepEqual(banco.lerBase("angola", []).presenca, presenca.SEM_DADOS);
});

test("espaço sozinho na coluna “ Meta ” é vazio — também em linha gravada por outro caminho", () => {
  /*
   * O parser já apara os espaços, mas a regra do banco não pode depender disso:
   * uma linha que tenha entrado por outro caminho — uma versão antiga, uma
   * correção à mão — com " " na coluna não pode ligar a Seção 4 sozinha.
   */
  const carga = banco.iniciarCarga("brasil", ["FINANCEIRO.csv"], "Financeiro");
  banco.gravarLancamentos(carga, [
    {
      unidade: "Central Sede",
      nat2: "Custos Operacionais",
      nat3: "Energia",
      nat4: "",
      razaoSocial: "",
      projeto: "",
      meta: "   ",
      credito: 0,
      credito1: 0,
      debito: 250,
      debito1: 250,
      data: null,
      dia: 1,
      mes: 1,
      ano: 2026,
      nroUnico: "BR-1",
    },
  ]);
  banco.finalizarCarga(carga);
  assert.equal(banco.lerBase("brasil", null).presenca.metasDeAplicacao, false);
});
