/*
 * O banco. Este é o único arquivo do projeto que fala SQL.
 *
 * Sufixo `.server` não é decoração: ele importa `node:sqlite`, que não existe no
 * navegador. Só pode ser importado de dentro de um `.functions.ts`, onde o
 * plugin do TanStack Start separa o código de servidor do que vai para o
 * cliente. Importar daqui de qualquer componente quebra o pacote do navegador.
 *
 * A escolha do SQLite embutido no Node — em vez de um PostgreSQL — foi da
 * Central: o app roda num servidor da própria instituição, atrás da VPN, para
 * 18 pessoas. Isso dispensa serviço para o TI manter, e o backup passa a ser
 * copiar um arquivo. Ver o plano de implantação.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { FinancialRow, MembershipRow, SaldoRow } from "./parsers";

/*
 * Onde o arquivo mora. É esta pasta que precisa entrar na rotina de backup do
 * TI — não há nada de valor fora dela.
 */
const PASTA = process.env.DADOS_DIR ?? join(process.cwd(), "dados");
const ARQUIVO = join(PASTA, "central.db");

let db: DatabaseSync | null = null;

/** Abre o banco na primeira chamada e aplica o esquema. */
function conectar(): DatabaseSync {
  if (db) return db;
  mkdirSync(PASTA, { recursive: true });
  const conexao = new DatabaseSync(ARQUIVO);

  /*
   * WAL permite ler enquanto outra conexão escreve. Sem isso, um upload de 20
   * mil linhas travaria a leitura de quem estivesse abrindo o dashboard no
   * mesmo instante.
   */
  conexao.exec("PRAGMA journal_mode = WAL");
  conexao.exec("PRAGMA foreign_keys = ON");
  aplicarEsquema(conexao);
  db = conexao;
  return conexao;
}

function aplicarEsquema(c: DatabaseSync) {
  c.exec(`
    CREATE TABLE IF NOT EXISTS cargas (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      enviada_em  TEXT    NOT NULL,
      enviada_por TEXT,
      arquivos    TEXT,
      ativa       INTEGER NOT NULL DEFAULT 0,
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

    /*
     * O universo de unidades, alimentado por cada envio. É desta tabela que sai
     * a lista de opções da tela de permissões — e não de uma relação escrita à
     * mão —, então abrir ou fechar uma unidade se reflete sozinho lá.
     */
    CREATE TABLE IF NOT EXISTS unidades (
      nome      TEXT PRIMARY KEY,
      vista_em  TEXT NOT NULL
    );

    /*
     * Uma conta por pessoa. A coluna "chave" é o que o login procura: o
     * usuário em minúsculas e sem espaços nas pontas, para "Financeiro" e
     * "financeiro " serem a mesma conta. "usuario" guarda a grafia original,
     * que é a que aparece na tela.
     */
    CREATE TABLE IF NOT EXISTS perfis (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      chave      TEXT    NOT NULL UNIQUE,
      usuario    TEXT    NOT NULL,
      nome       TEXT    NOT NULL,
      papel      TEXT    NOT NULL CHECK (papel IN ('admin', 'pastor')),
      senha_hash TEXT    NOT NULL,
      ativo      INTEGER NOT NULL DEFAULT 1,
      criado_em  TEXT    NOT NULL
    );

    /* Quais unidades cada perfil enxerga. Sem linha aqui, não enxerga nenhuma. */
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
  `);
}

/** Nome reservado para a linha consolidada da planilha de metas. */
export const TOTAL_GERAL = "__total_geral__";

export interface ResumoCarga {
  id: number;
  enviadaEm: string;
  enviadaPor: string | null;
  arquivos: string[];
  linhas: number;
}

/* ============================ escrita ============================ */

export function iniciarCarga(arquivos: string[], enviadaPor: string | null): number {
  const c = conectar();
  c.prepare(
    `INSERT INTO cargas (enviada_em, enviada_por, arquivos, ativa, linhas)
     VALUES (?, ?, ?, 0, 0)`,
  ).run(new Date().toISOString(), enviadaPor, JSON.stringify(arquivos));
  const { id } = c.prepare("SELECT last_insert_rowid() AS id").get() as { id: number };
  return id;
}

/*
 * Cada lote entra numa transação só. Sem isso o SQLite faria um commit por
 * linha: medido, 25 mil linhas passam de milissegundos para dezenas de
 * segundos.
 */
