/*
 * O teste que guarda o recorte por unidade.
 *
 * A escolha do SQLite — feita pela Central, e boa pelo resto — tem um custo
 * aqui: o PostgreSQL teria segurança no nível da linha, uma rede de baixo que
 * continuaria valendo mesmo se o código errasse. O SQLite não tem isso, então
 * a rede é este arquivo.
 *
 * Ele existe para falhar no dia em que alguém — inclusive eu, daqui a seis
 * meses — abrir um atalho que contorne `lerBase` ou esqueça de filtrar uma das
 * tabelas. Sem ele, o vazamento só apareceria quando um pastor comentasse que
 * viu o número de outra igreja.
 *
 * Roda com `npm test`. Sem dependência: o Node 24 executa TypeScript e traz o
 * próprio executor de testes.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/*
 * A pasta do banco é lida quando o módulo carrega, então ela precisa existir no
 * ambiente antes do import — daí o import dinâmico lá embaixo, e não no topo.
 */
const PASTA = mkdtempSync(join(tmpdir(), "central-teste-"));
process.env.DADOS_DIR = PASTA;

type Banco = typeof import("../src/lib/banco.server.ts");
let banco: Banco;

const UNIDADES = ["Central Sede", "Central Picos", "Central Norte"];

/* Um nome hostil entre os dados, para provar que o filtro é parametrizado. */
const NOME_HOSTIL = "Central'; DROP TABLE lancamentos; --";

before(async () => {
  banco = await import("../src/lib/banco.server.ts");

  const cargaId = banco.iniciarCarga(["teste.csv"], "Financeiro");
  const linhas = [...UNIDADES, NOME_HOSTIL].flatMap((unidade) =>
    Array.from({ length: 10 }, (_, i) => ({
      unidade,
      nat2: "Dízimos e Ofertas",
      nat3: "PIX",
      nat4: "Dízimo",
      razaoSocial: `P${i}`,
      projeto: "",
      meta: "",
      credito: 100,
      credito1: 100,
      debito: 0,
      debito1: 0,
      data: null,
      dia: i + 1,
      mes: 1,
      ano: 2026,
      nroUnico: `${unidade}-${i}`,
    })),
  );
  banco.gravarLancamentos(cargaId, linhas as never);
  banco.gravarMembresia(
    cargaId,
    [...UNIDADES, "Total Geral"].map((unidade) => ({
      unidade,
      meses: { "jan/26": unidade === "Total Geral" ? 3000 : 1000 },
    })),
  );
  banco.gravarSaldos(
    cargaId,
    UNIDADES.map((unidade) => ({
      unidade,
      periodo: "Atual",
      quando: "atual" as const,
      saldo: 500,
    })),
  );
  banco.gravarMetas(cargaId, { "Central Sede": 30, "Central Picos": 20, "Central Norte": 10 }, 60);
  banco.finalizarCarga(cargaId);
});

after(() => {
  // Fecha antes de apagar: no Windows o arquivo aberto não é removível.
  banco.fechar();
  rmSync(PASTA, { recursive: true, force: true });
});

/** Todas as unidades que aparecem em qualquer parte do resultado. */
function unidadesNoResultado(base: Awaited<ReturnType<Banco["lerBase"]>>): string[] {
  return [
    ...new Set([
      ...base.financial.map((r) => r.unidade),
      ...base.membership.map((r) => r.unidade),
      ...base.saldo.map((r) => r.unidade),
      ...Object.keys(base.metaAnualPorUnidade),
    ]),
  ].sort();
}

test("administrador enxerga todas as unidades", () => {
  const base = banco.lerBase(null);
  assert.equal(base.financial.length, 40);
  assert.ok(unidadesNoResultado(base).includes("Central Sede"));
  assert.equal(base.metaAnualTotalGeral, 60, "o consolidado da planilha chega a quem vê tudo");
});

test("pastor recebe APENAS as unidades dele, em todas as tabelas", () => {
  const base = banco.lerBase(["Central Picos"]);
  assert.deepEqual(
    unidadesNoResultado(base),
    ["Central Picos"],
    "nenhuma outra unidade pode aparecer em lançamentos, membresia, saldos ou metas",
  );
  assert.equal(base.financial.length, 10);
});

test("a linha consolidada de membresia não chega ao pastor", () => {
  /*
   * Ela vale a rede inteira. Se chegasse, o dízimo per capita do pastor teria
   * o numerador de uma igreja sobre o denominador de todas.
   */
  const base = banco.lerBase(["Central Picos"]);
  assert.ok(!base.membership.some((r) => r.unidade === "Total Geral"));
});

