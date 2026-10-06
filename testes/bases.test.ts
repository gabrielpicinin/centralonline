/*
 * O teste que guarda a separação entre as duas bases, Brasil e Angola.
 *
 * As duas moram no mesmo banco, nas mesmas tabelas, e passam pela mesma porta
 * de leitura. O que as separa é um critério a mais em cada consulta — e um
 * critério esquecido não dá erro: dá dado do país errado na tela, ou dado
 * nenhum, sem aviso. Este arquivo existe para falhar no dia em que alguém tirar
 * a base de uma dessas consultas.
 *
 * Os casos marcados como ARMADILHA são os que o código antigo, de uma base só,
 * erraria em silêncio. Cada um deles foi conferido sabotando o código de
 * propósito: com a base removida da consulta, o teste falha.
 *
 * O caminho testado é o de carregarBaseServer: as unidades do pastor são lidas
 * DENTRO da base pedida (unidadesDoPerfil) e só então a porta única de leitura
 * é chamada (lerBase). É o que unidadesDaSessao faz, menos o cookie.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Base } from "../src/lib/bases.ts";

/* Ver recorte.test.ts: a pasta do banco tem de existir antes do import. */
const PASTA = mkdtempSync(join(tmpdir(), "central-bases-"));
process.env.DADOS_DIR = PASTA;

type Banco = typeof import("../src/lib/banco.server.ts");
type Lida = ReturnType<Banco["lerBase"]>;
let banco: Banco;

/*
 * "Central Sede" existe nas duas, de propósito: o recorte casa por nome, e é
 * exatamente o nome repetido que um critério de base esquecido deixaria vazar.
 */
const UNIDADES: Record<Base, string[]> = {
  brasil: ["Central Sede", "Central Picos", "Central Norte"],
  angola: ["Central Sede", "Calumbiro", "Benguela"],
};

/*
 * Cada base tem valores próprios, e cada lançamento leva a base no número
 * único. Assim uma linha fora do lugar se denuncia sozinha — sem depender do
 * nome da unidade, que é justamente o que se repete entre as duas.
 */
const CREDITO: Record<Base, number> = { brasil: 100, angola: 7 };
const MEMBROS: Record<Base, number> = { brasil: 1000, angola: 40 };
const META: Record<Base, number> = { brasil: 30, angola: 999 };
const LINHAS_POR_UNIDADE = 10;

function lancamentos(base: Base, rotulo: string) {
  return UNIDADES[base].flatMap((unidade) =>
    Array.from({ length: LINHAS_POR_UNIDADE }, (_, i) => ({
      unidade,
      nat2: "Dízimos e Ofertas",
      nat3: "PIX",
      nat4: "Dízimo",
      razaoSocial: `P${i}`,
      projeto: "",
      meta: "",
      credito: CREDITO[base],
      credito1: CREDITO[base],
      debito: 0,
      debito1: 0,
      data: null,
      dia: i + 1,
      mes: 1,
      ano: 2026,
      nroUnico: `${base}:${rotulo}:${unidade}:${i}`,
    })),
  );
}

/** Uma carga completa de uma base — lançamentos, membresia, saldos e metas. */
function carregar(base: Base, rotulo: string, { finalizar = true } = {}): number {
  const cargaId = banco.iniciarCarga(base, [`${base}-${rotulo}.csv`], "Financeiro");
  const unidades = UNIDADES[base];
  banco.gravarLancamentos(cargaId, lancamentos(base, rotulo) as never);
  banco.gravarMembresia(
    cargaId,
    [...unidades, "Total Geral"].map((unidade) => ({
      unidade,
      meses: {
        "jan/26": unidade === "Total Geral" ? MEMBROS[base] * unidades.length : MEMBROS[base],
      },
    })),
  );
  banco.gravarSaldos(
    cargaId,
    unidades.map((unidade) => ({
      unidade,
      periodo: "Atual",
      quando: "atual" as const,
      saldo: CREDITO[base],
    })),
  );
  banco.gravarMetas(
    cargaId,
    Object.fromEntries(unidades.map((u) => [u, META[base]])),
    META[base] * unidades.length,
  );
  if (finalizar) banco.finalizarCarga(cargaId);
  return cargaId;
}

