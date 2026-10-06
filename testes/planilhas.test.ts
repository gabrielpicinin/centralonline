/*
 * O teste da leitura das planilhas de cada base.
 *
 * Angola não é a planilha do Brasil com outros números: a unidade está no 2º
 * nível, a data se chama "Dt. Baixa", e vários cabeçalhos têm espaço nas
 * pontas. E as duas planilhas, trocadas, seriam lidas sem erro nenhum — é
 * isso que a assinatura impede. Os casos marcados como ARMADILHA erram em
 * silêncio se a proteção for revertida: dão um número plausível e falso.
 *
 * Os arquivos são montados aqui, em Windows-1252, como o Excel brasileiro e o
 * exemplo de Angola salvam — o ordinal "º" é o byte 0xBA nos dois.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseFile,
  normalizeFinancial,
  metaAnualDaUnidade,
  PlanilhaRecusada,
  type FinancialParsed,
} from "../src/lib/parsers.ts";
import { BASES, DECLARACOES, type Base } from "../src/lib/bases.ts";

/* Windows-1252 de verdade: um byte por caractere. Só usa o que cabe nele. */
function cp1252(texto: string): Uint8Array {
  return new Uint8Array(
    [...texto].map((ch) => {
      const c = ch.charCodeAt(0);
      if (c > 0xff) throw new Error(`caractere fora do cp1252 no teste: ${ch}`);
      return c;
    }),
  );
}

async function ler(colunas: string[], linhas: string[][]) {
  const texto = [colunas, ...linhas].map((l) => l.join(";")).join("\r\n");
  return parseFile(new File([cp1252(texto)], "planilha.csv"));
}

/* ---------------------------------------------------------------- Angola */

/*
 * A forma de Angola, com os nomes que a Central conferiu no arquivo de
 * exemplo: espaço nas pontas de " Crédito ", " Débito ", " Meta ",
 * " Histórico " e das colunas "2"; sem "Dia sem"; sem "Mês Baixa" e "Ano
 * Baixa". "Plano de Contas" está aqui de propósito: tem "ano" no nome.
 */
const COLUNAS_ANGOLA = [
  "Descrição CR. 1º Nível",
  "Descrição CR. 2º Nível",
  "Descrição Nat. 2º Nível",
  "Descrição Nat. 3º Nível",
  "Descrição Nat. 4º Nível",
  "Razão Social Parceiro",
  "Plano de Contas",
  "Dt. Baixa",
  " Histórico ",
  " Meta ",
  " Crédito ",
  " Débito ",
  " Crédito 2 ",
  " Débito 2 ",
  "Nro. Único Financeiro",
];

const UNIDADES_ANGOLA = ["Central Angola Sede", "Calumbiro", "Benguela", "Tchihingui", "Mapunda"];

/** Quantas linhas cada unidade tem — proporção parecida com a do exemplo. */
const LINHAS_POR_UNIDADE: Record<string, number> = {
  "Central Angola Sede": 5,
  Calumbiro: 4,
  Benguela: 3,
  Tchihingui: 2,
  Mapunda: 2,
};

/** Metas anuais, uma coluna "Meta Anual <2º nível>" por unidade, mais o total. */
const METAS_ANGOLA: Record<string, string> = {
  "Meta Anual Central Angola Sede": "12.000.000,00",
  "Meta Anual Calumbiro": "3.000.000,00",
  "Meta Anual Benguela": "2.500.000,00",
  "Meta Anual Tchihingui": "1.000.000,00",
  "Meta Anual Mapunda": "900.000,00",
  "Meta Anual Total Geral": "19.400.000,00",
};

function linhasAngola(metas: Record<string, string>, primeiroNivel = () => "Central Angola") {
  const linhas: string[][] = [];
  let n = 0;
  for (const unidade of UNIDADES_ANGOLA) {
    for (let i = 0; i < LINHAS_POR_UNIDADE[unidade]!; i++) {
      n++;
      linhas.push([
        primeiroNivel(),
        unidade,
        "Dízimos e Ofertas",
        "Transferência",
        "Dízimo",
        `Membro ${n}`,
        "Receitas",
        // dd/mm/aaaa, como no exemplo. Meses e dias variados.
        `${String((n % 28) + 1).padStart(2, "0")}/${String((n % 9) + 1).padStart(2, "0")}/2026`,
        "Dízimo do mês",
        "",
        "150.000,00",
        "0,00",
        "150.000,00",
        "0,00",
        `AO-${n}`,
        ...Object.values(metas),
      ]);
    }
  }
  return linhas;
}

