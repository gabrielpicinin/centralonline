/*
 * O teste da migração para duas bases.
 *
 * O banco do servidor tem dados reais, e a migração roda sozinha no primeiro
 * acesso depois da atualização. A regra é: idempotente, e nenhuma linha
 * perdida. Este arquivo prova as duas coisas, em vez de pedir que se acredite.
 *
 * Como: monta bancos com os esquemas ANTIGOS, cheios de dados, e os abre com o
 * código atual — exatamente o que vai acontecer no servidor. A impressão
 * digital de cada tabela (ferramentas/impressao-digital.mjs), antes e depois,
 * tem de ser idêntica; e cada pastor tem de continuar vendo exatamente as
 * mesmas linhas que via antes.
 *
 * ENSAIO NUM BANCO DE VERDADE. Com ENSAIO_BANCO apontando para um arquivo .db,
 * o mesmo roteiro roda numa CÓPIA dele. O arquivo apontado só é aberto para
 * leitura — e o teste confere, no fim, que ele não mudou. No PowerShell:
 *
 *   $env:ENSAIO_BANCO = "C:\caminho\do\backup.db"
 *   node --test testes/migracao.test.ts
 *   Remove-Item Env:ENSAIO_BANCO
 *
 * O SQL deste arquivo só existe para montar os bancos antigos e para OLHAR
 * por baixo do app. O app continua com SQL num arquivo só.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  impressaoDigital,
  colunasDe,
  comparar,
  descrever,
} from "../ferramentas/impressao-digital.mjs";

/* Ver recorte.test.ts: a pasta do banco tem de existir antes do import. */
const PASTA = mkdtempSync(join(tmpdir(), "central-migracao-"));
process.env.DADOS_DIR = PASTA;
const ARQUIVO = join(PASTA, "central.db");

type Banco = typeof import("../src/lib/banco.server.ts");
let banco: Banco;

before(async () => {
  banco = await import("../src/lib/banco.server.ts");
});

after(() => {
  banco.fechar();
  rmSync(PASTA, { recursive: true, force: true });
});

/** Fecha o app e apaga o banco, para o próximo cenário começar do zero. */
function limpar() {
  banco.fechar();
  for (const sufixo of ["", "-wal", "-shm"]) rmSync(ARQUIVO + sufixo, { force: true });
}

/*
 * Os esquemas antigos, CONGELADOS como estavam no git. Não atualize: o ponto é
 * justamente que eles não acompanham o código. O banco do servidor foi criado
 * por uma versão antiga e, desde então, só recebeu ALTERs — então é com a
 * forma antiga que a migração vai se encontrar.
 *
 * São três, e só diferem em duas linhas (conferido com git diff):
 *   - 810a26e, a Fase 4: cargas ainda sem `concluida`;
 *   - 0befc37 até 393222d: com `concluida`, e perfis sem as colunas de senha;
 *   - 4f27256 até 48d2d94: o que está em produção hoje.
 */
interface Versao {
  nome: string;
  concluida: boolean;
  colunasDeSenha: boolean;
}

const VERSOES: Versao[] = [
  { nome: "810a26e (cargas sem concluida)", concluida: false, colunasDeSenha: false },
  { nome: "0befc37 (perfis sem as colunas de senha)", concluida: true, colunasDeSenha: false },
  { nome: "48d2d94 (o de produção)", concluida: true, colunasDeSenha: true },
];
const PRODUCAO = VERSOES[2]!;