/** O que um pastor recebe ao pedir uma base — ver o comentário do topo. */
function oQueOPastorRecebe(perfilId: number, base: Base): Lida {
  return banco.lerBase(base, banco.unidadesDoPerfil(perfilId, base));
}

/** De quais bases vieram os lançamentos — pelo número único, nunca pelo nome. */
function origemDasLinhas(lida: Lida): string[] {
  return [...new Set(lida.financial.map((r) => r.nroUnico.split(":")[0]))].sort();
}

function unidadesNoResultado(lida: Lida): string[] {
  return [
    ...new Set([
      ...lida.financial.map((r) => r.unidade),
      ...lida.membership.map((r) => r.unidade),
      ...lida.saldo.map((r) => r.unidade),
      ...Object.keys(lida.metaAnualPorUnidade),
    ]),
  ].sort();
}

/*
 * Vazio de verdade: nenhuma linha em tabela nenhuma, nenhuma meta — e nem a
 * carga, que diria quando a base foi enviada, por quem e com quantas linhas.
 */
function assertVazia(lida: Lida, mensagem: string) {
  assert.deepEqual(lida.financial, [], mensagem);
  assert.deepEqual(lida.membership, [], mensagem);
  assert.deepEqual(lida.saldo, [], mensagem);
  assert.deepEqual(lida.metaAnualPorUnidade, {}, mensagem);
  assert.equal(lida.metaAnualTotalGeral, 0, mensagem);
  assert.equal(lida.carga, null, mensagem);
}

/*
 * Para OBSERVAR o banco quando nenhuma função do app responde à pergunta —
 * "quais cargas desta base sobraram?". Só leitura, numa conexão à parte. O app
 * continua com SQL num arquivo só; o teste precisa olhar por baixo para provar
 * que a poda de fato aconteceu, senão passaria sem ter testado nada.
 */
function cargasNoBanco(base: Base): { id: number; ativa: number; concluida: number }[] {
  const db = new DatabaseSync(join(PASTA, "central.db"), { readOnly: true });
  try {
    return db
      .prepare("SELECT id, ativa, concluida FROM cargas WHERE base = ? ORDER BY id")
      .all(base) as { id: number; ativa: number; concluida: number }[];
  } finally {
    db.close();
  }
}

let soBrasil: number;
let soAngola: number;
let ambas: number;
let semNada: number;

before(async () => {
  banco = await import("../src/lib/banco.server.ts");

  const pastor = (usuario: string) =>
    banco.criarPerfil({ usuario, nome: usuario, papel: "pastor", senhaHash: "x" }).id;
  soBrasil = pastor("so-brasil@central.org");
  soAngola = pastor("so-angola@central.org");
  ambas = pastor("ambas@central.org");
  semNada = pastor("sem-nada@central.org");

  banco.salvarPermissoes([
    // O mesmo nome nas duas bases, para pastores diferentes.
    { perfilId: soBrasil, base: "brasil", unidades: ["Central Sede"] },
    { perfilId: soAngola, base: "angola", unidades: ["Central Sede"] },
    { perfilId: ambas, base: "brasil", unidades: ["Central Picos"] },
    { perfilId: ambas, base: "angola", unidades: ["Benguela"] },
  ]);

  // Só o Brasil por enquanto: o primeiro teste olha Angola antes do primeiro envio.
  carregar("brasil", "jan");
});

after(() => {
  // Fecha antes de apagar: no Windows o arquivo aberto não é removível.
  banco.fechar();
  rmSync(PASTA, { recursive: true, force: true });
});

test("Angola antes do primeiro envio: vazia para todos, inclusive o administrador, sem erro", () => {
  assertVazia(banco.lerBase("angola", null), "administrador");
  assertVazia(oQueOPastorRecebe(soAngola, "angola"), "pastor de Angola");
  assert.equal(banco.cargaAtiva("angola"), null);
  assert.deepEqual(banco.listarUnidades("angola"), []);

  // E o Brasil segue inteiro ao lado.
  assert.equal(banco.lerBase("brasil", null).financial.length, 3 * LINHAS_POR_UNIDADE);
});

