/*
 * O teste da membresia e do saldo — nas duas bases, pela mesma regra.
 *
 * Duas promessas. A primeira: o que falta numa carga é dito, nunca zerado. Sem
 * membresia, os três cards que dependem dela mostram "—" e "Base de membresia
 * não carregada"; sem saldo, o card de saldo diz que a base não foi carregada.
 * A segunda: o arquivo de outra base é RECUSADO. Membresia e saldo não têm a
 * assinatura do financeiro — o que os liga à base é ter unidade em comum com o
 * financeiro do mesmo envio.
 *
 * Nada aqui é especial de Angola: cada cenário roda nas duas bases. As
 * planilhas usam os cabeçalhos reais (membresia e saldo de setembro do Brasil,
 * financeiro de exemplo de Angola) e os nomes reais das unidades.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Base } from "../src/lib/bases.ts";

/* Ver recorte.test.ts: a pasta do banco tem de existir antes do import. */
const PASTA = mkdtempSync(join(tmpdir(), "central-membresia-"));
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

/* ------------------------------------------------ as planilhas de cada base */

/*
 * As unidades de cada base, com os nomes reais: em Angola, os do 2º nível do
 * arquivo de exemplo (com o prefixo "Central Angola"); no Brasil, os do 1º.
 */
const UNIDADES: Record<Base, string[]> = {
  brasil: ["Central Sede", "Central Picos", "Central Contagem"],
  angola: ["Central Angola Sede", "Central Angola Calumbiro", "Central Angola Benguela"],
};

function cp1252(texto: string): Uint8Array {
  return new Uint8Array(
    [...texto].map((ch) => {
      const c = ch.charCodeAt(0);
      if (c > 0xff) throw new Error(`caractere fora do cp1252 no teste: ${ch}`);
      return c;
    }),
  );
}

async function ler(nome: string, linhas: string[][]) {
  const texto = linhas.map((l) => l.join(";")).join("\r\n");
  return parsers.parseFile(new File([cp1252(texto)], nome));
}

/** O financeiro na forma de cada base — Brasil pelo 1º nível, Angola pelo 2º. */
async function financeiro(base: Base) {
  const cab =
    base === "brasil"
      ? ["Data", "Descrição CR. 1º Nível", "Descrição CR. 2º Nível"]
      : ["Dt. Baixa", "Descrição CR. 1º Nível", "Descrição CR. 2º Nível"];
  const colunas = [
    ...cab,
    "Descrição Nat. 2º Nível",
    "Descrição Nat. 3º Nível",
    "Mês Baixa",
    "Ano Baixa",
    " Crédito 2 ",
    " Débito 2 ",
    " Crédito ",
    " Débito ",
    "Nro. Único Financeiro",
  ];
  const linhas = UNIDADES[base].flatMap((u, k) =>
    [1, 2, 3].map((mes) => [
      `1${k}/0${mes}/2026`,
      base === "brasil" ? u : "Central Angola",
      base === "brasil" ? "Templo" : u,
      "Dízimos e Ofertas",
      "PIX",
      String(mes),
      "2026",
      "1.000,00",
      "0,00",
      "1.000,00",
      "0,00",
      `${base}-${k}-${mes}`,
    ]),
  );
  return parsers.normalizeFinancial(await ler("FINANCEIRO.csv", [colunas, ...linhas]), base);
}

/*
 * A membresia no formato real: "Unidades;Receita Per Capta;jan/26…;Média", uma
 * linha "Total Geral" no alto, e a segunda coluna com o rótulo "Membresia".
 */
async function membresia(unidades: string[]) {
  const meses = ["jan/26", "fev/26", "mar/26", "abr/26", "mai/26", "jun/26"];
  const cab = ["Unidades", "Receita Per Capta", ...meses, "Média"];
  const linhas = [
    ["Total Geral", "Membresia", ...meses.map(() => String(100 * unidades.length)), "100"],
    ...unidades.map((u) => [u, "Membresia", ...meses.map(() => "100"), "100"]),
  ];
  return parsers.normalizeMembership(await ler("MEMBRESIA.csv", [cab, ...linhas]));
}