function esquemaAntigo(v: Versao): string {
  return `
    CREATE TABLE IF NOT EXISTS cargas (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      enviada_em  TEXT    NOT NULL,
      enviada_por TEXT,
      arquivos    TEXT,
      ativa       INTEGER NOT NULL DEFAULT 0,
      ${v.concluida ? "concluida   INTEGER NOT NULL DEFAULT 0," : ""}
      linhas      INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS lancamentos (
      carga_id     INTEGER NOT NULL REFERENCES cargas(id) ON DELETE CASCADE,
      unidade      TEXT    NOT NULL,
      nat2         TEXT,
      nat3         TEXT,
      nat4         TEXT,
      razao_social TEXT,
      projeto      TEXT,
      meta         TEXT,
      credito      REAL,
      credito1     REAL,
      debito       REAL,
      debito1      REAL,
      data         TEXT,
      dia          INTEGER,
      mes          INTEGER,
      ano          INTEGER,
      nro_unico    TEXT
    );

    CREATE TABLE IF NOT EXISTS membresia (
      carga_id INTEGER NOT NULL REFERENCES cargas(id) ON DELETE CASCADE,
      unidade  TEXT    NOT NULL,
      meses    TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS saldos (
      carga_id INTEGER NOT NULL REFERENCES cargas(id) ON DELETE CASCADE,
      unidade  TEXT    NOT NULL,
      periodo  TEXT,
      quando   TEXT,
      saldo    REAL
    );

    CREATE TABLE IF NOT EXISTS metas (
      carga_id INTEGER NOT NULL REFERENCES cargas(id) ON DELETE CASCADE,
      unidade  TEXT    NOT NULL,
      anual    REAL    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS unidades (
      nome      TEXT PRIMARY KEY,
      vista_em  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS perfis (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      chave      TEXT    NOT NULL UNIQUE,
      usuario    TEXT    NOT NULL,
      nome       TEXT    NOT NULL,
      papel      TEXT    NOT NULL CHECK (papel IN ('admin', 'pastor')),
      senha_hash TEXT    NOT NULL,
      ativo      INTEGER NOT NULL DEFAULT 1,
      criado_em  TEXT    NOT NULL${
        v.colunasDeSenha
          ? `,
      ultimo_acesso TEXT,
      senha_cifrada TEXT`
          : ""
      }
    );

    CREATE TABLE IF NOT EXISTS permissoes (
      perfil_id INTEGER NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
      unidade   TEXT    NOT NULL,
      PRIMARY KEY (perfil_id, unidade)
    );

    CREATE INDEX IF NOT EXISTS ix_lanc_carga    ON lancamentos(carga_id);
    CREATE INDEX IF NOT EXISTS ix_lanc_unidade  ON lancamentos(carga_id, unidade);
    CREATE INDEX IF NOT EXISTS ix_memb_carga    ON membresia(carga_id);
    CREATE INDEX IF NOT EXISTS ix_saldo_carga   ON saldos(carga_id);
    CREATE INDEX IF NOT EXISTS ix_metas_carga   ON metas(carga_id);
  `;
}

/*
 * Os dados. Acento, apóstrofo, nulo e centavo de propósito: é onde uma cópia
 * de tabela mal feita trocaria um valor sem mudar a contagem.
 */
const UNIDADES = ["Central Sede", "Central Missões", "Central Picos - Missões", "Central D'Ajuda"];

const PASTOR_A = 2;
const PASTOR_B = 3;
const PASTOR_INATIVO = 4;

/** Insere uma linha usando só as colunas que a versão antiga tinha. */
function inserir(db: DatabaseSync, tabela: string, linha: Record<string, string | number | null>) {
  const existentes = new Set(
    (db.prepare(`PRAGMA table_info(${tabela})`).all() as { name: string }[]).map((r) => r.name),
  );
  const colunas = Object.keys(linha).filter((c) => existentes.has(c));
  db.prepare(
    `INSERT INTO ${tabela} (${colunas.join(", ")}) VALUES (${colunas.map(() => "?").join(", ")})`,
  ).run(...colunas.map((c) => linha[c]!));
}