test("subir Angola não desativa o Brasil", () => {
  const brasilAntes = banco.cargaAtiva("brasil");
  carregar("angola", "jan");

  assert.equal(banco.cargaAtiva("brasil")?.id, brasilAntes?.id, "a carga do Brasil continua ativa");
  assert.equal(banco.cargaAtiva("angola")?.base, "angola");
  assert.deepEqual(origemDasLinhas(banco.lerBase("brasil", null)), ["brasil"]);
  assert.deepEqual(origemDasLinhas(banco.lerBase("angola", null)), ["angola"]);
});

test("cada base lista só as próprias unidades", () => {
  assert.deepEqual(banco.listarUnidades("brasil"), [
    "Central Norte",
    "Central Picos",
    "Central Sede",
  ]);
  assert.deepEqual(banco.listarUnidades("angola"), ["Benguela", "Calumbiro", "Central Sede"]);
});

test("o administrador vê cada base inteira, e nunca as duas juntas", () => {
  const brasil = banco.lerBase("brasil", null);
  const angola = banco.lerBase("angola", null);

  assert.deepEqual(origemDasLinhas(brasil), ["brasil"]);
  assert.deepEqual(origemDasLinhas(angola), ["angola"]);
  assert.equal(brasil.financial.length, 3 * LINHAS_POR_UNIDADE);
  assert.equal(angola.financial.length, 3 * LINHAS_POR_UNIDADE);

  // O consolidado de cada uma é o dela: nenhuma soma entre países.
  assert.equal(brasil.metaAnualTotalGeral, META.brasil * 3);
  assert.equal(angola.metaAnualTotalGeral, META.angola * 3);
  assert.equal(brasil.carga?.base, "brasil");
  assert.equal(angola.carga?.base, "angola");
});

test("pastor só com Brasil pedindo Angola recebe vazio — não erro, e não dados", () => {
  let lida: Lida | undefined;
  assert.doesNotThrow(() => {
    lida = oQueOPastorRecebe(soBrasil, "angola");
  });
  assertVazia(lida!, "pastor só do Brasil pedindo Angola");

  // E o Brasil dele continua chegando.
  const brasil = oQueOPastorRecebe(soBrasil, "brasil");
  assert.deepEqual(origemDasLinhas(brasil), ["brasil"]);
  assert.deepEqual(unidadesNoResultado(brasil), ["Central Sede"]);
});

test("pastor só com Angola pedindo Brasil recebe vazio", () => {
  assertVazia(oQueOPastorRecebe(soAngola, "brasil"), "pastor só de Angola pedindo o Brasil");

  const angola = oQueOPastorRecebe(soAngola, "angola");
  assert.deepEqual(origemDasLinhas(angola), ["angola"]);
  assert.deepEqual(unidadesNoResultado(angola), ["Central Sede"]);
});

test("pastor com as duas recebe o certo em cada pedido, nunca as duas juntas", () => {
  const brasil = oQueOPastorRecebe(ambas, "brasil");
  assert.deepEqual(origemDasLinhas(brasil), ["brasil"]);
  assert.deepEqual(unidadesNoResultado(brasil), ["Central Picos"]);
  assert.equal(brasil.financial.length, LINHAS_POR_UNIDADE);
  assert.equal(brasil.metaAnualTotalGeral, META.brasil);
  assert.equal(brasil.carga?.base, "brasil");

  const angola = oQueOPastorRecebe(ambas, "angola");
  assert.deepEqual(origemDasLinhas(angola), ["angola"]);
  assert.deepEqual(unidadesNoResultado(angola), ["Benguela"]);
  assert.equal(angola.financial.length, LINHAS_POR_UNIDADE);
  assert.equal(angola.metaAnualTotalGeral, META.angola);
  assert.equal(angola.carga?.base, "angola");
});

