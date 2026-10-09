/*
 * O que cada perfil vê — duas decisões da Central, de 09/10.
 *
 * 1. O pastor com TODAS as unidades de uma base vê os mesmos números do
 *    Financeiro: a base inteira, com as linhas de total, e a visão consolidada
 *    (Receita e Despesa Total sem Central Missionária e Central Social, o
 *    "Débito 2" das duas metas). Só os números — o papel continua de pastor.
 *    Com uma unidade a menos, ele continua pastor como sempre.
 *
 * 2. A Meta de Dízimo da Central Picos - Missões não entra em soma de unidades.
 *    Ela só conta dentro do Total Geral da planilha: para o Financeiro e quem
 *    vê todas as unidades, com todas (ou nenhuma) marcadas. Para o pastor que a
 *    tem, sozinha ou com outras, e para qualquer filtro de unidade, ela não
 *    conta.
 *
 * Os nomes das unidades são os reais; os valores são inventados — o
 * repositório é público.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Base } from "../src/lib/bases.ts";
import type { FinancialRow } from "../src/lib/parsers.ts";

/* Ver recorte.test.ts: a pasta do banco tem de existir antes do import. */
const PASTA = mkdtempSync(join(tmpdir(), "central-perfil-"));
process.env.DADOS_DIR = PASTA;

type Banco = typeof import("../src/lib/banco.server.ts");
type Parsers = typeof import("../src/lib/parsers.ts");
type Consolidado = typeof import("../src/lib/consolidado.ts");
let banco: Banco;
let parsers: Parsers;
let consolidado: Consolidado;
type Lida = ReturnType<Banco["lerBase"]>;

/* ------------------------------------------------------ a base de teste */

const PICOS = "Central Picos";
const MISSOES = "Central Picos - Missões";
const UNIDADES_BRASIL = [
  "Central Contagem",
  "Central Missionária",
  PICOS,
  MISSOES,
  "Central Social",
];

/** Crédito e débito de cada unidade — inventados, e diferentes entre si. */
const MOVIMENTO: Record<string, { credito: number; debito: number }> = {
  "Central Contagem": { credito: 5000, debito: 3000 },
  "Central Missionária": { credito: 2000, debito: 1500 },
  [PICOS]: { credito: 1000, debito: 600 },
  [MISSOES]: { credito: 300, debito: 200 },
  "Central Social": { credito: 700, debito: 900 },
};

function lancamentos(base: Base, unidades: string[]): FinancialRow[] {
  return unidades.map((unidade, i) => ({
    unidade,
    nat2: "Dízimos e Ofertas",
    nat3: "PIX",
    nat4: "Dízimo",
    razaoSocial: `P${i}`,
    projeto: "",
    meta: "",
    credito: MOVIMENTO[unidade]?.credito ?? 100,
    credito1: MOVIMENTO[unidade]?.credito ?? 100,
    debito: MOVIMENTO[unidade]?.debito ?? 50,
    debito1: MOVIMENTO[unidade]?.debito ?? 50,
    data: null,
    dia: 1,
    mes: 1,
    ano: 2026,
    nroUnico: `${base}:${unidade}`,
  }));
}

/*
 * As metas como a planilha real do Brasil as traz: a coluna da Central Picos -
 * Missões se chama "Central Picos - Missão", no singular, e vale zero; a "Meta
 * Anual Total Geral" é a soma das colunas.
 */
const METAS_DE_HOJE = {
  "Central Contagem": 1_000_000,
  "Central Missionária": 0,
  [PICOS]: 900_000,
  "Central Picos - Missão": 0,
};
const TOTAL_GERAL_DE_HOJE = 1_900_000;