async function lerAngola(
  base: "angola" | "brasil",
  metas = METAS_ANGOLA,
  primeiroNivel?: () => string,
): Promise<FinancialParsed> {
  const brutas = await ler(
    [...COLUNAS_ANGOLA, ...Object.keys(metas)],
    linhasAngola(metas, primeiroNivel),
  );
  return normalizeFinancial(brutas, base);
}

test("ARMADILHA: a base de Angola lida pelo 2º nível produz cinco unidades, não uma", async () => {
  const lida = await lerAngola("angola");
  assert.deepEqual(
    [...new Set(lida.rows.map((r) => r.unidade))].sort(),
    [...UNIDADES_ANGOLA].sort(),
    'pelo 1º nível seria uma só: "Central Angola"',
  );
  assert.equal(lida.rows.length, 16);
  assert.equal(lida.rows.filter((r) => r.unidade === "Central Angola Sede").length, 5);
});

test('a data de Angola sai de "Dt. Baixa", em dd/mm/aaaa — e não de "Plano de Contas"', async () => {
  const lida = await lerAngola("angola");
  const primeira = lida.rows[0]!;
  // A primeira linha é a de n = 1: 02/02/2026.
  assert.equal(primeira.dia, 2);
  assert.equal(primeira.mes, 2);
  assert.equal(primeira.ano, 2026, '"Plano de Contas" tem "ano" no nome e não pode virar o ano');
  assert.ok(primeira.data instanceof Date);
  assert.ok(lida.rows.every((r) => r.ano === 2026 && r.mes >= 1 && r.mes <= 12 && r.dia >= 1));
});

test("cabeçalhos com espaço nas pontas são lidos, e não zerados", async () => {
  const lida = await lerAngola("angola");
  assert.equal(
    lida.rows.reduce((s, r) => s + r.credito, 0),
    16 * 150000,
    '" Crédito 2 " com espaços',
  );
  assert.equal(
    lida.rows.reduce((s, r) => s + r.credito1, 0),
    16 * 150000,
    '" Crédito " com espaços',
  );
});

test("as metas de Angola casam pelos nomes do 2º nível", async () => {
  const lida = await lerAngola("angola");
  assert.equal(lida.metaAnualTotalGeral, 19_400_000);
  for (const unidade of UNIDADES_ANGOLA) {
    assert.ok(metaAnualDaUnidade(lida.metaAnualPorUnidade, unidade, "angola") > 0, unidade);
  }
  assert.equal(
    metaAnualDaUnidade(lida.metaAnualPorUnidade, "Central Angola Sede", "angola"),
    12_000_000,
  );
  assert.deepEqual(lida.unidadesSemMetaExata, [], "todas têm coluna exata: nenhum aviso");
});

/* ------------------------------------------------- armadilha 7: a meta */

/*
 * A armadilha 7 vale para as duas bases: onde o casamento é exato, uma unidade
 * sem coluna de meta com o nome dela fica sem meta — nunca herda a de outra de
 * nome parecido. A única exceção é transitória e tem data: o Brasil segue com
 * a busca aproximada até a Central corrigir os cabeçalhos e reenviar a base
 * (decisão de 06/10). Nesse dia esta lista esvazia junto com `metaAproximada`
 * do Brasil, e o teste de baixo passa a cobri-lo sem ser reescrito.
 *
 * (Os testes das chaves de meta — o que o dashboard desenha com e sem meta —
 * estão em testes/metas.test.ts.)
 */
const EXCECAO_TRANSITORIA: Base[] = ["brasil"];

test("só o Brasil, e só até os cabeçalhos serem corrigidos, usa a busca aproximada de meta", () => {
  assert.deepEqual(
    BASES.filter((b) => DECLARACOES[b].metaAproximada),
    EXCECAO_TRANSITORIA,
  );
});