test("ARMADILHA: unidade de mesmo nome nas duas bases não vaza de uma para a outra", () => {
  /*
   * O pastor do Brasil tem "Central Sede" — e Angola também tem uma. Se a base
   * saísse da consulta de permissões, o pedido de Angola dele traria a "Central
   * Sede" de lá; se saísse da leitura, o pedido do Brasil traria as duas.
   */
  const brasil = oQueOPastorRecebe(soBrasil, "brasil");
  assert.deepEqual(origemDasLinhas(brasil), ["brasil"]);
  assert.equal(brasil.financial.length, LINHAS_POR_UNIDADE);
  assert.equal(
    brasil.financial.reduce((s, r) => s + r.credito, 0),
    CREDITO.brasil * LINHAS_POR_UNIDADE,
  );
  assert.equal(
    brasil.metaAnualTotalGeral,
    META.brasil,
    "a meta é a do Brasil, não a soma das duas",
  );
  assert.deepEqual(
    brasil.membership.map((r) => r.meses["jan/26"]),
    [MEMBROS.brasil],
  );
  assert.deepEqual(
    brasil.saldo.map((r) => r.saldo),
    [CREDITO.brasil],
  );
  assertVazia(oQueOPastorRecebe(soBrasil, "angola"), "a Sede de Angola não é do pastor do Brasil");

  // O mesmo do outro lado.
  const angola = oQueOPastorRecebe(soAngola, "angola");
  assert.deepEqual(origemDasLinhas(angola), ["angola"]);
  assert.equal(angola.metaAnualTotalGeral, META.angola);
  assertVazia(oQueOPastorRecebe(soAngola, "brasil"), "a Sede do Brasil não é do pastor de Angola");

  // E na porta de leitura, direto: o nome casa dentro da base pedida, só nela.
  assert.deepEqual(origemDasLinhas(banco.lerBase("angola", ["Central Sede"])), ["angola"]);
  assert.deepEqual(origemDasLinhas(banco.lerBase("brasil", ["Central Sede"])), ["brasil"]);
});

test("ter acesso a uma base é ter ao menos uma unidade nela", () => {
  assert.deepEqual(banco.basesDoPerfil(soBrasil), ["brasil"]);
  assert.deepEqual(banco.basesDoPerfil(soAngola), ["angola"]);
  assert.deepEqual(banco.basesDoPerfil(ambas), ["brasil", "angola"]);
  assert.deepEqual(banco.basesDoPerfil(semNada), [], "sem unidade nenhuma, sem base nenhuma");

  const ambasNaLista = banco.listarPastores().find((p) => p.id === ambas);
  assert.deepEqual(ambasNaLista?.unidadesPorBase, {
    brasil: ["Central Picos"],
    angola: ["Benguela"],
  });
});

test("ARMADILHA: salvar as unidades do Brasil de um pastor não apaga as de Angola dele", () => {
  banco.salvarPermissoes([{ perfilId: ambas, base: "brasil", unidades: ["Central Norte"] }]);
  assert.deepEqual(banco.unidadesDoPerfil(ambas, "brasil"), ["Central Norte"]);
  assert.deepEqual(
    banco.unidadesDoPerfil(ambas, "angola"),
    ["Benguela"],
    "Angola fica como estava",
  );

  // Tirar todas as do Brasil tira o acesso ao Brasil — e só a ele.
  banco.salvarPermissoes([{ perfilId: ambas, base: "brasil", unidades: [] }]);
  assert.deepEqual(banco.basesDoPerfil(ambas), ["angola"]);
  assertVazia(oQueOPastorRecebe(ambas, "brasil"), "sem unidade no Brasil, o Brasil vem vazio");
  assert.deepEqual(origemDasLinhas(oQueOPastorRecebe(ambas, "angola")), ["angola"]);

  // De volta ao começo, para os testes seguintes.
  banco.salvarPermissoes([{ perfilId: ambas, base: "brasil", unidades: ["Central Picos"] }]);
  assert.deepEqual(banco.basesDoPerfil(ambas), ["brasil", "angola"]);
});

test("permissão órfã é conferida dentro da própria base", () => {
  /*
   * "Central Norte" só existe no Brasil, e "Calumbiro" só em Angola. Liberadas
   * na base errada, as duas são órfãs — e uma conferência contra as unidades
   * das duas bases somadas esconderia ambas.
   */
  banco.salvarPermissoes([
    { perfilId: semNada, base: "angola", unidades: ["Central Norte"] },
    { perfilId: semNada, base: "brasil", unidades: ["Calumbiro"] },
  ]);
  const orfasDele = banco
    .permissoesOrfas()
    .filter((o) => o.perfilId === semNada)
    .map((o) => `${o.base}/${o.unidade}`)
    .sort();
  assert.deepEqual(orfasDele, ["angola/Central Norte", "brasil/Calumbiro"]);

  // E nenhuma das permissões legítimas aparece como órfã.
  assert.deepEqual(
    banco.permissoesOrfas().filter((o) => o.perfilId !== semNada),
    [],
  );

  banco.salvarPermissoes([
    { perfilId: semNada, base: "angola", unidades: [] },
    { perfilId: semNada, base: "brasil", unidades: [] },
  ]);
});