/** Uma carga do Brasil, ativada no fim — como o servidor faz ao fim de um envio. */
function carregarBrasil(
  unidades: string[],
  metas: Record<string, number>,
  totalGeral: number,
): void {
  const carga = banco.iniciarCarga("brasil", ["FINANCEIRO.csv"], "Financeiro");
  banco.gravarLancamentos(carga, lancamentos("brasil", unidades));
  banco.gravarMembresia(carga, [
    { unidade: "Total Geral", meses: { "jan/26": 1000 } },
    { unidade: "Central Contagem", meses: { "jan/26": 600 } },
    { unidade: PICOS, meses: { "jan/26": 300 } },
    // Congregação sem lançamento: está no Total Geral, e não na financeira.
    { unidade: "Central Brumado", meses: { "jan/26": 100 } },
  ]);
  banco.gravarSaldos(
    carga,
    unidades.map((unidade) => ({ unidade, periodo: "Atual", quando: "atual" as const, saldo: 10 })),
  );
  banco.gravarMetas(carga, metas, totalGeral);
  banco.finalizarCarga(carga);
}

let todas: number;
let todasMaisOrfa: number;
let todasMenosUma: number;
let orfaNoLugar: number;
let semAcento: number;
let soMissoes: number;
let picosEMissoes: number;

before(async () => {
  banco = await import("../src/lib/banco.server.ts");
  parsers = await import("../src/lib/parsers.ts");
  consolidado = await import("../src/lib/consolidado.ts");

  const pastor = (usuario: string) =>
    banco.criarPerfil({ usuario, nome: usuario, papel: "pastor", senhaHash: "x" }).id;
  todas = pastor("todas@central.org");
  todasMaisOrfa = pastor("todas-mais-orfa@central.org");
  todasMenosUma = pastor("todas-menos-uma@central.org");
  orfaNoLugar = pastor("orfa-no-lugar@central.org");
  semAcento = pastor("sem-acento@central.org");
  soMissoes = pastor("so-missoes@central.org");
  picosEMissoes = pastor("picos-e-missoes@central.org");

  banco.salvarPermissoes([
    { perfilId: todas, base: "brasil", unidades: UNIDADES_BRASIL },
    // Uma unidade que saiu da base continua na permissão: é órfã, e não atrapalha.
    {
      perfilId: todasMaisOrfa,
      base: "brasil",
      unidades: [...UNIDADES_BRASIL, "Central Que Saiu"],
    },
    {
      perfilId: todasMenosUma,
      base: "brasil",
      unidades: UNIDADES_BRASIL.filter((u) => u !== "Central Social"),
    },
    // O mesmo número de nomes que a carga tem — uma órfã no lugar da Central Social.
    {
      perfilId: orfaNoLugar,
      base: "brasil",
      unidades: [...UNIDADES_BRASIL.filter((u) => u !== "Central Social"), "Central Que Saiu"],
    },
    // Todas, mas uma escrita sem acento: não é o nome que está na carga.
    {
      perfilId: semAcento,
      base: "brasil",
      unidades: UNIDADES_BRASIL.map((u) => (u === MISSOES ? "Central Picos - Missoes" : u)),
    },
    { perfilId: soMissoes, base: "brasil", unidades: [MISSOES] },
    { perfilId: picosEMissoes, base: "brasil", unidades: [PICOS, MISSOES] },
  ]);

  carregarBrasil(UNIDADES_BRASIL, METAS_DE_HOJE, TOTAL_GERAL_DE_HOJE);
});

after(() => {
  banco.fechar();
  rmSync(PASTA, { recursive: true, force: true });
});

/** O que um pastor recebe ao pedir uma base — o caminho do servidor, sem a tela. */
function oQueOPastorRecebe(perfilId: number, base: Base): Lida {
  return banco.lerBase(base, banco.unidadesDoPerfil(perfilId, base));
}

/*
 * Os dois cards de total da Seção 1, pela mesma regra que ela usa: na visão
 * consolidada, "Crédito" e "Débito" sem as unidades de consolidado.ts; fora
 * dela, a soma simples. (A seção soma tudo numa varredura só, dentro do
 * componente; aqui está a mesma conta, por extenso.)
 */