function montarBancoAntigo(v: Versao, { permissaoOrfa = false } = {}) {
  const db = new DatabaseSync(ARQUIVO);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(esquemaAntigo(v));

  db.exec("BEGIN");
  // Uma concluída e já substituída, a ativa, e um envio que morreu no meio.
  const cargas = [
    { id: 1, enviada_em: "2026-08-03T12:00:00.000Z", ativa: 0, concluida: 1, linhas: 40 },
    { id: 2, enviada_em: "2026-09-02T12:00:00.000Z", ativa: 1, concluida: 1, linhas: 40 },
    { id: 3, enviada_em: "2026-09-20T12:00:00.000Z", ativa: 0, concluida: 0, linhas: 0 },
  ];
  for (const c of cargas) {
    inserir(db, "cargas", {
      ...c,
      enviada_por: "Financeiro",
      arquivos: JSON.stringify([`FINANCEIRO ${c.id}.csv`, "MEMBRESIA.csv"]),
    });
    const quantas = c.id === 3 ? 7 : 10;
    for (const unidade of UNIDADES) {
      for (let i = 0; i < quantas; i++) {
        inserir(db, "lancamentos", {
          carga_id: c.id,
          unidade,
          nat2: "Dízimos e Ofertas",
          nat3: i % 2 ? "PIX" : "Gazofilácio",
          nat4: "Dízimo",
          razao_social: i % 3 ? `Membro ${i}` : null,
          projeto: "",
          meta: i === 0 ? "Investimentos em Ativos" : "",
          credito: 1234.56 * (i + 1) + c.id,
          credito1: 1234.56 * (i + 1),
          debito: i % 4 ? 0 : 99.99,
          debito1: i % 4 ? 0 : 89.9,
          data: i % 2 ? null : `2026-0${(i % 8) + 1}-1${i}T03:00:00.000Z`,
          dia: i + 1,
          mes: (i % 8) + 1,
          ano: 2026,
          nro_unico: `${c.id}-${unidade}-${i}`,
        });
      }
      if (c.id === 3) continue; // o envio quebrado não chegou à membresia
      inserir(db, "membresia", {
        carga_id: c.id,
        unidade,
        meses: JSON.stringify({ "jan/26": 120 + c.id, "fev/26": 125 }),
      });
      inserir(db, "saldos", {
        carga_id: c.id,
        unidade,
        periodo: "Atual",
        quando: "atual",
        saldo: 1000.5,
      });
      inserir(db, "saldos", {
        carga_id: c.id,
        unidade,
        periodo: "jan/26",
        quando: "2026-01",
        saldo: 900.25,
      });
      inserir(db, "metas", { carga_id: c.id, unidade, anual: 120000 * c.id });
    }
    if (c.id === 3) continue;
    inserir(db, "membresia", { carga_id: c.id, unidade: "Total Geral", meses: '{"jan/26":500}' });
    inserir(db, "saldos", {
      carga_id: c.id,
      unidade: "Central Sede",
      periodo: "???",
      quando: null,
      saldo: 0,
    });
    inserir(db, "metas", { carga_id: c.id, unidade: "__total_geral__", anual: 999999.99 });
  }

  for (const nome of [...UNIDADES, "Central Fechada"]) {
    inserir(db, "unidades", { nome, vista_em: "2026-09-02T12:00:00.000Z" });
  }

  const perfil = (id: number, usuario: string, papel: string, ativo = 1) =>
    inserir(db, "perfis", {
      id,
      chave: usuario.toLowerCase(),
      usuario,
      nome: `Nome de ${usuario}`,
      papel,
      senha_hash: `scrypt$sal$${id}`,
      ativo,
      criado_em: "2026-09-01T12:00:00.000Z",
      ultimo_acesso: id === PASTOR_A ? "2026-09-30T18:00:00.000Z" : null,
      senha_cifrada: papel === "pastor" ? `v1:cifrada:${id}` : null,
    });
  perfil(1, "Financeiro", "admin");
  perfil(PASTOR_A, "pastor.a@central.org", "pastor");
  perfil(PASTOR_B, "pastor.b@central.org", "pastor");
  perfil(PASTOR_INATIVO, "pastor.c@central.org", "pastor", 0);

  for (const [perfilId, unidade] of [
    [PASTOR_A, "Central Sede"],
    [PASTOR_A, "Central Missões"],
    [PASTOR_B, "Central Picos - Missões"],
    [PASTOR_B, "Central Fechada"], // unidade que saiu da base: permissão órfã por nome
    [PASTOR_INATIVO, "Central D'Ajuda"],
  ] as const) {
    inserir(db, "permissoes", { perfil_id: perfilId, unidade });
  }
  db.exec("COMMIT");

  if (permissaoOrfa) {
    /*
     * Uma permissão de um perfil que não existe — o rastro de alguém que apagou
     * um perfil à mão no SQLite de linha de comando, onde as chaves
     * estrangeiras vêm desligadas.
     */
    db.exec("PRAGMA foreign_keys = OFF");
    inserir(db, "permissoes", { perfil_id: 99, unidade: "Central Sede" });
  }
  db.close();
}