export function gravarLancamentos(cargaId: number, linhas: FinancialRow[]) {
  const c = conectar();
  const ins = c.prepare(
    `INSERT INTO lancamentos
       (carga_id, unidade, nat2, nat3, nat4, razao_social, projeto, meta,
        credito, credito1, debito, debito1, data, dia, mes, ano, nro_unico)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  c.exec("BEGIN");
  try {
    for (const r of linhas) {
      ins.run(
        cargaId,
        r.unidade ?? "",
        r.nat2 ?? "",
        r.nat3 ?? "",
        r.nat4 ?? "",
        r.razaoSocial ?? "",
        r.projeto ?? "",
        r.meta ?? "",
        r.credito ?? 0,
        r.credito1 ?? 0,
        r.debito ?? 0,
        r.debito1 ?? 0,
        r.data ? new Date(r.data).toISOString() : null,
        r.dia ?? 0,
        r.mes ?? 0,
        r.ano ?? 0,
        r.nroUnico ?? "",
      );
    }
    c.exec("COMMIT");
  } catch (e) {
    c.exec("ROLLBACK");
    throw e;
  }
}

export function gravarMembresia(cargaId: number, linhas: MembershipRow[]) {
  const c = conectar();
  const ins = c.prepare("INSERT INTO membresia (carga_id, unidade, meses) VALUES (?,?,?)");
  c.exec("BEGIN");
  try {
    for (const r of linhas) ins.run(cargaId, r.unidade ?? "", JSON.stringify(r.meses ?? {}));
    c.exec("COMMIT");
  } catch (e) {
    c.exec("ROLLBACK");
    throw e;
  }
}

export function gravarSaldos(cargaId: number, linhas: SaldoRow[]) {
  const c = conectar();
  const ins = c.prepare(
    "INSERT INTO saldos (carga_id, unidade, periodo, quando, saldo) VALUES (?,?,?,?,?)",
  );
  c.exec("BEGIN");
  try {
    for (const r of linhas) {
      /*
       * `quando` é união de "atual", {ano,mes} ou null. Vira texto aqui e volta
       * a ser união na leitura — o SQLite não guarda objeto, e inventar duas
       * colunas para isso deixaria a intenção menos legível do que o rótulo.
       */
      const quando =
        r.quando === "atual"
          ? "atual"
          : r.quando
            ? `${r.quando.ano}-${String(r.quando.mes).padStart(2, "0")}`
            : null;
      ins.run(cargaId, r.unidade ?? "", r.periodo ?? "", quando, r.saldo ?? 0);
    }
    c.exec("COMMIT");
  } catch (e) {
    c.exec("ROLLBACK");
    throw e;
  }
}

export function gravarMetas(
  cargaId: number,
  metaAnualPorUnidade: Record<string, number>,
  metaAnualTotalGeral: number,
) {
  const c = conectar();
  const ins = c.prepare("INSERT INTO metas (carga_id, unidade, anual) VALUES (?,?,?)");
  c.exec("BEGIN");
  try {
    for (const [nome, anual] of Object.entries(metaAnualPorUnidade)) ins.run(cargaId, nome, anual);
    if (metaAnualTotalGeral) ins.run(cargaId, TOTAL_GERAL, metaAnualTotalGeral);
    c.exec("COMMIT");
  } catch (e) {
    c.exec("ROLLBACK");
    throw e;
  }
}

/**
 * Fecha a carga: conta as linhas, atualiza o universo de unidades, e só então
 * a promove a ativa.
 *
 * A troca no último passo é o que separa "o upload falhou" de "o dashboard da
 * rede caiu": enquanto a carga nova é gravada, todos continuam vendo a anterior
 * inteira, e a virada é instantânea.
 */
export function finalizarCarga(cargaId: number): ResumoCarga {
  const c = conectar();
  const { n } = c
    .prepare("SELECT COUNT(*) AS n FROM lancamentos WHERE carga_id = ?")
    .get(cargaId) as { n: number };

  c.exec("BEGIN");
  try {
    c.prepare("UPDATE cargas SET ativa = 0").run();
    c.prepare("UPDATE cargas SET ativa = 1, linhas = ? WHERE id = ?").run(n, cargaId);
    c.prepare(
      `INSERT INTO unidades (nome, vista_em)
       SELECT DISTINCT unidade, ? FROM lancamentos WHERE carga_id = ? AND unidade <> ''
       ON CONFLICT(nome) DO UPDATE SET vista_em = excluded.vista_em`,
    ).run(new Date().toISOString(), cargaId);
    c.exec("COMMIT");
  } catch (e) {
    c.exec("ROLLBACK");
    throw e;
  }

  podarCargasAntigas();
  return cargaAtiva()!;
}

/*
 * Mantém a ativa e a anterior. A de antes dela é descartada: a anterior existe
 * como rede contra um arquivo errado, e duas gerações de rede não acrescentam
 * nada além de disco ocupado.
 */
function podarCargasAntigas() {
  const c = conectar();
  const manter = c.prepare("SELECT id FROM cargas ORDER BY id DESC LIMIT 2").all() as {
    id: number;
  }[];
  if (manter.length < 2) return;
  const menor = Math.min(...manter.map((r) => r.id));
  c.prepare("DELETE FROM cargas WHERE id < ?").run(menor);
}

/* ============================ perfis ============================ */

export interface Perfil {
  id: number;
  usuario: string;
  nome: string;
  papel: "admin" | "pastor";
  ativo: boolean;
}

interface PerfilComHash extends Perfil {
  senhaHash: string;
}

const chaveDe = (usuario: string) => usuario.trim().toLowerCase();

/**
 * Quantas contas existem.
 *
 * É o que decide se a tela de primeira execução aparece: enquanto for zero, o
 * endereço mostra a criação do administrador em vez do login. Assim que a
 * primeira conta nasce, essa tela desaparece e não há caminho de volta.
 */
export function contarPerfis(): number {
  const c = conectar();
  return (c.prepare("SELECT COUNT(*) AS n FROM perfis").get() as { n: number }).n;
}

export function criarPerfil(dados: {
  usuario: string;
  nome: string;
  papel: "admin" | "pastor";
  senhaHash: string;
}): Perfil {
  const c = conectar();
  c.prepare(
    `INSERT INTO perfis (chave, usuario, nome, papel, senha_hash, ativo, criado_em)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
  ).run(
    chaveDe(dados.usuario),
    dados.usuario.trim(),
    dados.nome.trim(),
    dados.papel,
    dados.senhaHash,
    new Date().toISOString(),
  );
  const { id } = c.prepare("SELECT last_insert_rowid() AS id").get() as { id: number };
  return {
    id,
    usuario: dados.usuario.trim(),
    nome: dados.nome.trim(),
    papel: dados.papel,
    ativo: true,
  };
}