for (const base of BASES.filter((b) => !EXCECAO_TRANSITORIA.includes(b))) {
  test(`ARMADILHA 7 — ${DECLARACOES[base].nome}: unidade sem coluna de meta exata não herda a de nome parecido`, () => {
    /*
     * A coluna de meta da Sede nomeada pelo 1º nível — "Meta Anual Central
     * Angola" — é o erro mais fácil de cometer ao acrescentar as colunas.
     * "Central Angola" está contido em "Central Angola Sede" e é o único
     * candidato: a busca aproximada daria à Sede a meta do país inteiro.
     */
    const metas = { "Central Angola": 50_000_000, Calumbiro: 3_000_000 };
    assert.equal(metaAnualDaUnidade(metas, "Central Angola Sede", base), 0);
    assert.equal(metaAnualDaUnidade(metas, "Calumbiro", base), 3_000_000, "o nome exato vale");
  });
}

test("sem meta nenhuma na planilha, não há aviso — é o estado normal, não um problema", async () => {
  /*
   * O caso de Angola hoje. Avisar a cada envio que as cinco unidades estão sem
   * meta seria ruído: ninguém pode resolver, e o aviso ensinaria a ser ignorado.
   */
  const lida = await lerAngola("angola", {});
  assert.deepEqual(lida.metaAnualPorUnidade, {});
  assert.deepEqual(lida.unidadesSemMetaExata, []);
});

test("o aviso lista toda unidade sem coluna de meta exata — e só essas", async () => {
  const metas: Record<string, string> = { ...METAS_ANGOLA };
  delete metas["Meta Anual Mapunda"];
  delete metas["Meta Anual Benguela"];
  // Acento, maiúscula e espaço não contam como diferença; nome diferente conta.
  delete metas["Meta Anual Calumbiro"];
  metas[" META ANUAL CALUMBIRO "] = "3.000.000,00";
  const lida = await lerAngola("angola", metas);
  assert.deepEqual(lida.unidadesSemMetaExata, ["Benguela", "Mapunda"]);
});

/* ------------------------------------------ armadilha 8: arquivo trocado */

test("ARMADILHA: o arquivo de Angola no lugar do Brasil é RECUSADO, com motivo", async () => {
  await assert.rejects(lerAngola("brasil"), (e: unknown) => {
    assert.ok(e instanceof PlanilhaRecusada);
    assert.match(e.message, /não pode entrar na base Brasil/);
    assert.match(e.message, /16 de 16 lançamentos têm "Central Angola"/);
    assert.match(e.message, /Nada foi enviado/);
    return true;
  });
});

/*
 * O arquivo do Brasil, na forma real: unidade no 1º nível, "Data", "Dia sem",
 * as colunas "2" com espaço. Tem também o 2º nível — e é por isso que a
 * presença dele não serve de assinatura.
 */
const COLUNAS_BRASIL = [
  "Data",
  "Dia sem",
  "Descrição CR. 1º Nível",
  "Descrição CR. 2º Nível",
  "Descrição Nat. 2º Nível",
  "Descrição Nat. 3º Nível",
  "Descrição Nat. 4º Nível",
  "Dia Baixa",
  "Mês Baixa",
  "Ano Baixa",
  " Crédito 2 ",
  " Débito 2 ",
  " Crédito ",
  " Débito ",
  "Nro. Único Financeiro",
  "Meta Anual Central Picos",
  "Meta Anual Central Picos - Missão",
  "Meta Anual Total Geral",
];

function linhaBrasil(unidade: string, i: number) {
  return [
    `0${(i % 9) + 1}/03/2026`,
    "seg",
    unidade,
    "Templo",
    "Dízimos e Ofertas",
    "Gazofilácio",
    "Dízimo",
    String((i % 9) + 1),
    "3",
    "2026",
    "1.000,00",
    "0,00",
    "1.000,00",
    "0,00",
    `BR-${i}`,
    "900.000,00",
    "0,00",
    "900.000,00",
  ];
}

const UNIDADES_BRASIL = ["Central Picos", "Central Picos - Missões", "Central Luxemburgo"];