function cardsDeTotal(lida: Lida, unidadesFiltradas: string[] = []) {
  const visao = consolidado.ehVisaoConsolidada(lida.baseInteira, unidadesFiltradas);
  const filtro = new Set(unidadesFiltradas.map((u) => parsers.norm(u)));
  const linhas = lida.financial.filter((r) => !filtro.size || filtro.has(parsers.norm(r.unidade)));
  const entra = (r: FinancialRow) =>
    !visao || !consolidado.ficaForaDoConsolidado(r.unidade, "brasil");
  return {
    visaoConsolidada: visao,
    receitaTotal: linhas.filter(entra).reduce((s, r) => s + r.credito1, 0),
    despesaTotal: linhas.filter(entra).reduce((s, r) => s + r.debito1, 0),
  };
}

/** A meta do recorte, pela mesma função que a Seção 1 e o Acumulado Diário chamam. */
function meta(lida: Lida, unidadesFiltradas: string[] = []) {
  return parsers.metaDeDizimosDoRecorte(
    lida,
    { todas: unidadesFiltradas.length === 0, unidades: unidadesFiltradas },
    "brasil",
  );
}

/* ============ 1. o pastor com todas as unidades vê como o Financeiro ===== */

test("pastor com TODAS as unidades recebe exatamente a base do administrador", () => {
  const doFinanceiro = banco.lerBase("brasil", null);
  const doPastor = oQueOPastorRecebe(todas, "brasil");
  assert.deepEqual(doPastor, doFinanceiro);
  assert.equal(doPastor.baseInteira, true);

  // Inclusive o que não é de unidade nenhuma: as linhas de total e a congregação sem lançamento.
  assert.ok(doPastor.membership.some((r) => r.unidade === "Total Geral"));
  assert.ok(doPastor.membership.some((r) => r.unidade === "Central Brumado"));
  assert.equal(doPastor.metaAnualTotalGeral, TOTAL_GERAL_DE_HOJE);
});

test("os cards dele são os do Financeiro: Receita e Despesa Total sem Central Missionária e Central Social", () => {
  const doFinanceiro = cardsDeTotal(banco.lerBase("brasil", null));
  const doPastor = cardsDeTotal(oQueOPastorRecebe(todas, "brasil"));
  assert.deepEqual(doPastor, doFinanceiro);
  assert.deepEqual(doPastor, {
    visaoConsolidada: true,
    receitaTotal: 5000 + 1000 + 300, // Contagem, Picos, Picos - Missões
    despesaTotal: 3000 + 600 + 200,
  });
});

test("com um filtro de unidade, ele volta à soma simples — como o Financeiro", () => {
  const filtro = ["Central Missionária"];
  const doPastor = cardsDeTotal(oQueOPastorRecebe(todas, "brasil"), filtro);
  assert.deepEqual(doPastor, cardsDeTotal(banco.lerBase("brasil", null), filtro));
  assert.deepEqual(doPastor, { visaoConsolidada: false, receitaTotal: 2000, despesaTotal: 1500 });
});

test("uma permissão órfã, de unidade que saiu da base, não tira a base inteira", () => {
  const lida = oQueOPastorRecebe(todasMaisOrfa, "brasil");
  assert.equal(lida.baseInteira, true);
  assert.deepEqual(lida, banco.lerBase("brasil", null));
});

test("com UMA unidade a menos, continua pastor: o recorte dele, sem as linhas de total, soma simples", () => {
  const lida = oQueOPastorRecebe(todasMenosUma, "brasil");
  assert.equal(lida.baseInteira, false);
  assert.ok(!lida.financial.some((r) => r.unidade === "Central Social"));
  assert.ok(!lida.membership.some((r) => r.unidade === "Total Geral"));
  assert.ok(!lida.membership.some((r) => r.unidade === "Central Brumado"));
  assert.deepEqual(cardsDeTotal(lida), {
    visaoConsolidada: false,
    receitaTotal: 5000 + 2000 + 1000 + 300, // a Missionária entra: soma simples
    despesaTotal: 3000 + 1500 + 600 + 200,
  });
});