/** Devolve o perfil COM o hash da senha. Só o login deve chamar. */
export function buscarPorUsuario(usuario: string): PerfilComHash | null {
  const c = conectar();
  const r = c.prepare("SELECT * FROM perfis WHERE chave = ?").get(chaveDe(usuario)) as
    | Record<string, any>
    | undefined;
  if (!r) return null;
  return {
    id: r.id,
    usuario: r.usuario,
    nome: r.nome,
    papel: r.papel,
    ativo: !!r.ativo,
    senhaHash: r.senha_hash,
  };
}

export function buscarPorId(id: number): Perfil | null {
  const c = conectar();
  const r = c.prepare("SELECT id, usuario, nome, papel, ativo FROM perfis WHERE id = ?").get(id) as
    | Record<string, any>
    | undefined;
  if (!r) return null;
  return { id: r.id, usuario: r.usuario, nome: r.nome, papel: r.papel, ativo: !!r.ativo };
}

export function trocarSenha(perfilId: number, senhaHash: string) {
  conectar().prepare("UPDATE perfis SET senha_hash = ? WHERE id = ?").run(senhaHash, perfilId);
}

/** As unidades liberadas para um perfil. Lista vazia significa nenhuma. */
export function unidadesDoPerfil(perfilId: number): string[] {
  const c = conectar();
  return (
    c
      .prepare("SELECT unidade FROM permissoes WHERE perfil_id = ? ORDER BY unidade")
      .all(perfilId) as { unidade: string }[]
  ).map((r) => r.unidade);
}

export interface PastorComUnidades extends Perfil {
  unidades: string[];
}

/**
 * Os pastores e o que cada um enxerga, para a tela de permissões.
 *
 * Numa consulta só, e não uma por pastor: com 17 contas seriam 18 idas ao
 * banco para desenhar uma tela.
 */