/** O esquema inteiro do banco, para provar que ele mudou — ou que não mudou. */
function esquema(): { type: string; name: string; sql: string | null }[] {
  const db = new DatabaseSync(ARQUIVO, { readOnly: true });
  try {
    return db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all() as {
      type: string;
      name: string;
      sql: string | null;
    }[];
  } finally {
    db.close();
  }
}

function consultar<T>(sql: string, ...args: (string | number)[]): T[] {
  const db = new DatabaseSync(ARQUIVO, { readOnly: true });
  try {
    return db.prepare(sql).all(...args) as T[];
  } finally {
    db.close();
  }
}

/*
 * Quantos lançamentos cada pastor via ANTES, contado direto no esquema antigo:
 * as permissões dele cruzadas com a carga ativa. Depois da migração, a mesma
 * conta sai do caminho do app (unidadesDoPerfil + lerBase) e tem de bater.
 */
function visaoDosPastoresAntes(): Map<number, number> {
  const linhas = consultar<{ perfil: number; n: number }>(`
    SELECT p.id AS perfil, COUNT(l.carga_id) AS n
      FROM perfis p
      LEFT JOIN permissoes pe ON pe.perfil_id = p.id
      LEFT JOIN lancamentos l
        ON l.unidade = pe.unidade AND l.carga_id = (SELECT id FROM cargas WHERE ativa = 1)
     WHERE p.papel = 'pastor'
     GROUP BY p.id`);
  return new Map(linhas.map((r) => [r.perfil, r.n]));
}

function visaoDosPastoresDepois(ids: Iterable<number>): Map<number, number> {
  return new Map(
    [...ids].map((id) => [
      id,
      banco.lerBase("brasil", banco.unidadesDoPerfil(id, "brasil")).financial.length,
    ]),
  );
}

/** A impressão com TODAS as colunas, inclusive `base` — para provar o idempotente. */
function impressaoCompleta() {
  const colunas = Object.fromEntries(
    [
      "cargas",
      "lancamentos",
      "membresia",
      "saldos",
      "metas",
      "unidades",
      "perfis",
      "permissoes",
    ].map((t) => [t, consultar<{ name: string }>(`PRAGMA table_info(${t})`).map((r) => r.name)]),
  );
  return impressaoDigital(ARQUIVO, { colunas });
}