/* O saldo no formato real: "Período;Centro de Resultado;Saldo Anual;Saldo Acumulado". */
async function saldo(unidades: string[]) {
  const cab = ["Período", "Centro de Resultado", "Saldo Anual", "Saldo Acumulado"];
  const linhas = unidades.flatMap((u) => [
    ["01/01/2026", u, "1.000,00", "1.000,00"],
    ["Atual", u, "2.500,50", "2.500,50"],
  ]);
  return parsers.normalizeSaldo(await ler("SALDO.csv", [cab, ...linhas]));
}

/**
 * O envio, do jeito que a tela faz: confere os arquivos entre si e só então
 * grava a carga. Devolve o que o dashboard leria da base.
 */
async function enviar(
  base: Base,
  arquivos: { membresia?: string[]; saldo?: string[]; financeiroDe?: Base } = {},
) {
  const fin = await financeiro(arquivos.financeiroDe ?? base);
  const mem = arquivos.membresia ? await membresia(arquivos.membresia) : [];
  const sal = arquivos.saldo ? await saldo(arquivos.saldo) : [];
  parsers.conferirArquivosDoEnvio({ base, financeiro: fin.rows, membresia: mem, saldo: sal });
  const carga = banco.iniciarCarga(base, ["FINANCEIRO.csv"], "Financeiro");
  banco.gravarLancamentos(carga, fin.rows);
  banco.gravarMembresia(carga, mem);
  banco.gravarSaldos(carga, sal);
  banco.gravarMetas(carga, fin.metaAnualPorUnidade, fin.metaAnualTotalGeral);
  banco.finalizarCarga(carga);
  return banco.lerBase(base, null);
}

/** O que os cards desenhariam — pelas mesmas funções que a Seção 1 usa. */
function cards(lida: ReturnType<Banco["lerBase"]>) {
  return {
    membresia: presenca.cardDeMembresia(lida.presenca, "valor de verdade"),
    saldo: presenca.avisoDoCardDeSaldo(lida.saldo),
  };
}

const PREENCHIDO = { valor: "valor de verdade" };
const SEM_MEMBRESIA = { valor: "—", nota: "Base de membresia não carregada" };

/* --------------------------------- os cenários, rodados nas duas bases */

for (const base of ["angola", "brasil"] as const) {
  const nome = base === "angola" ? "Angola" : "Brasil";
  const unidades = UNIDADES[base];

  test(`${nome} com os três arquivos: os cards de membresia e saldo preenchem`, async () => {
    const lida = await enviar(base, { membresia: unidades, saldo: unidades });
    assert.deepEqual(cards(lida), { membresia: PREENCHIDO, saldo: null });
    // E o número que vai no card existe: o Total Geral do mês, para quem vê tudo.
    assert.equal(parsers.membershipForMonth(lida.membership, "Total Geral", 2026, 1), 300);
    assert.equal(parsers.membershipForMonth(lida.membership, unidades[1]!, 2026, 1), 100);
    assert.equal(lida.saldo.length, 6);
  });

  test(`${nome} só com o financeiro: os cards mostram "—" e a mensagem, não zero`, async () => {
    const lida = await enviar(base);
    assert.deepEqual(cards(lida), {
      membresia: SEM_MEMBRESIA,
      saldo: "Base de saldo não carregada.",
    });
    // O resto da base abre normalmente.
    assert.equal(lida.financial.length, 9);
  });

  test(`${nome} com financeiro e membresia, sem saldo: só o card de saldo avisa`, async () => {
    const lida = await enviar(base, { membresia: unidades });
    assert.deepEqual(cards(lida), {
      membresia: PREENCHIDO,
      saldo: "Base de saldo não carregada.",
    });
  });
}

/* ---------------------------------- armadilha: arquivo de outra base */

test("ARMADILHA: membresia do Brasil enviada no bloco de Angola é recusada", async () => {
  await assert.rejects(enviar("angola", { membresia: UNIDADES.brasil }), (e: unknown) => {
    assert.ok(e instanceof parsers.PlanilhaRecusada);
    assert.match(e.message, /O arquivo de membresia não pode entrar na base Angola/);
    assert.match(e.message, /parece ser de outra base/);
    assert.match(e.message, /Nada foi enviado/);
    return true;
  });
});

test("ARMADILHA: membresia de Angola enviada no bloco do Brasil é recusada", async () => {
  await assert.rejects(
    enviar("brasil", { membresia: UNIDADES.angola }),
    /O arquivo de membresia não pode entrar na base Brasil/,
  );
});