export function listarPastores(): PastorComUnidades[] {
  const c = conectar();
  const perfis = c
    .prepare(
      "SELECT id, usuario, nome, papel, ativo FROM perfis WHERE papel = 'pastor' ORDER BY nome",
    )
    .all() as Record<string, any>[];

  const porPerfil = new Map<number, string[]>();
  for (const r of c.prepare("SELECT perfil_id, unidade FROM permissoes ORDER BY unidade").all() as {
    perfil_id: number;
    unidade: string;
  }[]) {
    const lista = porPerfil.get(r.perfil_id);
    if (lista) lista.push(r.unidade);
    else porPerfil.set(r.perfil_id, [r.unidade]);
  }

  return perfis.map((r) => ({
    id: r.id,
    usuario: r.usuario,
    nome: r.nome,
    papel: r.papel,
    ativo: !!r.ativo,
    unidades: porPerfil.get(r.id) ?? [],
  }));
}

/**
 * Grava as unidades de vários pastores de uma vez.
 *
 * Tudo numa transação: a tela salva o que o administrador mexeu em conjunto, e
 * uma falha no meio não pode deixar metade das mudanças valendo. Ou vale tudo,
 * ou nada muda — e ele tenta de novo vendo a mesma tela de antes.
 *
 * Para cada pastor, apaga e regrava em vez de calcular a diferença. São no
 * máximo 18 linhas por pessoa; a diferença de custo é nula e o código que a
 * calcularia é onde moram os erros.
 */
export function salvarPermissoes(alteracoes: { perfilId: number; unidades: string[] }[]) {
  const c = conectar();
  const apagar = c.prepare("DELETE FROM permissoes WHERE perfil_id = ?");
  const inserir = c.prepare("INSERT INTO permissoes (perfil_id, unidade) VALUES (?, ?)");
  c.exec("BEGIN");
  try {
    for (const a of alteracoes) {
      apagar.run(a.perfilId);
      for (const u of a.unidades) inserir.run(a.perfilId, u);
    }
    c.exec("COMMIT");
  } catch (e) {
    c.exec("ROLLBACK");
    throw e;
  }
}

/**
 * Liga ou desliga uma conta.
 *
 * Desativar em vez de apagar: o registro de quem enviou cada carga aponta para
 * o perfil, e apagar a pessoa apagaria junto a resposta de "quem subiu essa
 * base".
 *
 * A conta desativada continua aparecendo na tela, marcada — e não sumindo.
 * Sumir impediria de desfazer um clique errado, e a lista tem 17 linhas: não é
 * o tipo de tela que precisa ser podada para caber.
 */
export function definirAtivo(perfilId: number, ativo: boolean) {
  conectar()
    .prepare("UPDATE perfis SET ativo = ? WHERE id = ?")
    .run(ativo ? 1 : 0, perfilId);
}

/** Já existe conta com este usuário? O login trata maiúsculas como iguais. */
export function usuarioExiste(usuario: string): boolean {
  const c = conectar();
  return !!c.prepare("SELECT 1 FROM perfis WHERE chave = ?").get(chaveDe(usuario));
}

/* ============================ leitura ============================ */

export function cargaAtiva(): ResumoCarga | null {
  const c = conectar();
  const r = c.prepare("SELECT * FROM cargas WHERE ativa = 1").get() as
    | {
        id: number;
        enviada_em: string;
        enviada_por: string | null;
        arquivos: string | null;
        linhas: number;
      }
    | undefined;
  if (!r) return null;
  return {
    id: r.id,
    enviadaEm: r.enviada_em,
    enviadaPor: r.enviada_por,
    arquivos: r.arquivos ? JSON.parse(r.arquivos) : [],
    linhas: r.linhas,
  };
}

/** Todas as unidades já vistas em qualquer envio, em ordem alfabética. */
export function listarUnidades(): string[] {
  const c = conectar();
  return (c.prepare("SELECT nome FROM unidades ORDER BY nome").all() as { nome: string }[]).map(
    (r) => r.nome,
  );
}

export interface BaseCompleta {
  financial: FinancialRow[];
  membership: MembershipRow[];
  saldo: SaldoRow[];
  metaAnualPorUnidade: Record<string, number>;
  metaAnualTotalGeral: number;
  carga: ResumoCarga | null;
}

const VAZIA: BaseCompleta = {
  financial: [],
  membership: [],
  saldo: [],
  metaAnualPorUnidade: {},
  metaAnualTotalGeral: 0,
  carga: null,
};

/**
 * A PORTA ÚNICA de leitura das bases. Nenhum outro trecho do projeto consulta
 * as tabelas de dados — e é por isso que existe apenas um lugar para auditar
 * quando a pergunta for "esse pastor podia mesmo ver isso?".
 *
 * `unidades` é a lista do que quem pediu tem direito a ver; `null` significa
 * "tudo", e é o que o administrador recebe. O recorte acontece aqui, no
 * servidor: o navegador do pastor nunca chega a receber uma linha das outras
 * unidades, então esconder na tela nunca fez parte do desenho.
 */