test("ARMADILHA: finalizar carga do Brasil não desativa a carga de Angola", () => {
  const angolaAntes = banco.cargaAtiva("angola");
  assert.ok(angolaAntes);

  const nova = carregar("brasil", "fev");

  assert.equal(banco.cargaAtiva("brasil")?.id, nova, "a nova do Brasil é a ativa do Brasil");
  assert.equal(banco.cargaAtiva("angola")?.id, angolaAntes.id, "e a de Angola continua ativa");
  const angola = banco.lerBase("angola", null);
  assert.equal(angola.financial.length, 3 * LINHAS_POR_UNIDADE);
  assert.deepEqual(origemDasLinhas(angola), ["angola"]);
});

test("ARMADILHA: podar cargas do Brasil não apaga a carga de Angola, nem os lançamentos dela", () => {
  /*
   * A carga de Angola é MAIS ANTIGA que as duas do Brasil que a poda vai
   * manter — é o que a põe na mira de uma poda que não olhe a base. As duas
   * vagas são por base: o Brasil fica com as duas últimas dele, e a de Angola
   * não conta, nem é contada.
   */
  const angola = banco.cargaAtiva("angola")!;
  const brasilAntes = cargasNoBanco("brasil").map((c) => c.id);
  assert.equal(brasilAntes.length, 2, "começa com duas do Brasil: jan e fev");
  assert.ok(angola.id < brasilAntes[1]!, "a de Angola é mais antiga que a de fevereiro");

  const marco = carregar("brasil", "mar");

  // A poda aconteceu de fato — sem isto, o teste passaria sem testar nada.
  assert.deepEqual(
    cargasNoBanco("brasil").map((c) => c.id),
    [brasilAntes[1], marco],
    "o Brasil fica com as duas últimas dele",
  );

  assert.deepEqual(
    cargasNoBanco("angola").map((c) => c.id),
    [angola.id],
    "a carga de Angola continua lá",
  );
  assert.equal(banco.cargaAtiva("angola")?.id, angola.id);
  const lida = banco.lerBase("angola", null);
  assert.equal(lida.financial.length, 3 * LINHAS_POR_UNIDADE, "com todos os lançamentos");
  assert.equal(lida.membership.length, 4, "a membresia (três unidades e o Total Geral)");
  assert.equal(lida.saldo.length, 3, "os saldos");
  assert.equal(lida.metaAnualTotalGeral, META.angola * 3, "e as metas");
});

test("ARMADILHA: envio de Angola em andamento sobrevive à poda de um envio do Brasil", () => {
  /*
   * A poda também apaga as cargas INACABADAS anteriores à última — as de um
   * envio que morreu no meio. Sem a base nessa conta, um envio de Angola ainda
   * gravando seria tomado por lixo e apagado no instante em que o Brasil
   * terminasse o dele.
   */
  const angolaAtiva = banco.cargaAtiva("angola")!;
  const emAndamento = carregar("angola", "fev", { finalizar: false });

  carregar("brasil", "abr");

  assert.ok(
    cargasNoBanco("angola").some((c) => c.id === emAndamento),
    "o envio de Angola em andamento continua no banco",
  );
  assert.equal(banco.cargaAtiva("angola")?.id, angolaAtiva.id, "e a ativa de Angola não mudou");

  // Ele termina normalmente, e o Brasil não sente nada.
  const brasilAtiva = banco.cargaAtiva("brasil")!;
  banco.finalizarCarga(emAndamento);
  assert.equal(banco.cargaAtiva("angola")?.id, emAndamento);
  assert.equal(banco.lerBase("angola", null).financial.length, 3 * LINHAS_POR_UNIDADE);
  assert.equal(banco.cargaAtiva("brasil")?.id, brasilAtiva.id);
  assert.equal(cargasNoBanco("brasil").length, 2);
});