test("a meta do pastor é a soma das unidades dele, não a da rede", () => {
  assert.equal(banco.lerBase(["Central Picos"]).metaAnualTotalGeral, 20);
  assert.equal(banco.lerBase(["Central Picos", "Central Norte"]).metaAnualTotalGeral, 30);
});

test("pastor sem nenhuma unidade não vê nada — lista vazia é nada, não tudo", () => {
  const base = banco.lerBase([]);
  assert.equal(base.financial.length, 0);
  assert.equal(base.membership.length, 0);
  assert.equal(base.saldo.length, 0);
  assert.deepEqual(base.metaAnualPorUnidade, {});
});

test("nome de unidade hostil não escapa do filtro nem derruba a tabela", () => {
  const base = banco.lerBase([NOME_HOSTIL]);
  assert.deepEqual(unidadesNoResultado(base), [NOME_HOSTIL]);
  // A tabela continua de pé: o nome entrou como valor, nunca como SQL.
  assert.equal(banco.lerBase(null).financial.length, 40);
});

test("pedir uma unidade que não existe devolve vazio, e não tudo", () => {
  assert.equal(banco.lerBase(["Central Inexistente"]).financial.length, 0);
});

/*
 * Acentos vindos de um arquivo do Excel brasileiro, até o recorte.
 *
 * O Excel BR salva CSV em Windows-1252, não em UTF-8, e os nomes de unidade da
 * Central têm acento — "Central Missões", "Central Picos - Missões". Se a
 * decodificação errar em qualquer ponto do caminho, o nome chega diferente do
 * que está gravado em `permissoes`, que casa por texto exato: o pastor perde o
 * acesso e ninguém liga uma coisa à outra.
 *
 * O teste percorre o caminho inteiro — bytes cp1252, leitura da planilha,
 * gravação, leitura e recorte —, e não só a decodificação isolada.
 */
test("nome acentuado de arquivo do Excel BR sobrevive até o recorte", async () => {
  const { parseFile, normalizeFinancial } = await import("../src/lib/parsers.ts");

  const colunas = [
    "Descrição CR. 1º Nível",
    "Descrição Nat. 2º Nível",
    "Descrição Nat. 3º Nível",
    "Descrição Nat. 4º Nível",
    "Razão Social Parceiro",
    "Nome Projeto",
    "Meta",
    "Crédito",
    "Crédito 2",
    "Débito",
    "Dia Baixa",
    "Mês Baixa",
    "Ano Baixa",
    "Nro. Único Financeiro",
  ];
  const ACENTUADA = "Central Missões";
  const texto = [
    colunas.join(";"),
    [
      ACENTUADA,
      "Dízimos e Ofertas",
      "Gazofilácio",
      "Dízimo",
      "José Antônio",
      "",
      "",
      "1000",
      "1000",
      "0",
      "1",
      "1",
      "2026",
      "F1",
    ].join(";"),
  ].join("\n");

  /* Codifica em Windows-1252 de verdade: um byte por caractere acentuado. */
  const cp1252: Record<string, number> = {
    ç: 0xe7,
    ã: 0xe3,
    õ: 0xf5,
    é: 0xe9,
    ê: 0xea,
    á: 0xe1,
    í: 0xed,
    ó: 0xf3,
    ú: 0xfa,
    â: 0xe2,
    ô: 0xf4,
    º: 0xba,
  };
  const bytes = new Uint8Array(
    [...texto].map((ch) => cp1252[ch] ?? (ch.charCodeAt(0) < 256 ? ch.charCodeAt(0) : 0x3f)),
  );
  assert.ok(bytes.includes(0xe7), "o arquivo de teste precisa mesmo estar em cp1252");

  const lidas = normalizeFinancial(await parseFile(new File([bytes], "FINANCEIRO.csv")));
  assert.equal(lidas.rows[0]?.unidade, ACENTUADA, "o acento tem de sobreviver à leitura");

  const carga = banco.iniciarCarga(["FINANCEIRO.csv"], "Financeiro");
  banco.gravarLancamentos(carga, lidas.rows);
  banco.finalizarCarga(carga);

  assert.ok(
    banco.listarUnidades().includes(ACENTUADA),
    "o acento tem de sobreviver à ida e volta pelo banco",
  );
  assert.equal(
    banco.lerBase([ACENTUADA]).financial.length,
    1,
    "e o recorte tem de casar com o nome acentuado",
  );
});