for (const v of VERSOES) {
  test(`esquema ${v.nome}: migra sem perder uma linha, e de novo não muda nada`, () => {
    limpar();
    montarBancoAntigo(v);
    const antes = impressaoDigital(ARQUIVO);
    const visaoAntes = visaoDosPastoresAntes();
    assert.equal(antes.integridade, "ok");

    // O primeiro acesso depois da atualização: é aqui que a migração roda.
    banco.cargaAtiva("brasil");
    banco.fechar();

    // 1. Nenhuma linha perdida ou alterada, em nenhuma tabela.
    const depois = impressaoDigital(ARQUIVO, { colunas: colunasDe(antes) });
    assert.deepEqual(comparar(antes, depois), [], descrever("depois", depois, antes).join("\n"));
    assert.deepEqual(depois.violacoes, {});

    // 2. Tudo o que existia é Brasil.
    assert.deepEqual(depois.tabelas.cargas.porBase, { brasil: 3 });
    assert.deepEqual(depois.tabelas.permissoes.porBase, { brasil: 5 });

    // 3. A chave nova das permissões, e a ligação com perfis que ela tinha.
    const pk = consultar<{ name: string; pk: number }>("PRAGMA table_info(permissoes)")
      .filter((c) => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.name);
    assert.deepEqual(pk, ["perfil_id", "base", "unidade"]);
    const fk = consultar<{ table: string; on_delete: string }>(
      "PRAGMA foreign_key_list(permissoes)",
    );
    assert.deepEqual(
      fk.map((f) => [f.table, f.on_delete]),
      [["perfis", "CASCADE"]],
    );
    assert.ok(
      !esquema().some((e) => e.name === "permissoes_nova"),
      "a tabela temporária não sobra",
    );
    // Os índices continuam lá — cargas não foi recriada.
    for (const indice of [
      "ix_lanc_carga",
      "ix_lanc_unidade",
      "ix_memb_carga",
      "ix_saldo_carga",
      "ix_metas_carga",
    ]) {
      assert.ok(
        esquema().some((e) => e.name === indice),
        `índice ${indice}`,
      );
    }

    // 4. Na versão sem `concluida`, a migração antiga continua fazendo a parte dela.
    assert.deepEqual(
      consultar<{ id: number; concluida: number }>(
        "SELECT id, concluida FROM cargas ORDER BY id",
      ).map((c) => [c.id, c.concluida]),
      [
        [1, 1],
        [2, 1],
        [3, 0],
      ],
    );

    // 5. Pelo caminho do app: cada pastor vê exatamente o que via antes.
    assert.deepEqual(visaoDosPastoresDepois(visaoAntes.keys()), visaoAntes);
    assert.deepEqual(banco.unidadesDoPerfil(PASTOR_A, "brasil"), [
      "Central Missões",
      "Central Sede",
    ]);
    assert.deepEqual(banco.unidadesDoPerfil(PASTOR_A, "angola"), []);
    assert.deepEqual(banco.basesDoPerfil(PASTOR_A), ["brasil"]);
    const ativa = banco.cargaAtiva("brasil");
    assert.equal(ativa?.id, 2);
    assert.equal(ativa?.base, "brasil");
    const tudo = banco.lerBase("brasil", null);
    assert.equal(tudo.financial.length, 40);
    assert.equal(tudo.metaAnualTotalGeral, 999999.99);
    assert.equal(banco.cargaAtiva("angola"), null, "Angola nasce vazia");
    assert.deepEqual(
      banco.permissoesOrfas(),
      [{ perfilId: PASTOR_B, base: "brasil", unidade: "Central Fechada" }],
      "a órfã por nome continua aparecendo, agora com a base",
    );

    // 6. Idempotente: abrir de novo não muda nada — nem esquema, nem dado.
    banco.fechar();
    const esquemaMigrado = esquema();
    const completa = impressaoCompleta();
    banco.cargaAtiva("brasil");
    banco.fechar();
    assert.deepEqual(esquema(), esquemaMigrado);
    assert.deepEqual(comparar(completa, impressaoCompleta()), []);
    assert.equal(completa.tabelas.cargas.hash, impressaoCompleta().tabelas.cargas.hash);
  });
}

test("migração que falha no meio não deixa nada pela metade", (t) => {
  limpar();
  montarBancoAntigo(PRODUCAO, { permissaoOrfa: true });
  const antes = impressaoDigital(ARQUIVO);
  const esquemaAntes = esquema();

  // A impressão digital aponta o problema ANTES — é para isso que ela existe.
  assert.deepEqual(antes.violacoes, { permissoes: 1 });
  assert.deepEqual(antes.perfisOrfaos, [99]);

  /*
   * O log é o que o TI vai ler no servidor, então ele também é conferido — e
   * fica capturado aqui, para a saída do teste não parecer um erro de verdade.
   *
   * A mensagem diz QUAL perfil está órfão e o comando que resolve: é o que a
   * Central pediu, para resolver em um comando, sem investigar.
   */
  const log = t.mock.method(console, "error", () => {});
  assert.throws(
    () => banco.cargaAtiva("brasil"),
    /perfil_id 99 \(1 permissão\).*DELETE FROM permissoes WHERE perfil_id IN \(99\);/,
  );
  assert.match(
    String(log.mock.calls[0]?.arguments[0]),
    /^\[banco\] o esquema não pôde ser preparado; nada foi servido: .*perfil_id 99/,
  );
  log.mock.restore();

  /*
   * Nada mudou: nem o esquema — a coluna `base` que cargas tinha ganhado no
   * começo da transação foi desfeita junto —, nem uma linha.
   */
  assert.deepEqual(esquema(), esquemaAntes);
  assert.deepEqual(comparar(antes, impressaoDigital(ARQUIVO)), []);

  // Resolvido o rastro, o próximo acesso migra normalmente.
  const db = new DatabaseSync(ARQUIVO);
  db.exec("DELETE FROM permissoes WHERE perfil_id = 99");
  db.close();
  assert.equal(banco.cargaAtiva("brasil")?.base, "brasil");
  banco.fechar();
  // A conexão que falhou foi fechada: no Windows, apagar o arquivo daria EPERM se não.
  limpar();
});