/*
 * O portão da base inteira é unidade por unidade, e com o nome exato — ver
 * unidadesCobremACarga em banco.server.ts. Os dois testes abaixo são os que
 * falham se alguém o trocar por uma contagem, ou por uma comparação sem acento.
 */

test("PORTÃO: contagem não basta — uma órfã no lugar de uma unidade de verdade não abre a base inteira", () => {
  // Cinco nomes, como a carga tem cinco unidades; mas a Central Social não está entre eles.
  assert.equal(banco.unidadesDoPerfil(orfaNoLugar, "brasil").length, UNIDADES_BRASIL.length);

  const lida = oQueOPastorRecebe(orfaNoLugar, "brasil");
  assert.equal(lida.baseInteira, false);
  assert.ok(
    !lida.financial.some((r) => r.unidade === "Central Social"),
    "a unidade que ninguém marcou para ele não pode chegar",
  );
  assert.ok(!lida.membership.some((r) => r.unidade === "Total Geral"));
});

test("PORTÃO: o nome tem de ser exato — sem acento, a permissão não cobre a unidade", () => {
  const lida = oQueOPastorRecebe(semAcento, "brasil");
  assert.equal(lida.baseInteira, false);
  // O mesmo que o recorte de sempre faria: "Missoes" não é "Missões".
  assert.ok(!lida.financial.some((r) => r.unidade === MISSOES));
  assert.ok(!lida.membership.some((r) => r.unidade === "Total Geral"));
});

test("ter todas as unidades do Brasil não dá nada em Angola — a conferência é dentro da base pedida", () => {
  const carga = banco.iniciarCarga("angola", ["ANGOLA.csv"], "Financeiro");
  banco.gravarLancamentos(carga, lancamentos("angola", ["Central Angola Sede"]));
  banco.finalizarCarga(carga);

  const lida = oQueOPastorRecebe(todas, "angola");
  assert.equal(lida.baseInteira, false);
  assert.deepEqual(lida.financial, []);
  assert.equal(lida.carga, null);
});

test("lista vazia continua sendo nada, e nunca a base inteira", () => {
  const lida = banco.lerBase("brasil", []);
  assert.equal(lida.baseInteira, false);
  assert.deepEqual(lida.financial, []);
});

/* ======= 2. a meta da Central Picos - Missões fica fora das somas ======= */

test("a meta da Central Picos - Missões não entra em soma — nem emprestada da Central Picos", () => {
  /*
   * Pela busca aproximada do Brasil, ela pegava os R$ 900 mil da Central Picos:
   * a coluna dela se chama "Central Picos - Missão", no singular.
   */
  assert.equal(parsers.metaAnualDaUnidade(METAS_DE_HOJE, MISSOES, "brasil"), 0);
  assert.equal(parsers.metaAnualDaUnidade(METAS_DE_HOJE, PICOS, "brasil"), 900_000);
  // A regra é do Brasil: em Angola nenhuma unidade fica fora.
  assert.equal(parsers.metaFicaForaDasSomas(MISSOES, "brasil"), true);
  assert.equal(parsers.metaFicaForaDasSomas(" central picos - missoes ", "brasil"), true);
  assert.equal(parsers.metaFicaForaDasSomas(MISSOES, "angola"), false);
});

test("Financeiro e quem vê todas: com todas (ou nenhuma) marcadas, a meta é o Total Geral da planilha", () => {
  for (const lida of [banco.lerBase("brasil", null), oQueOPastorRecebe(todas, "brasil")]) {
    assert.equal(meta(lida), TOTAL_GERAL_DE_HOJE);
  }
});

test("Financeiro e quem vê todas: com unidades filtradas, a Central Picos - Missões fica fora", () => {
  for (const lida of [banco.lerBase("brasil", null), oQueOPastorRecebe(todas, "brasil")]) {
    assert.equal(meta(lida, [PICOS, MISSOES]), 900_000, "e não 1,8 milhão");
    assert.equal(meta(lida, [MISSOES]), 0);
    assert.equal(meta(lida, ["Central Contagem", PICOS]), 1_900_000, "as outras somam normal");
  }
});