async function lerBrasil(base: "angola" | "brasil", extras: string[][] = []) {
  const linhas = UNIDADES_BRASIL.flatMap((u, k) => [0, 1, 2].map((i) => linhaBrasil(u, k * 3 + i)));
  return normalizeFinancial(await ler(COLUNAS_BRASIL, [...linhas, ...extras]), base);
}

test("ARMADILHA: o arquivo do Brasil no lugar de Angola é RECUSADO, com motivo", async () => {
  await assert.rejects(lerBrasil("angola"), (e: unknown) => {
    assert.ok(e instanceof PlanilhaRecusada);
    assert.match(e.message, /não pode entrar na base Angola/);
    assert.match(e.message, /9 de 9 lançamentos não têm "Central Angola"/);
    assert.match(e.message, /"Central Picos", "Central Picos - Missões", "Central Luxemburgo"/);
    return true;
  });
});

test("Angola com UMA linha de outra unidade de 1º nível também é recusada", async () => {
  let n = 0;
  await assert.rejects(
    lerAngola("angola", METAS_ANGOLA, () => (++n === 7 ? "Central Sede" : "Central Angola")),
    /1 de 16 lançamentos não têm "Central Angola"/,
  );
});

test("o Brasil continua lendo a unidade do 1º nível, e o 2º não interfere", async () => {
  const lida = await lerBrasil("brasil");
  assert.deepEqual(
    [...new Set(lida.rows.map((r) => r.unidade))].sort(),
    [...UNIDADES_BRASIL].sort(),
  );
  // Mês e ano vêm de "Mês Baixa" e "Ano Baixa", como sempre vieram no Brasil.
  assert.ok(lida.rows.every((r) => r.mes === 3 && r.ano === 2026));
});

test("linha em branco no arquivo não conta para a assinatura", async () => {
  // O arquivo do Brasil tem cinco assim: 1º nível vazio, nenhum valor.
  const branca = linhaBrasil("", 99).map((v, i) => (i >= 10 && i <= 13 ? "" : v));
  assert.equal((await lerBrasil("brasil", [branca])).rows.length, 9);

  /*
   * Em Angola, onde TODA linha precisa da marca, é aqui que importa: uma linha
   * vazia no fim da exportação recusaria um arquivo bom.
   */
  const colunas = [...COLUNAS_ANGOLA, ...Object.keys(METAS_ANGOLA)];
  const brutas = await ler(colunas, [...linhasAngola(METAS_ANGOLA), colunas.map(() => "")]);
  assert.equal(normalizeFinancial(brutas, "angola").rows.length, 16);
});

/* --------------------------------------------------- colunas que faltam */

test('sem a coluna de data declarada, e sem "Mês Baixa" e "Ano Baixa", a planilha é recusada', async () => {
  /*
   * Antes, a busca por "contém" acharia outra coluna com "data" no nome e
   * seguiria em frente. Aqui há uma "Data Emissão" de isca: ela não pode ser
   * aceita no lugar de "Dt. Baixa".
   */
  const colunas = COLUNAS_ANGOLA.map((c) => (c === "Dt. Baixa" ? "Data Emissão" : c));
  const brutas = await ler([...colunas, ...Object.keys(METAS_ANGOLA)], linhasAngola(METAS_ANGOLA));
  assert.throws(
    () => normalizeFinancial(brutas, "angola"),
    (e: unknown) => {
      assert.ok(e instanceof PlanilhaRecusada);
      assert.match(e.message, /Falta a coluna "Dt\. Baixa" na planilha financeira da base Angola/);
      return true;
    },
  );
});

test("a mensagem lista TODAS as colunas que faltam, de uma vez", async () => {
  const sem = new Set([" Crédito 2 ", " Débito ", "Descrição CR. 2º Nível"]);
  const indices = COLUNAS_ANGOLA.map((c, i) => (sem.has(c) ? -1 : i)).filter((i) => i >= 0);
  const brutas = await ler(
    indices.map((i) => COLUNAS_ANGOLA[i]!),
    linhasAngola({}).map((l) => indices.map((i) => l[i]!)),
  );
  assert.throws(
    () => normalizeFinancial(brutas, "angola"),
    /Faltam as colunas "Descrição CR\. 2º Nível", "Crédito 2", "Débito"/,
  );
});