export function lerBase(unidades: string[] | null): BaseCompleta {
  const c = conectar();
  const carga = cargaAtiva();
  if (!carga) return VAZIA;

  // Sem nenhuma unidade permitida o recorte é vazio, e não "tudo".
  if (unidades && unidades.length === 0) return { ...VAZIA, carga };

  const filtro = unidades ? ` AND unidade IN (${unidades.map(() => "?").join(",")})` : "";
  const args = unidades ? [carga.id, ...unidades] : [carga.id];

  const lanc = c
    .prepare(`SELECT * FROM lancamentos WHERE carga_id = ?${filtro}`)
    .all(...args) as Record<string, any>[];

  const financial: FinancialRow[] = lanc.map((r) => ({
    unidade: r.unidade,
    nat2: r.nat2,
    nat3: r.nat3,
    nat4: r.nat4,
    razaoSocial: r.razao_social,
    projeto: r.projeto,
    meta: r.meta,
    credito: r.credito,
    credito1: r.credito1,
    debito: r.debito,
    debito1: r.debito1,
    data: r.data ? new Date(r.data) : null,
    dia: r.dia,
    mes: r.mes,
    ano: r.ano,
    nroUnico: r.nro_unico,
  }));

  /*
   * A membresia tem uma linha "Total Geral" na própria planilha, e ela é o
   * número que a Seção 2 lê quando nenhuma unidade está filtrada. Para o
   * administrador ela vem junto; para o pastor, não — senão o denominador do
   * dízimo per capita seria o da rede inteira contra o numerador de duas
   * igrejas.
   */
  const memb = c
    .prepare(`SELECT unidade, meses FROM membresia WHERE carga_id = ?${filtro}`)
    .all(...args) as { unidade: string; meses: string }[];
  const membership: MembershipRow[] = memb.map((r) => ({
    unidade: r.unidade,
    meses: JSON.parse(r.meses),
  }));

  const sal = c
    .prepare(`SELECT unidade, periodo, quando, saldo FROM saldos WHERE carga_id = ?${filtro}`)
    .all(...args) as { unidade: string; periodo: string; quando: string | null; saldo: number }[];
  const saldo: SaldoRow[] = sal.map((r) => {
    let quando: SaldoRow["quando"] = null;
    if (r.quando === "atual") quando = "atual";
    else if (r.quando) {
      const [ano, mes] = r.quando.split("-").map(Number);
      if (ano && mes) quando = { ano, mes };
    }
    return { unidade: r.unidade, periodo: r.periodo, quando, saldo: r.saldo };
  });

  /*
   * As metas seguem a mesma regra de recorte, e a linha consolidada "Total
   * Geral" só chega a quem pode ver tudo. É o que faz a meta do pastor virar a
   * soma das unidades dele sem nenhum código novo: parsers.ts já cai nessa soma
   * quando a linha consolidada não chega.
   */
  const filtroMeta = unidades ? ` AND unidade IN (${unidades.map(() => "?").join(",")})` : "";
  const met = c
    .prepare(`SELECT unidade, anual FROM metas WHERE carga_id = ?${filtroMeta}`)
    .all(...args) as { unidade: string; anual: number }[];

  const metaAnualPorUnidade: Record<string, number> = {};
  let metaAnualTotalGeral = 0;
  for (const m of met) {
    if (m.unidade === TOTAL_GERAL) metaAnualTotalGeral = m.anual;
    else metaAnualPorUnidade[m.unidade] = m.anual;
  }

  /*
   * Sem a linha consolidada, o total é a soma das unidades visíveis.
   *
   * É o caso do pastor: a linha "Total Geral" vale a rede inteira e por isso
   * não lhe é entregue, senão a meta dele seria a de todas as igrejas. A mesma
   * regra existe em parsers.ts, mas lá ela roda ao interpretar a planilha — um
   * caminho pelo qual só o administrador passa, no upload. Quem lê do banco
   * nunca chega nela, e sem esta soma o card "Meta de Dízimos" do pastor
   * aparecia zerado.
   */
  if (!metaAnualTotalGeral) {
    metaAnualTotalGeral = Object.values(metaAnualPorUnidade).reduce((s, v) => s + v, 0);
  }

  return { financial, membership, saldo, metaAnualPorUnidade, metaAnualTotalGeral, carga };
}