test("pastor com a Central Picos - Missões, sozinha ou com outras: a meta dela não conta", () => {
  const so = oQueOPastorRecebe(soMissoes, "brasil");
  assert.equal(so.baseInteira, false);
  assert.equal(meta(so), 0, "sozinha: sem meta");
  assert.equal(meta(so, [MISSOES]), 0);

  const comPicos = oQueOPastorRecebe(picosEMissoes, "brasil");
  assert.equal(meta(comPicos), 900_000, "com a Central Picos: só a de Picos");
  assert.equal(meta(comPicos, [MISSOES]), 0);
  assert.equal(meta(comPicos, [PICOS]), 900_000);
});

/* ------------------- as cargas novas: por último, porque trocam a base */

test("com o cabeçalho corrigido, a regra continua: a meta dela só conta no Total Geral", () => {
  // A coluna passa a ter o nome exato da unidade, e um valor.
  const metas = { "Central Contagem": 1_000_000, [PICOS]: 900_000, [MISSOES]: 300_000 };
  carregarBrasil(UNIDADES_BRASIL, metas, 2_200_000);

  // O pastor que a tem: nem a soma do servidor, nem o filtro, a contam.
  const comPicos = oQueOPastorRecebe(picosEMissoes, "brasil");
  assert.equal(comPicos.metaAnualPorUnidade[MISSOES], 300_000, "a linha chega a ele...");
  assert.equal(meta(comPicos), 900_000, "...mas não entra na soma");
  assert.equal(meta(comPicos, [MISSOES]), 0);

  // O Financeiro: o Total Geral da planilha, que a considera; com filtro, fora.
  const doFinanceiro = banco.lerBase("brasil", null);
  assert.equal(meta(doFinanceiro), 2_200_000);
  assert.equal(meta(doFinanceiro, [PICOS, MISSOES]), 900_000);
});

test("uma base nova com uma unidade a mais tira a base inteira de quem não a tem — e a unidade nova não vaza", () => {
  carregarBrasil([...UNIDADES_BRASIL, "Central Nova"], METAS_DE_HOJE, TOTAL_GERAL_DE_HOJE);

  const lida = oQueOPastorRecebe(todas, "brasil");
  assert.equal(lida.baseInteira, false, "faltando uma, não é mais a base inteira");
  assert.ok(!lida.financial.some((r) => r.unidade === "Central Nova"));
  assert.ok(!lida.membership.some((r) => r.unidade === "Total Geral"));
  assert.equal(cardsDeTotal(lida).visaoConsolidada, false);

  // Marcada a unidade nova, volta a ser a base inteira — sem mais nada a fazer.
  banco.salvarPermissoes([
    { perfilId: todas, base: "brasil", unidades: [...UNIDADES_BRASIL, "Central Nova"] },
  ]);
  assert.deepEqual(oQueOPastorRecebe(todas, "brasil"), banco.lerBase("brasil", null));
});

test("carga sem unidade nenhuma nunca vira a base inteira — “todas” de nada não é acesso", () => {
  /*
   * Lançamentos sem unidade e uma membresia com o total da rede. "Ter todas as
   * unidades" de uma carga que não tem nenhuma seria verdade por vacuidade —
   * e entregaria o total da rede a qualquer pastor com qualquer permissão.
   */
  const carga = banco.iniciarCarga("brasil", ["FINANCEIRO.csv"], "Financeiro");
  banco.gravarLancamentos(
    carga,
    lancamentos("brasil", ["Central Contagem"]).map((r) => ({ ...r, unidade: "" })),
  );
  banco.gravarMembresia(carga, [{ unidade: "Total Geral", meses: { "jan/26": 1000 } }]);
  banco.finalizarCarga(carga);

  const lida = oQueOPastorRecebe(todas, "brasil");
  assert.equal(lida.baseInteira, false);
  assert.deepEqual(lida.membership, []);
  assert.deepEqual(lida.financial, []);
});