const ENSAIO = process.env.ENSAIO_BANCO;

test(
  "ensaio numa cópia de um banco de verdade",
  { skip: ENSAIO ? false : "defina ENSAIO_BANCO=<arquivo .db> para ensaiar" },
  () => {
    const origem = ENSAIO!;
    const original = impressaoDigital(origem);

    /*
     * A cópia sai de uma conexão SÓ DE LEITURA, por VACUUM INTO — o mesmo
     * caminho do backup.mjs, que leva junto o que ainda estiver no -wal. O
     * arquivo apontado nunca é aberto para escrita.
     */
    limpar();
    const leitura = new DatabaseSync(origem, { readOnly: true });
    leitura.exec(`VACUUM INTO '${ARQUIVO.replace(/\\/g, "/").replace(/'/g, "''")}'`);
    leitura.close();

    const antes = impressaoDigital(ARQUIVO);
    assert.deepEqual(comparar(original, antes), [], "a cópia é fiel ao original");
    const visaoAntes = visaoDosPastoresAntes();

    const inicio = performance.now();
    banco.cargaAtiva("brasil");
    const duracao = performance.now() - inicio;
    banco.fechar();

    const depois = impressaoDigital(ARQUIVO, { colunas: colunasDe(antes) });
    console.log(descrever("antes ", antes).join("\n"));
    console.log(descrever("depois", depois, antes).join("\n"));
    console.log(`  abrir e migrar levou ${Math.round(duracao)} ms`);

    assert.deepEqual(comparar(antes, depois), []);
    assert.deepEqual(Object.keys(depois.tabelas.cargas.porBase ?? {}), ["brasil"]);
    if (depois.tabelas.permissoes.linhas) {
      assert.deepEqual(Object.keys(depois.tabelas.permissoes.porBase ?? {}), ["brasil"]);
    }

    // Cada pastor vê, pelo app, exatamente o que via antes.
    const visaoDepois = visaoDosPastoresDepois(visaoAntes.keys());
    for (const [id, n] of visaoDepois) {
      console.log(
        `  pastor ${id}: ${n.toLocaleString("pt-BR")} lançamentos visíveis antes e depois`,
      );
    }
    assert.deepEqual(visaoDepois, visaoAntes);

    // A carga ativa inteira chega ao administrador.
    const ativa = banco.cargaAtiva("brasil");
    if (ativa) assert.equal(banco.lerBase("brasil", null).financial.length, ativa.linhas);
    banco.fechar();

    // Idempotente também aqui.
    const completa = impressaoCompleta();
    const esquemaMigrado = esquema();
    banco.cargaAtiva("brasil");
    banco.fechar();
    assert.deepEqual(esquema(), esquemaMigrado);
    assert.deepEqual(comparar(completa, impressaoCompleta()), []);

    // E o arquivo de origem não foi tocado.
    assert.deepEqual(comparar(original, impressaoDigital(origem)), []);
    assert.equal(impressaoDigital(origem).tabelas.cargas.hash, original.tabelas.cargas.hash);
    limpar();
  },
);