test("ARMADILHA: o saldo trocado também é recusado, nas duas direções", async () => {
  await assert.rejects(
    enviar("angola", { saldo: UNIDADES.brasil }),
    /O arquivo de saldo não pode entrar na base Angola/,
  );
  await assert.rejects(
    enviar("brasil", { saldo: UNIDADES.angola }),
    /O arquivo de saldo não pode entrar na base Brasil/,
  );
});

test("a recusa acontece antes de gravar: a base no servidor continua a mesma", async () => {
  const antes = await enviar("angola", { membresia: UNIDADES.angola });
  await assert.rejects(enviar("angola", { membresia: UNIDADES.brasil }));
  const depois = banco.lerBase("angola", null);
  assert.equal(depois.carga?.id, antes.carga?.id, "a carga ativa é a mesma de antes");
  assert.equal(depois.membership.length, antes.membership.length);
});

/* ------------------------------------------ o critério: pelo menos uma */

test("basta UMA unidade em comum — a membresia real do Brasil tem unidades que a financeira não tem", async () => {
  /*
   * Como a de setembro: congregações sem lançamento, unidades da financeira sem
   * linha de membresia, e até uma linha "Central Angola" — que existe na
   * membresia do Brasil e não pode servir de assinatura por isso.
   */
  const lida = await enviar("brasil", {
    membresia: ["Central Sede", "Central Bocaina", "Central Brumado", "Central Angola"],
  });
  assert.equal(lida.presenca.membresia, true);
});

test("o casamento ignora acento, maiúscula e espaço nas pontas, como o dashboard", async () => {
  await enviar("angola", { membresia: ["  CENTRAL ANGOLA SEDE  "] });
  await enviar("brasil", { saldo: ["central sede"] });
});

test("só a linha Total Geral, sem unidade nenhuma, não basta", async () => {
  // O Total Geral existe nas duas bases: sozinho, não diz de qual o arquivo é.
  const fin = await financeiro("angola");
  const soTotal = await membresia([]);
  assert.deepEqual(
    soTotal.map((r) => r.unidade),
    ["Total Geral"],
  );
  assert.throws(
    () =>
      parsers.conferirArquivosDoEnvio({
        base: "angola",
        financeiro: fin.rows,
        membresia: soTotal,
        saldo: [],
      }),
    /nenhuma unidade além do Total Geral/,
  );
});

/* ------------------------------------- o aviso de perda, antes do envio */

test("o envio avisa o que vai sumir: membresia e saldo que a carga atual tem e o envio não traz", () => {
  const tudo = { ...presenca.SEM_DADOS, membresia: true, saldo: true };
  assert.deepEqual(presenca.oQueOEnvioApaga(tudo, { membresia: false, saldo: true }), [
    "membresia",
  ]);
  assert.deepEqual(presenca.oQueOEnvioApaga(tudo, { membresia: true, saldo: false }), ["saldo"]);
  assert.deepEqual(presenca.oQueOEnvioApaga(tudo, { membresia: false, saldo: false }), [
    "membresia",
    "saldo",
  ]);
  assert.deepEqual(presenca.oQueOEnvioApaga(tudo, { membresia: true, saldo: true }), []);
  // O que a carga atual não tem não pode ser perdido; base sem carga, também não.
  assert.deepEqual(
    presenca.oQueOEnvioApaga(presenca.SEM_DADOS, { membresia: false, saldo: false }),
    [],
  );
  assert.deepEqual(presenca.oQueOEnvioApaga(null, { membresia: false, saldo: false }), []);
});

test("a presença da carga ativa, que a tela de envio lê, diz se há membresia e saldo", async () => {
  await enviar("angola", { membresia: UNIDADES.angola });
  let atual = banco.presencaDaCargaAtiva("angola");
  assert.equal(atual?.membresia, true);
  assert.equal(atual?.saldo, false);

  // Nos dois sentidos: com o saldo na carga, a tela tem de saber que ele existe.
  await enviar("angola", { saldo: UNIDADES.angola });
  atual = banco.presencaDaCargaAtiva("angola");
  assert.equal(atual?.membresia, false);
  assert.equal(atual?.saldo, true);
});
