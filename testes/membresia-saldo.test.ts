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
 *
 * E uma terceira, no fim do arquivo: o total da membresia. A linha explícita
 * de total manda; na falta dela, soma das unidades. As três formas de arquivo —
 * só o total (Angola hoje), total e unidades (Brasil hoje), só unidades (Angola
 * quando o detalhamento chegar) — passam pela mesma regra, sem mudar código.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Base } from "../src/lib/bases.ts";
import type { FinancialParsed, MembershipRow, SaldoRow } from "../src/lib/parsers.ts";

/* Ver recorte.test.ts: a pasta do banco tem de existir antes do import. */
const PASTA = mkdtempSync(join(tmpdir(), "central-membresia-"));
process.env.DADOS_DIR = PASTA;

type Banco = typeof import("../src/lib/banco.server.ts");
type Parsers = typeof import("../src/lib/parsers.ts");
type ModPresenca = typeof import("../src/lib/presenca.ts");
type ModBases = typeof import("../src/lib/bases.ts");
let banco: Banco;
let parsers: Parsers;
let presenca: ModPresenca;
let bases: ModBases;

before(async () => {
  banco = await import("../src/lib/banco.server.ts");
  parsers = await import("../src/lib/parsers.ts");
  presenca = await import("../src/lib/presenca.ts");
  bases = await import("../src/lib/bases.ts");
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
async function financeiro(base: Base, unidades: readonly string[] = UNIDADES[base]) {
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
  const linhas = unidades.flatMap((u, k) =>
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
  return gravar(base, fin, mem, sal);
}

/** O envio de uma membresia já lida, contra o financeiro destas unidades. */
async function enviarMembresia(
  base: Base,
  mem: MembershipRow[],
  unidades: readonly string[] = UNIDADES[base],
) {
  const fin = await financeiro(base, unidades);
  parsers.conferirArquivosDoEnvio({ base, financeiro: fin.rows, membresia: mem, saldo: [] });
  return gravar(base, fin, mem, []);
}

/** Grava a carga e a ativa, como o servidor faz ao fim de um envio. */
function gravar(base: Base, fin: FinancialParsed, mem: MembershipRow[], sal: SaldoRow[]) {
  const carga = banco.iniciarCarga(base, ["FINANCEIRO.csv"], "Financeiro");
  banco.gravarLancamentos(carga, fin.rows);
  banco.gravarMembresia(carga, mem);
  banco.gravarSaldos(carga, sal);
  banco.gravarMetas(carga, fin.metaAnualPorUnidade, fin.metaAnualTotalGeral);
  banco.finalizarCarga(carga);
  return banco.lerBase(base, null);
}

type Lida = ReturnType<Banco["lerBase"]>;

/** O que os cards desenhariam — pelas mesmas funções que a Seção 1 usa. */
function cards(lida: Lida) {
  return {
    membresia: presenca.cardDeMembresia(lida.presenca, "valor de verdade"),
    saldo: presenca.avisoDoCardDeSaldo(lida.saldo),
  };
}

/*
 * A membresia que a Seção 1 e o Acumulado Diário mostram, pela mesma função
 * que eles chamam. "Total Geral" é a visão sem filtro de unidade: o recorte
 * leva todas as unidades da base, como o Dashboard monta a lista.
 */
function totalGeral(lida: Lida, base: Base, mes = 9) {
  const unidades = [...new Set(lida.financial.map((r) => r.unidade))];
  return parsers.membresiaDoRecorte(lida.membership, { todas: true, unidades }, base, 2026, mes);
}
function daUnidade(lida: Lida, base: Base, unidade: string, mes = 9) {
  return parsers.membresiaDoRecorte(
    lida.membership,
    { todas: false, unidades: [unidade] },
    base,
    2026,
    mes,
  );
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
    assert.equal(totalGeral(lida, base, 1), 300);
    assert.equal(daUnidade(lida, base, unidades[1]!, 1), 100);
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
   * linha de membresia, e até uma linha "Central Angola" — que no Brasil é só
   * mais uma unidade que não casa: o Brasil não tem identidade (ver bases.ts).
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

test("só a linha Total Geral, sem unidade nenhuma, não basta — nas duas bases", async () => {
  // O Total Geral existe nas duas bases: sozinho, não diz de qual o arquivo é.
  const soTotal = await membresia([]);
  assert.deepEqual(
    soTotal.map((r) => r.unidade),
    ["Total Geral"],
  );
  for (const base of ["angola", "brasil"] as const) {
    const fin = await financeiro(base);
    assert.throws(
      () =>
        parsers.conferirArquivosDoEnvio({
          base,
          financeiro: fin.rows,
          membresia: soTotal,
          saldo: [],
        }),
      /nenhuma unidade além do Total Geral/,
    );
  }
  // Em Angola a mensagem diz onde o total do país sozinho entraria.
  const fin = await financeiro("angola");
  assert.throws(
    () =>
      parsers.conferirArquivosDoEnvio({
        base: "angola",
        financeiro: fin.rows,
        membresia: soTotal,
        saldo: [],
      }),
    /o total de Angola sozinho viria numa linha "Central Angola"/,
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

/* ============================================ o total da membresia ===== */

/*
 * As cinco unidades reais de Angola — o 2º nível do financeiro, com o prefixo.
 * O detalhamento por unidade, quando chegar, vem com estes nomes.
 */
const CINCO_DE_ANGOLA = [
  "Central Angola Sede",
  "Central Angola Calumbiro",
  "Central Angola Benguela",
  "Central Angola Tchihingui",
  "Central Angola Mapunda",
];

/*
 * A membresia de Angola de hoje, inteira, como a Central a mandou em 08/10: uma
 * linha só, "Central Angola" — o 1º nível, o país —, e nenhuma unidade. O
 * " Membresia " com espaços, os meses vazios de outubro a dezembro e a média
 * "2.888" com ponto de milhar vêm do arquivo.
 */
const MEMBRESIA_DE_ANGOLA_HOJE = [
  "Unidades;Receita Per Capta;jan/26;fev/26;mar/26;abr/26;mai/26;jun/26;jul/26;ago/26;set/26;out/26;nov/26;dez/26;Média",
  "Central Angola; Membresia ;2711;2656;2634;2759;2947;2967;2967;3180;3170;;;;2.888",
].join("\r\n");

async function membresiaDeAngolaHoje() {
  const arquivo = new File([cp1252(MEMBRESIA_DE_ANGOLA_HOJE)], "Membresia Angola.csv");
  return parsers.normalizeMembership(await parsers.parseFile(arquivo));
}

/** De janeiro a setembro, o mesmo número — só setembro é conferido. */
const ateSetembro = (n: number) => Array<number>(9).fill(n);

/**
 * Uma membresia montada linha a linha, no formato real: "Unidades;Receita Per
 * Capta;jan/26…dez/26;Média". Os meses que a linha não traz ficam vazios.
 */
async function membresiaDe(linhas: [string, ...number[]][]) {
  const meses = [
    "jan",
    "fev",
    "mar",
    "abr",
    "mai",
    "jun",
    "jul",
    "ago",
    "set",
    "out",
    "nov",
    "dez",
  ];
  const cab = ["Unidades", "Receita Per Capta", ...meses.map((m) => `${m}/26`), "Média"];
  const corpo = linhas.map(([nome, ...valores]) => [
    nome,
    "Membresia",
    ...meses.map((_, i) => (valores[i] === undefined ? "" : String(valores[i]))),
    "",
  ]);
  return parsers.normalizeMembership(await ler("MEMBRESIA.csv", [cab, ...corpo]));
}

/*
 * A membresia do Brasil em setembro, reduzida ao que importa para o total, com
 * os dois números reais que a Central mediu: a linha "Total Geral" diz 25.432;
 * as outras linhas somam 28.602, porque a linha "Central Angola" (3.170) está
 * no arquivo e não é do Brasil. As congregações que este teste não usa viram
 * uma linha só, "Demais congregações", com o que falta para fechar a conta —
 * os números por congregação ficam fora do repositório, que é público.
 */
async function membresiaDoBrasilEmSetembro({ comCentralAngola = true } = {}) {
  return membresiaDe([
    ["Total Geral", ...ateSetembro(25432)],
    ["Central Picos", ...ateSetembro(900)],
    ["Central Contagem", ...ateSetembro(2800)],
    // Congregação sem lançamento: está no Total Geral, e não na financeira.
    ["Central Brumado", ...ateSetembro(200)],
    ["Demais congregações", ...ateSetembro(21532)],
    ...(comCentralAngola
      ? [["Central Angola", ...ateSetembro(3170)] as [string, ...number[]]]
      : []),
  ]);
}

/** O detalhamento de Angola por unidade, quando chegar: soma 3.215, e não 3.170. */
const ANGOLA_POR_UNIDADE: [string, ...number[]][] = [
  ["Central Angola Sede", ...ateSetembro(1300)],
  ["Central Angola Calumbiro", ...ateSetembro(820)],
  ["Central Angola Benguela", ...ateSetembro(610)],
  ["Central Angola Tchihingui", ...ateSetembro(290)],
  ["Central Angola Mapunda", ...ateSetembro(195)],
];

/* ------------------------------------------------- Angola hoje: forma 1 */

test("a membresia real de Angola, uma linha só “Central Angola”, é ACEITA", async () => {
  const mem = await membresiaDeAngolaHoje();
  assert.deepEqual(
    mem.map((r) => r.unidade),
    ["Central Angola"],
  );
  const fin = await financeiro("angola", CINCO_DE_ANGOLA);
  assert.doesNotThrow(() =>
    parsers.conferirArquivosDoEnvio({
      base: "angola",
      financeiro: fin.rows,
      membresia: mem,
      saldo: [],
    }),
  );
});

test("com ela carregada, a visão Total Geral de Angola mostra 3.170 em setembro", async () => {
  const lida = await enviarMembresia("angola", await membresiaDeAngolaHoje(), CINCO_DE_ANGOLA);
  assert.equal(totalGeral(lida, "angola", 9), 3170);
  assert.equal(totalGeral(lida, "angola", 1), 2711);
  // E os cards mostram o número: a base de membresia foi carregada.
  assert.equal(lida.presenca.membresia, true);
  assert.deepEqual(presenca.cardDeMembresia(lida.presenca, "3.170"), { valor: "3.170" });
});

test("filtrando uma unidade de Angola, é o comportamento de hoje para unidade sem linha: zero", async () => {
  const lida = await enviarMembresia("angola", await membresiaDeAngolaHoje(), CINCO_DE_ANGOLA);
  for (const u of CINCO_DE_ANGOLA) assert.equal(daUnidade(lida, "angola", u), 0, u);
  // O mesmo que uma unidade do Brasil sem linha: zero, e o card mostra o zero.
  const brasil = await enviar("brasil", { membresia: ["Central Picos"] });
  assert.equal(daUnidade(brasil, "brasil", "Central Sede", 1), 0);
  assert.deepEqual(presenca.cardDeMembresia(lida.presenca, "0"), { valor: "0" });

  // O pastor de uma unidade não recebe a linha do país, e o "todas" dele é zero.
  const pastor = banco.lerBase("angola", ["Central Angola Calumbiro"]);
  assert.equal(pastor.membership.length, 0);
  assert.equal(
    parsers.membresiaDoRecorte(
      pastor.membership,
      { todas: true, unidades: ["Central Angola Calumbiro"] },
      "angola",
      2026,
      9,
    ),
    0,
  );
});

/* ------------------------------------------------ Brasil hoje: forma 2 */

test("o Brasil não muda: o Total Geral lê a linha própria, 25.432 em setembro, e não a soma de 28.602", async () => {
  const lida = await enviarMembresia("brasil", await membresiaDoBrasilEmSetembro());
  assert.equal(totalGeral(lida, "brasil", 9), 25432);

  // As duas somas possíveis, para ficar registrado que nenhuma serve.
  const linhas = lida.membership.filter((r) => parsers.norm(r.unidade) !== "total geral");
  const somaDeTudo = linhas.reduce((s, r) => s + (r.meses["set/26"] ?? 0), 0);
  assert.equal(somaDeTudo, 28602, "somar todas as linhas conta a de Angola");
  const somaDasUnidades = parsers.membresiaDoRecorte(
    lida.membership,
    { todas: false, unidades: UNIDADES.brasil },
    "brasil",
    2026,
    9,
  );
  assert.equal(somaDasUnidades, 3700, "somar só a financeira perde as congregações sem lançamento");
  // Cada unidade continua com a sua linha.
  assert.equal(daUnidade(lida, "brasil", "Central Contagem"), 2800);
});

test("o Brasil não tem identidade: a linha “Central Angola” da membresia dele nunca vira o total do Brasil", async () => {
  // A assinatura do Brasil é uma proibição, e o nome proibido não é o nome da base.
  assert.equal(bases.identidadeDaBase("brasil"), null);
  assert.equal(bases.identidadeDaBase("angola"), "Central Angola");

  // Mesmo sem a linha Total Geral, a "Central Angola" não passa por total do Brasil:
  // o total é a soma das unidades da financeira — nem 3.170, nem com os 3.170.
  const mem = await membresiaDe([
    ["Central Picos", ...ateSetembro(900)],
    ["Central Contagem", ...ateSetembro(2800)],
    ["Central Angola", ...ateSetembro(3170)],
  ]);
  const lida = await enviarMembresia("brasil", mem);
  assert.equal(totalGeral(lida, "brasil", 9), 3700);
});

/* ------------------------------ Angola amanhã: liga sozinha, formas 3 e 2 */

test("a MESMA base de Angola, recarregada com cinco linhas por unidade e sem total, mostra cada unidade e um Total Geral igual à soma", async () => {
  // Hoje: a linha do país.
  const hoje = await enviarMembresia("angola", await membresiaDeAngolaHoje(), CINCO_DE_ANGOLA);
  assert.equal(totalGeral(hoje, "angola"), 3170);
  assert.equal(daUnidade(hoje, "angola", "Central Angola Calumbiro"), 0);

  // O detalhamento chega, sem linha de total — e nada no código muda.
  const amanha = await enviarMembresia(
    "angola",
    await membresiaDe(ANGOLA_POR_UNIDADE),
    CINCO_DE_ANGOLA,
  );
  assert.equal(totalGeral(amanha, "angola"), 1300 + 820 + 610 + 290 + 195);
  assert.equal(daUnidade(amanha, "angola", "Central Angola Sede"), 1300);
  assert.equal(daUnidade(amanha, "angola", "Central Angola Calumbiro"), 820);
  assert.equal(daUnidade(amanha, "angola", "Central Angola Mapunda"), 195);

  // O pastor de Calumbiro passa a ver a membresia dele.
  const pastor = banco.lerBase("angola", ["Central Angola Calumbiro"]);
  assert.equal(
    parsers.membresiaDoRecorte(
      pastor.membership,
      { todas: true, unidades: ["Central Angola Calumbiro"] },
      "angola",
      2026,
      9,
    ),
    820,
  );
});

test("cinco linhas por unidade MAIS uma linha de total: o total vem da linha, não da soma", async () => {
  // A linha de total pode vir com o nome do país ou como "Total Geral".
  for (const nomeDoTotal of ["Central Angola", "Total Geral"]) {
    const mem = await membresiaDe([[nomeDoTotal, ...ateSetembro(3170)], ...ANGOLA_POR_UNIDADE]);
    const lida = await enviarMembresia("angola", mem, CINCO_DE_ANGOLA);
    assert.equal(totalGeral(lida, "angola"), 3170, nomeDoTotal);
    assert.equal(daUnidade(lida, "angola", "Central Angola Benguela"), 610, nomeDoTotal);
  }
  // Com as duas linhas no arquivo, a que tem o nome da base é a que vale.
  const ambas = await membresiaDe([
    ["Total Geral", ...ateSetembro(9999)],
    ["Central Angola", ...ateSetembro(3170)],
    ...ANGOLA_POR_UNIDADE,
  ]);
  const lida = await enviarMembresia("angola", ambas, CINCO_DE_ANGOLA);
  assert.equal(totalGeral(lida, "angola"), 3170);
});

/* ------------------------------ a conferência, com a identidade da base */

test("ARMADILHA: a membresia do Brasil continua recusada no bloco de Angola — com a linha “Central Angola” e sem ela", async () => {
  /*
   * Hoje o arquivo do Brasil ainda traz a linha "Central Angola", que é a
   * identidade de Angola. Ela não salva o arquivo: ele tem unidades, e nenhuma
   * casa com as de Angola. Decisão da Central, 08/10.
   */
  for (const comCentralAngola of [true, false]) {
    const mem = await membresiaDoBrasilEmSetembro({ comCentralAngola });
    await assert.rejects(enviarMembresia("angola", mem, CINCO_DE_ANGOLA), (e: unknown) => {
      assert.ok(e instanceof parsers.PlanilhaRecusada);
      assert.match(e.message, /não pode entrar na base Angola/);
      assert.match(e.message, /parece ser de outra base/);
      return true;
    });
  }
});

test("a linha do país só vale sozinha: com unidades de nome errado em TODAS as linhas, o envio é recusado", async () => {
  const mem = await membresiaDe([
    ["Central Angola", ...ateSetembro(3170)],
    ["Sede", ...ateSetembro(1300)],
    ["Calumbiro", ...ateSetembro(820)],
  ]);
  await assert.rejects(enviarMembresia("angola", mem, CINCO_DE_ANGOLA), (e: unknown) => {
    assert.ok(e instanceof parsers.PlanilhaRecusada);
    // A mensagem mostra os nomes dos dois lados, para o erro ser visto na hora.
    assert.match(e.message, /"Sede", "Calumbiro"/);
    assert.match(e.message, /"Central Angola Benguela"/);
    return true;
  });
});

test("o saldo segue a mesma regra: a linha do país sozinha entra; o Total Geral sozinho, não", async () => {
  const lida = await enviar("angola", { saldo: ["Central Angola"] });
  assert.equal(lida.presenca.saldo, true);
  await assert.rejects(
    enviar("brasil", { saldo: ["Total Geral"] }),
    /nenhuma unidade além do Total Geral/,
  );
});

/* ------------------------------------------- o resumo, na hora do envio */

test("o resumo do envio lista o que não casou: o detalhamento de Angola com nomes misturados", async () => {
  const misturado: [string, ...number[]][] = [
    ["Central Angola Sede", ...ateSetembro(1300)],
    ["Calumbiro", ...ateSetembro(820)],
    ["Central Angola Benguela", ...ateSetembro(610)],
    ["Tchihingui", ...ateSetembro(290)],
    ["Mapunda", ...ateSetembro(195)],
  ];
  const mem = await membresiaDe(misturado);
  const fin = await financeiro("angola", CINCO_DE_ANGOLA);
  // A conferência aceita — duas unidades casaram —, e é o resumo que mostra o resto.
  assert.deepEqual(
    parsers.resumoDaMembresia({ base: "angola", financeiro: fin.rows, membresia: mem }),
    {
      unidades: 5,
      casaram: 2,
      naoCasaram: ["Calumbiro", "Tchihingui", "Mapunda"],
      total: { soma: 2 },
    },
  );
  // No dashboard, até o nome ser corrigido: o total é a soma do que casou, e
  // Calumbiro aparece zerada. O resumo é o que faz isso ser visto no envio.
  const lida = await enviarMembresia("angola", mem, CINCO_DE_ANGOLA);
  assert.equal(totalGeral(lida, "angola"), 1300 + 610);
  assert.equal(daUnidade(lida, "angola", "Central Angola Calumbiro"), 0);
});

test("o resumo diz de onde sai o total, nas três formas", async () => {
  const resumo = async (base: Base, mem: MembershipRow[], unidades: readonly string[]) =>
    parsers.resumoDaMembresia({
      base,
      financeiro: (await financeiro(base, unidades)).rows,
      membresia: mem,
    });

  // Forma 1, Angola hoje: nenhuma unidade, o total é a linha do país.
  assert.deepEqual(await resumo("angola", await membresiaDeAngolaHoje(), CINCO_DE_ANGOLA), {
    unidades: 0,
    casaram: 0,
    naoCasaram: [],
    total: { linha: "Central Angola" },
  });
  // Forma 2, Brasil hoje: a linha Total Geral; a "Central Angola" é uma unidade que não casa.
  assert.deepEqual(await resumo("brasil", await membresiaDoBrasilEmSetembro(), UNIDADES.brasil), {
    unidades: 5,
    casaram: 2,
    naoCasaram: ["Central Brumado", "Demais congregações", "Central Angola"],
    total: { linha: "Total Geral" },
  });
  // Forma 3, Angola amanhã: tudo casa, e o total é a soma das cinco.
  assert.deepEqual(await resumo("angola", await membresiaDe(ANGOLA_POR_UNIDADE), CINCO_DE_ANGOLA), {
    unidades: 5,
    casaram: 5,
    naoCasaram: [],
    total: { soma: 5 },
  });
});
