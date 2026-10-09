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
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  metaFicaForaDasSomas,
  type FinancialRow,
  type MembershipRow,
  type SaldoRow,
} from "./parsers.ts";
/*
 * Com a extensão `.ts`: os testes carregam este arquivo direto no Node, que não
 * resolve import sem extensão — e daqui sai um valor (BASES), não só um tipo.
 * Ver o comentário em src/lib/consolidado.ts.
 */
import { BASES, type Base } from "./bases.ts";
import { SEM_DADOS, temMetaDeDizimos, type Presenca } from "./presenca.ts";

/*
 * Onde o arquivo mora. É esta pasta que precisa entrar na rotina de backup do
 * TI — não há nada de valor fora dela.
 *
 * Em produção a variável é OBRIGATÓRIA, e isso vem de um episódio real no
 * servidor: rodaram `rm -rf dados/` e, logo depois, a ferramenta de redefinir
 * senha ainda encontrou a conta do Financeiro. Se a pasta tivesse sido de fato
 * apagada, não haveria conta para redefinir — eram dois `central.db`
 * diferentes. A causa é que o caminho saía de `process.cwd()`, e o PM2 roda o
 * serviço a partir de um diretório de trabalho próprio, que não é a pasta de
 * onde alguém digita os comandos.
 *
 * Um caminho que depende de onde o processo foi iniciado não é um caminho: é
 * um palpite. Exigir o valor explícito elimina a ambiguidade em vez de
 * documentá-la.
 *
 * Fora de produção o padrão continua `./dados`, para não atrapalhar quem
 * desenvolve nem os testes — que definem `DADOS_DIR` antes de importar este
 * módulo, de propósito, porque o caminho é lido aqui na carga.
 *
 * Só que esse "fora de produção" vale apenas RODANDO DO FONTE. No servidor
 * compilado ele não existe: o empacotador troca `process.env.NODE_ENV` pelo
 * texto "production" em tempo de build, o `if` abaixo vira sempre-verdadeiro, e
 * o `return` do fim — o tal padrão `./dados` — é eliminado como código morto.
 * Conferido no bundle: a função que sai de lá ou devolve o DADOS_DIR ou lança.
 *
 * O efeito é bom e fica assim de propósito: o servidor compilado não tem como
 * silenciosamente cair no `./dados` de um diretório de trabalho qualquer, que é
 * exatamente o defeito que este comentário todo existe para descrever.
 */
function resolverPastaDeDados(): string {
  const definida = process.env.DADOS_DIR;
  // `resolve` para que o caminho registrado no log seja absoluto mesmo quando
  // alguém passa um valor relativo — que era exatamente a origem da confusão.
  if (definida) return resolve(definida);

  if (process.env.NODE_ENV === "production") {
    console.error(
      "[banco] DADOS_DIR não está definida. Em produção o caminho do banco " +
        "precisa ser explícito: o diretório de trabalho do serviço não é " +
        "confiável, e sem a variável não há como saber qual central.db está " +
        "em uso. Defina-a na configuração do serviço, com caminho absoluto.",
    );
    throw new Error("Internal server error");
  }

  return join(process.cwd(), "dados");
}

const PASTA = resolverPastaDeDados();
const ARQUIVO = join(PASTA, "central.db");

let db: DatabaseSync | null = null;

/** Abre o banco na primeira chamada e aplica o esquema. */
function conectar(): DatabaseSync {
  if (db) return db;
  mkdirSync(PASTA, { recursive: true });

  // Conferido ANTES de abrir: `new DatabaseSync` cria o arquivo se não existir,
  // e depois disso a resposta seria sempre "existe".
  const jaExistia = existsSync(ARQUIVO);
  const conexao = new DatabaseSync(ARQUIVO);

  /*
   * Uma linha, no arranque, com o caminho absoluto e o estado do arquivo.
   *
   * Existe porque durante dias ninguém soube qual `central.db` o servidor
   * estava usando de verdade. Com esta linha, conferir a implantação deixa de
   * ser adivinhação — e o caso mais perigoso passa a ser visível na hora: um
   * serviço que diz "criado agora, vazio" quando deveria ter encontrado o
   * banco existente está apontando para o lugar errado, e a tela de primeiro
   * acesso vai reaparecer como se o sistema fosse novo.
   */
  console.info(`[banco] ${ARQUIVO} — ${jaExistia ? "arquivo existente" : "criado agora, vazio"}`);

  /*
   * WAL permite ler enquanto outra conexão escreve. Sem isso, um upload de 20
   * mil linhas travaria a leitura de quem estivesse abrindo o dashboard no
   * mesmo instante.
   */
  conexao.exec("PRAGMA journal_mode = WAL");
  conexao.exec("PRAGMA foreign_keys = ON");
  try {
    aplicarEsquema(conexao);
    migrar(conexao);
  } catch (e) {
    /*
     * Migração que falha não deixa o banco pela metade — cada uma desfaz o que
     * começou (ver migrarParaDuasBases). Mas a conexão ficaria aberta e
     * esquecida, uma por requisição, e o motivo se perderia no meio do erro
     * genérico da requisição. Fecha, diz o motivo no log com o prefixo de
     * sempre, e deixa o erro seguir: sem esquema certo, não há o que servir.
     */
    conexao.close();
    console.error(`[banco] o esquema não pôde ser preparado; nada foi servido: ${e}`);
    throw e;
  }
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
      concluida   INTEGER NOT NULL DEFAULT 0,
      linhas      INTEGER NOT NULL DEFAULT 0,
      /*
       * "brasil" ou "angola" — ver bases.ts. O padrão é o mesmo que a migração
       * usa, para um banco novo e um migrado terem exatamente o mesmo esquema;
       * quem grava carga sempre diz a base (ver iniciarCarga).
       */
      base        TEXT    NOT NULL DEFAULT 'brasil'
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
     * Histórico, e só. Era alimentada a cada envio, mas nunca foi lida: a lista
     * de unidades sempre saiu dos lançamentos da carga ativa (ver
     * listarUnidades). Com duas bases deixou de ser escrita — o nome é a chave,
     * e uma "Central Sede" de cada país viraria uma linha só. Continua no
     * esquema porque os bancos existentes a têm, e apagá-la seria mexer em
     * produção sem ganho nenhum.
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
      criado_em  TEXT    NOT NULL,
      ultimo_acesso TEXT,
      senha_cifrada TEXT
    );

    /*
     * Quais unidades cada perfil enxerga, e em qual base. Sem linha aqui, não
     * enxerga nenhuma; sem nenhuma linha numa base, não tem acesso a ela — ver
     * basesDoPerfil. A base está na chave porque o mesmo nome de unidade pode
     * existir nos dois países, e liberar um não pode liberar o outro.
     */
    CREATE TABLE IF NOT EXISTS permissoes (
      perfil_id INTEGER NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
      base      TEXT    NOT NULL,
      unidade   TEXT    NOT NULL,
      PRIMARY KEY (perfil_id, base, unidade)
    );

    CREATE INDEX IF NOT EXISTS ix_lanc_carga    ON lancamentos(carga_id);
    CREATE INDEX IF NOT EXISTS ix_lanc_unidade  ON lancamentos(carga_id, unidade);
    CREATE INDEX IF NOT EXISTS ix_memb_carga    ON membresia(carga_id);
    CREATE INDEX IF NOT EXISTS ix_saldo_carga   ON saldos(carga_id);
    CREATE INDEX IF NOT EXISTS ix_metas_carga   ON metas(carga_id);
  `);
}

/**
 * Fecha a conexão. Usado pelos testes, que apagam a pasta no fim — no Windows o
 * arquivo não some enquanto alguém o mantém aberto.
 */
export function fechar() {
  db?.close();
  db = null;
}

/*
 * Ajustes de esquema em bancos que já existem.
 *
 * CREATE TABLE IF NOT EXISTS não acrescenta coluna a uma tabela já criada, então
 * cada mudança precisa vir também por aqui. Roda a cada partida e é idempotente:
 * o que já está no lugar é ignorado.
 */
function migrar(c: DatabaseSync) {
  const colunas = (tabela: string) =>
    (c.prepare(`PRAGMA table_info(${tabela})`).all() as { name: string }[]).map((r) => r.name);

  if (!colunas("cargas").includes("concluida")) {
    c.exec("ALTER TABLE cargas ADD COLUMN concluida INTEGER NOT NULL DEFAULT 0");
    /*
     * Cargas que já existiam e tinham linhas foram, por definição, finalizadas:
     * só finalizarCarga preenche esse campo.
     */
    c.exec("UPDATE cargas SET concluida = 1 WHERE linhas > 0 OR ativa = 1");
  }

  const colunasPerfis = colunas("perfis");

  /*
   * Quando cada pessoa entrou pela última vez. Nulo quer dizer "nunca entrou",
   * que é informação útil por si: o pastor que recebeu a senha e não usou.
   *
   * Contas criadas antes desta coluna ficam nulas, e a tela diz "nunca entrou"
   * até o próximo login delas — não há como reconstruir o passado.
   */
  if (!colunasPerfis.includes("ultimo_acesso")) {
    c.exec("ALTER TABLE perfis ADD COLUMN ultimo_acesso TEXT");
  }

  /*
   * A senha do pastor, recuperável, para o administrador poder mostrá-la de
   * novo. Cifrada — ver cifrarSenha em senha.server.ts para o porquê de cifrar
   * algo que o próprio sistema vai decifrar.
   *
   * Contas criadas antes desta coluna ficam nulas. A senha delas existe só como
   * hash e não pode ser recuperada por ninguém: para mostrá-la, é preciso gerar
   * uma nova uma vez.
   */
  if (!colunasPerfis.includes("senha_cifrada")) {
    c.exec("ALTER TABLE perfis ADD COLUMN senha_cifrada TEXT");
  }

  migrarParaDuasBases(c, colunas);
}

/*
 * DUAS BASES — Brasil e Angola.
 *
 * Tudo o que existia antes desta migração é Brasil: era a única base. Então as
 * cargas e as permissões existentes ganham `base = 'brasil'`, e nada mais muda.
 *
 * O servidor da Central tem dados reais em produção quando isto roda pela
 * primeira vez, e a regra é que nenhuma linha se perde. Daí três cuidados:
 *
 * 1. UMA TRANSAÇÃO SÓ. Ou a migração inteira se aplica, ou nada muda. Uma falha
 *    no meio desfaz tudo, o motivo vai para o log, e nenhuma requisição é
 *    atendida até alguém resolver — melhor do que um banco meio migrado, em que
 *    metade do código acha que existe base e metade não. O caso previsível é
 *    uma permissão apontando para um perfil que já não existe (só acontece se
 *    alguém apagou perfil à mão, com o SQLite de linha de comando). A Central
 *    preferiu que a migração pare nesse caso, em vez de decidir sozinha o que
 *    fazer com a linha — e a mensagem diz qual perfil_id e o comando que
 *    resolve. A impressão digital (ferramentas/impressao-digital.mjs) aponta o
 *    mesmo caso no backup, antes da implantação.
 *
 * 2. `cargas` SÓ GANHA COLUNA. NUNCA É RECRIADA. Ela é a tabela-mãe de
 *    lançamentos, membresia, saldos e metas, todas com ON DELETE CASCADE, e a
 *    conexão liga `foreign_keys = ON` antes de migrar. Um DROP TABLE em cargas —
 *    o caminho que o SQLite exige para mudar uma tabela além de acrescentar
 *    coluna — faria um DELETE implícito em todas as cargas, e o CASCADE levaria
 *    todos os lançamentos junto. Seria a perda total da base, sem erro nenhum.
 *
 * 3. `permissoes` É RECRIADA, porque a base entra na chave primária e o SQLite
 *    não altera chave com ALTER TABLE. Isso é seguro porque ela é filha (de
 *    perfis), não mãe: ninguém a referencia, e apagá-la não cascateia nada. A
 *    contagem de linhas é conferida antes de a tabela antiga sair.
 *
 * A tabela `unidades` fica intocada. Ninguém lê dela — a lista de unidades sai
 * dos lançamentos da carga ativa —, e recriá-la seria risco sem benefício.
 *
 * Idempotente: cada passo confere se já foi feito. Rodar de novo não faz nada.
 */
function migrarParaDuasBases(c: DatabaseSync, colunas: (tabela: string) => string[]) {
  const faltaEmCargas = !colunas("cargas").includes("base");
  const faltaEmPermissoes = !colunas("permissoes").includes("base");
  if (!faltaEmCargas && !faltaEmPermissoes) return;

  c.exec("BEGIN IMMEDIATE");
  try {
    if (faltaEmCargas) {
      c.exec("ALTER TABLE cargas ADD COLUMN base TEXT NOT NULL DEFAULT 'brasil'");
    }

    if (faltaEmPermissoes) {
      /*
       * Conferido antes da cópia, e não deixado para ela: a cópia recusaria a
       * linha com um "FOREIGN KEY constraint failed" que não diz qual é.
       */
      const orfas = c
        .prepare(
          `SELECT perfil_id AS id, COUNT(*) AS n FROM permissoes
            WHERE perfil_id NOT IN (SELECT id FROM perfis)
            GROUP BY perfil_id ORDER BY perfil_id`,
        )
        .all() as { id: number; n: number }[];
      if (orfas.length) {
        const ids = orfas.map((o) => o.id).join(", ");
        const quais = orfas
          .map((o) => `${o.id} (${o.n} ${o.n === 1 ? "permissão" : "permissões"})`)
          .join(", ");
        throw new Error(
          `migração para duas bases parada, nada foi alterado: há permissões de perfis ` +
            `que não existem mais — perfil_id ${quais}. Para seguir, apague-as e reinicie ` +
            `o serviço: DELETE FROM permissoes WHERE perfil_id IN (${ids});`,
        );
      }

      const antes = (c.prepare("SELECT COUNT(*) AS n FROM permissoes").get() as { n: number }).n;

      // Sobra de uma tentativa anterior não chega a existir — DDL no SQLite é
      // transacional —, mas se existir, não pode virar a tabela de verdade.
      c.exec("DROP TABLE IF EXISTS permissoes_nova");
      c.exec(`
        CREATE TABLE permissoes_nova (
          perfil_id INTEGER NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
          base      TEXT    NOT NULL,
          unidade   TEXT    NOT NULL,
          PRIMARY KEY (perfil_id, base, unidade)
        )
      `);
      c.exec(
        "INSERT INTO permissoes_nova (perfil_id, base, unidade) SELECT perfil_id, 'brasil', unidade FROM permissoes",
      );

      const depois = (c.prepare("SELECT COUNT(*) AS n FROM permissoes_nova").get() as { n: number })
        .n;
      if (depois !== antes) {
        throw new Error(
          `migração de permissões perderia linhas: ${antes} antes, ${depois} depois — nada foi alterado`,
        );
      }

      c.exec("DROP TABLE permissoes");
      c.exec("ALTER TABLE permissoes_nova RENAME TO permissoes");
    }

    c.exec("COMMIT");
  } catch (e) {
    c.exec("ROLLBACK");
    throw e;
  }
}

/*
 * O que o node:sqlite devolve numa linha: texto, número, nulo ou binário —
 * nunca objeto. Descrever isso em vez de usar "any" faz o TypeScript recusar
 * um r.campo.propriedade escrito por engano, que era justamente o erro que o
 * any deixaria passar até o app quebrar rodando.
 */
type LinhaSQL = Record<string, string | number | bigint | Uint8Array | null>;

/*
 * Leitores de campo. Existem porque o SQLite não tem tipo forte de coluna: um
 * INTEGER pode voltar como bigint, e um campo ausente volta nulo. Converter num
 * lugar só evita a alternativa, que seria espalhar conversões e esquecer uma.
 */
const txt = (v: LinhaSQL[string]): string => (v == null ? "" : String(v));
const num = (v: LinhaSQL[string]): number => (typeof v === "number" ? v : Number(v ?? 0));

/** Nome reservado para a linha consolidada da planilha de metas. */
export const TOTAL_GERAL = "__total_geral__";

export interface ResumoCarga {
  id: number;
  base: Base;
  enviadaEm: string;
  enviadaPor: string | null;
  arquivos: string[];
  linhas: number;
}

/* ============================ escrita ============================ */

export function iniciarCarga(base: Base, arquivos: string[], enviadaPor: string | null): number {
  const c = conectar();
  c.prepare(
    `INSERT INTO cargas (base, enviada_em, enviada_por, arquivos, ativa, linhas)
     VALUES (?, ?, ?, ?, 0, 0)`,
  ).run(base, new Date().toISOString(), enviadaPor, JSON.stringify(arquivos));
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
 * Fecha a carga: conta as linhas e só então a promove a ativa — DENTRO DA BASE
 * DELA.
 *
 * Antes desativava TODAS as cargas antes de ativar a nova. Com uma base só,
 * dava no mesmo; com duas, subir o Brasil derrubaria Angola, e o dashboard de
 * lá ficaria vazio sem erro nenhum. A base vem da própria carga, e não de um
 * parâmetro: assim não há como finalizar uma carga do Brasil "como Angola".
 *
 * Também deixou de escrever na tabela `unidades`, que ninguém lê — a lista de
 * unidades sai dos lançamentos da carga ativa (ver listarUnidades).
 *
 * A troca no último passo é o que separa "o upload falhou" de "o dashboard da
 * rede caiu": enquanto a carga nova é gravada, todos continuam vendo a anterior
 * inteira, e a virada é instantânea.
 */
export function finalizarCarga(cargaId: number): ResumoCarga {
  const c = conectar();
  const linha = c.prepare("SELECT base FROM cargas WHERE id = ?").get(cargaId) as
    | { base: Base }
    | undefined;
  if (!linha) throw new Error(`carga ${cargaId} não existe`);
  const base = linha.base;

  const { n } = c
    .prepare("SELECT COUNT(*) AS n FROM lancamentos WHERE carga_id = ?")
    .get(cargaId) as { n: number };

  c.exec("BEGIN");
  try {
    c.prepare("UPDATE cargas SET ativa = 0 WHERE base = ?").run(base);
    c.prepare("UPDATE cargas SET ativa = 1, concluida = 1, linhas = ? WHERE id = ?").run(
      n,
      cargaId,
    );
    c.exec("COMMIT");
  } catch (e) {
    c.exec("ROLLBACK");
    throw e;
  }

  podarCargasAntigas(base);
  return cargaAtiva(base)!;
}

/*
 * Mantém as duas últimas cargas CONCLUÍDAS, e descarta as inacabadas.
 *
 * A distinção não é preciosismo. Um envio que morre no meio — o navegador do
 * administrador fechou, a rede caiu — deixa para trás uma carga com parte das
 * linhas e sem nunca ter sido finalizada. Antes, a poda contava por id e não
 * por conclusão: uma carga quebrada ocupava uma das duas vagas e empurrava para
 * fora o último envio BOM. A rede de segurança contra arquivo errado virava
 * lixo, sem nenhum aviso.
 *
 * Agora as vagas são das concluídas, e as inacabadas anteriores à ativa somem —
 * elas não servem para nada e só ocupam disco.
 *
 * TUDO ISSO DENTRO DE UMA BASE. Antes as duas vagas eram da rede inteira: subir
 * o Brasil duas vezes apagaria a carga de Angola, e o ON DELETE CASCADE levaria
 * junto os lançamentos, a membresia, os saldos e as metas dela. E o segundo
 * DELETE, o das inacabadas, mataria no meio um envio de Angola em andamento.
 * Destruição silenciosa nos dois casos — cada base agora poda só as próprias.
 */
function podarCargasAntigas(base: Base) {
  const c = conectar();
  const concluidas = c
    .prepare("SELECT id FROM cargas WHERE base = ? AND concluida = 1 ORDER BY id DESC LIMIT 2")
    .all(base) as { id: number }[];
  if (!concluidas.length) return;

  const menorMantida = Math.min(...concluidas.map((r) => r.id));
  c.prepare("DELETE FROM cargas WHERE base = ? AND id < ?").run(base, menorMantida);
  /*
   * Inacabadas entre as mantidas também saem — é o caso do envio que falhou
   * depois do último bom e antes deste.
   */
  c.prepare("DELETE FROM cargas WHERE base = ? AND concluida = 0 AND id < ?").run(
    base,
    Math.max(...concluidas.map((r) => r.id)),
  );
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
  /** Só para pastores. O administrador nunca tem senha recuperável. */
  senhaCifrada?: string | null;
}): Perfil {
  const c = conectar();
  c.prepare(
    `INSERT INTO perfis (chave, usuario, nome, papel, senha_hash, senha_cifrada, ativo, criado_em)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
  ).run(
    chaveDe(dados.usuario),
    dados.usuario.trim(),
    dados.nome.trim(),
    dados.papel,
    dados.senhaHash,
    dados.papel === "pastor" ? (dados.senhaCifrada ?? null) : null,
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
    | LinhaSQL
    | undefined;
  if (!r) return null;
  return {
    id: num(r.id),
    usuario: txt(r.usuario),
    nome: txt(r.nome),
    papel: txt(r.papel) as "admin" | "pastor",
    ativo: !!r.ativo,
    senhaHash: txt(r.senha_hash),
  };
}

export function buscarPorId(id: number): Perfil | null {
  const c = conectar();
  const r = c.prepare("SELECT id, usuario, nome, papel, ativo FROM perfis WHERE id = ?").get(id) as
    | LinhaSQL
    | undefined;
  if (!r) return null;
  return {
    id: num(r.id),
    usuario: txt(r.usuario),
    nome: txt(r.nome),
    papel: txt(r.papel) as "admin" | "pastor",
    ativo: !!r.ativo,
  };
}

/*
 * Hash e senha cifrada mudam NO MESMO comando, e isso não é detalhe.
 *
 * Se fossem dois UPDATEs e o segundo falhasse, o hash seria o da senha nova e a
 * cifrada continuaria sendo a da antiga. O "Mostrar senha" exibiria então uma
 * senha que não funciona mais — e o administrador a passaria ao pastor com toda
 * a confiança. Mostrar senha errada é pior do que não mostrar nenhuma.
 *
 * `senhaCifrada` nulo apaga a recuperável: é o que a ferramenta de emergência
 * faz, porque ela troca a senha sem ter como cifrar a nova.
 */
export function trocarSenha(perfilId: number, senhaHash: string, senhaCifrada: string | null) {
  conectar()
    .prepare("UPDATE perfis SET senha_hash = ?, senha_cifrada = ? WHERE id = ?")
    .run(senhaHash, senhaCifrada, perfilId);
}

/**
 * Anota que a pessoa acabou de entrar.
 *
 * Chamado só no login bem-sucedido, que neste sistema é a mesma coisa que
 * "entrou no dashboard": toda carga de página começa na tela de login (ver
 * appState.tsx), então não existe entrada que não passe por aqui.
 */
export function registrarAcesso(perfilId: number) {
  conectar()
    .prepare("UPDATE perfis SET ultimo_acesso = ? WHERE id = ?")
    .run(new Date().toISOString(), perfilId);
}

/**
 * A senha cifrada de um PASTOR, para o administrador mostrar.
 *
 * O filtro por papel está na consulta, e não só em quem chama: mesmo que um
 * caminho futuro esqueça de conferir, esta função não devolve nada de uma conta
 * de administrador — cuja senha, de resto, nunca é gravada recuperável.
 */
export function senhaCifradaDoPastor(perfilId: number): string | null {
  const r = conectar()
    .prepare("SELECT senha_cifrada FROM perfis WHERE id = ? AND papel = 'pastor'")
    .get(perfilId) as LinhaSQL | undefined;
  return r?.senha_cifrada == null ? null : txt(r.senha_cifrada);
}

/**
 * As unidades liberadas para um perfil, DENTRO DE UMA BASE. Lista vazia
 * significa nenhuma — nunca todas.
 *
 * A base é obrigatória e entra na consulta, não num filtro depois. Sem ela, um
 * pastor com "Central Sede" no Brasil, pedindo Angola, levaria a "Central Sede"
 * de Angola junto: o recorte casa por nome, e nomes se repetem entre países.
 */
export function unidadesDoPerfil(perfilId: number, base: Base): string[] {
  const c = conectar();
  return (
    c
      .prepare("SELECT unidade FROM permissoes WHERE perfil_id = ? AND base = ? ORDER BY unidade")
      .all(perfilId, base) as { unidade: string }[]
  ).map((r) => r.unidade);
}

/**
 * As bases a que um perfil tem acesso.
 *
 * Não há tabela para isso, de propósito: ter acesso a uma base É ter pelo menos
 * uma unidade liberada nela. Uma fonte de verdade só, sem o estado incoerente
 * "tem a base mas nenhuma unidade" — que mostraria um dashboard vazio a quem
 * nunca deveria tê-lo visto.
 */
export function basesDoPerfil(perfilId: number): Base[] {
  const c = conectar();
  const achadas = new Set(
    (
      c.prepare("SELECT DISTINCT base FROM permissoes WHERE perfil_id = ?").all(perfilId) as {
        base: Base;
      }[]
    ).map((r) => r.base),
  );
  // Na ordem da declaração, para a tela de escolha não variar de uma vez para outra.
  return BASES.filter((b) => achadas.has(b));
}

export interface PastorComUnidades extends Perfil {
  /** As unidades liberadas, separadas por base. Uma base sem unidades é uma base sem acesso. */
  unidadesPorBase: Record<Base, string[]>;
  /** ISO do último login, ou nulo se nunca entrou. */
  ultimoAcesso: string | null;
  /**
   * Se existe senha recuperável para mostrar. Só o SIM ou NÃO: a senha em si
   * não viaja na listagem, e sai apenas quando o administrador pede, pessoa por
   * pessoa. Uma lista que trouxesse todas deixaria 17 senhas no navegador toda
   * vez que a tela abrisse.
   */
  temSenhaVisivel: boolean;
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
      `SELECT id, usuario, nome, papel, ativo, ultimo_acesso,
              senha_cifrada IS NOT NULL AS tem_senha_visivel
         FROM perfis WHERE papel = 'pastor' ORDER BY nome`,
    )
    .all() as LinhaSQL[];

  const porPerfil = new Map<number, Record<Base, string[]>>();
  const linhasPermissao = c
    .prepare("SELECT perfil_id, base, unidade FROM permissoes ORDER BY unidade")
    .all() as { perfil_id: number; base: Base; unidade: string }[];
  for (const r of linhasPermissao) {
    let doPerfil = porPerfil.get(r.perfil_id);
    if (!doPerfil) {
      doPerfil = { brasil: [], angola: [] };
      porPerfil.set(r.perfil_id, doPerfil);
    }
    doPerfil[r.base].push(r.unidade);
  }

  return perfis.map((r) => ({
    id: num(r.id),
    usuario: txt(r.usuario),
    nome: txt(r.nome),
    papel: txt(r.papel) as "admin" | "pastor",
    ativo: !!r.ativo,
    unidadesPorBase: porPerfil.get(num(r.id)) ?? { brasil: [], angola: [] },
    ultimoAcesso: r.ultimo_acesso == null ? null : txt(r.ultimo_acesso),
    temSenhaVisivel: !!r.tem_senha_visivel,
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
 *
 * Mas apaga e regrava SÓ A BASE da alteração. Cada alteração diz a base, e só
 * as permissões daquela base são tocadas. Antes era `DELETE FROM permissoes
 * WHERE perfil_id = ?`: com duas bases, salvar as unidades do Brasil de alguém
 * apagaria as de Angola dele — perda silenciosa, descoberta só quando o pastor
 * dissesse que não vê mais nada.
 */
export function salvarPermissoes(
  alteracoes: { perfilId: number; base: Base; unidades: string[] }[],
) {
  const c = conectar();
  const apagar = c.prepare("DELETE FROM permissoes WHERE perfil_id = ? AND base = ?");
  const inserir = c.prepare("INSERT INTO permissoes (perfil_id, base, unidade) VALUES (?, ?, ?)");
  c.exec("BEGIN");
  try {
    for (const a of alteracoes) {
      apagar.run(a.perfilId, a.base);
      for (const u of a.unidades) inserir.run(a.perfilId, a.base, u);
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

/*
 * A carga ativa DE UMA BASE.
 *
 * Era `SELECT * FROM cargas WHERE ativa = 1` com `.get()`, que devolve a
 * primeira linha que achar. Com uma base só, havia uma ativa e dava certo; com
 * duas, uma das bases desapareceria de todo lugar que pergunta pela carga
 * ativa — a lista de unidades da tela de permissões, o aviso de base carregada,
 * e a própria lerBase. Era a causa real do que parecia ser um problema da
 * tabela `unidades`.
 */
export function cargaAtiva(base: Base): ResumoCarga | null {
  const c = conectar();
  const r = c.prepare("SELECT * FROM cargas WHERE ativa = 1 AND base = ?").get(base) as
    | {
        id: number;
        base: Base;
        enviada_em: string;
        enviada_por: string | null;
        arquivos: string | null;
        linhas: number;
      }
    | undefined;
  if (!r) return null;
  return {
    id: r.id,
    base: r.base,
    enviadaEm: r.enviada_em,
    enviadaPor: r.enviada_por,
    arquivos: r.arquivos ? JSON.parse(r.arquivos) : [],
    linhas: r.linhas,
  };
}

/**
 * As unidades que a base ATIVA contém — as únicas que podem mostrar algum dado.
 *
 * Não é a tabela `unidades`, que acumula tudo o que já passou por aqui. A
 * diferença aparece quando uma igreja fecha: o nome dela continua no histórico,
 * mas oferecê-lo na tela de permissões faria o administrador marcar uma unidade
 * que não existe mais, e o pastor abriria um dashboard vazio sem ninguém
 * conseguir explicar por quê.
 *
 * Uma base sem carga ativa — Angola antes do primeiro envio — não tem unidade
 * nenhuma, e a lista vem vazia.
 */
export function listarUnidades(base: Base): string[] {
  const c = conectar();
  const carga = cargaAtiva(base);
  if (!carga) return [];
  return (
    c
      .prepare(
        "SELECT DISTINCT unidade FROM lancamentos WHERE carga_id = ? AND unidade <> '' ORDER BY unidade",
      )
      .all(carga.id) as { unidade: string }[]
  ).map((r) => r.unidade);
}

/**
 * Permissões que apontam para unidades ausentes da base ativa.
 *
 * Um pastor nesta lista abre o dashboard e não vê nada — e essa é a pergunta de
 * suporte mais provável do sistema. Mostrá-la na tela transforma um mistério
 * numa linha de texto.
 *
 * Conferido base a base: uma permissão de Angola é órfã se a unidade sumiu da
 * carga ativa de ANGOLA. Comparar com a lista de outra base daria falso
 * positivo — ou pior, esconderia uma órfã atrás de uma unidade de mesmo nome do
 * outro país.
 */
export function permissoesOrfas(): { perfilId: number; base: Base; unidade: string }[] {
  const c = conectar();
  const orfas: { perfilId: number; base: Base; unidade: string }[] = [];
  for (const base of BASES) {
    const vivas = new Set(listarUnidades(base));
    const linhas = c
      .prepare("SELECT perfil_id, unidade FROM permissoes WHERE base = ?")
      .all(base) as { perfil_id: number; unidade: string }[];
    for (const r of linhas) {
      if (!vivas.has(r.unidade)) orfas.push({ perfilId: r.perfil_id, base, unidade: r.unidade });
    }
  }
  return orfas;
}

export interface BaseCompleta {
  financial: FinancialRow[];
  membership: MembershipRow[];
  saldo: SaldoRow[];
  metaAnualPorUnidade: Record<string, number>;
  metaAnualTotalGeral: number;
  carga: ResumoCarga | null;
  /** O que a carga tem — ver src/lib/presenca.ts. Decide quais blocos existem. */
  presenca: Presenca;
  /**
   * Se quem pediu recebeu a base INTEIRA: o administrador, ou o pastor com
   * todas as unidades da carga (ver lerBase). Liga a visão consolidada no
   * dashboard — ver ehVisaoConsolidada em src/lib/consolidado.ts. Não dá poder
   * nenhum: o papel de quem pediu continua o mesmo.
   */
  baseInteira: boolean;
}

const VAZIA: BaseCompleta = {
  financial: [],
  membership: [],
  saldo: [],
  metaAnualPorUnidade: {},
  metaAnualTotalGeral: 0,
  carga: null,
  presenca: SEM_DADOS,
  baseInteira: false,
};

/*
 * Se a lista cobre TODAS as unidades com lançamento na carga.
 *
 * ESTE É O PORTÃO DA BASE INTEIRA. Quem passa aqui recebe a base sem filtro
 * nenhum — inclusive o que não é de unidade: as linhas de total, as
 * congregações da membresia sem lançamento. Antes desta regra, o recorte por
 * unidade protegia até o pastor que tinha todas; agora, a proteção desse caso
 * inteiro depende desta função. Cada escolha abaixo tem um motivo, e nenhuma
 * pode ser "simplificada" sem ler qual é:
 *
 * 1. UNIDADE POR UNIDADE, NUNCA POR CONTAGEM. A pergunta é "falta alguma
 *    unidade da carga na lista?" — e não "a lista tem tantos nomes quanto a
 *    carga tem unidades?". Uma contagem simples (`unidades.length >=
 *    daCarga.length`, ou o tamanho de um Set) abre a base inteira para quem NÃO
 *    tem todas: uma permissão órfã, de unidade que saiu da base, ocupa o lugar
 *    de uma unidade de verdade e fecha a conta — 21 unidades certas e uma
 *    órfã dão 22 —, e o pastor passa a receber a unidade que ninguém marcou
 *    para ele, sem erro nenhum e sem ninguém perceber. O mesmo acontece quando
 *    uma carga nova renomeia uma unidade: o mesmo número de nomes, nomes
 *    diferentes.
 *
 * 2. COMPARAÇÃO EXATA, sem tirar acento nem maiúscula. É a mesma do filtro
 *    `unidade IN (...)` de lerBase — o recorte que este portão substitui —, e
 *    o portão nunca pode dar mais do que aquele recorte daria, somado às linhas
 *    de total. Se uma carga nova escrever "Central Picos - Missoes", sem
 *    acento, a permissão "Central Picos - Missões" não casa no recorte; não
 *    pode casar aqui. As permissões guardam o nome como a lista de unidades o
 *    mostrou, então nome igual é o caso normal, e nome diferente pede que o
 *    administrador marque de novo.
 *
 * 3. Unidade A MAIS na lista não atrapalha: a permissão órfã é sobra, não
 *    acesso. O que decide é não faltar nenhuma unidade da carga.
 *
 * 4. Carga sem unidade nenhuma nunca é coberta: "todas" de nada seria verdade
 *    por vacuidade, e entregaria o total da rede a qualquer pastor.
 *
 * Cada um dos quatro pontos tem teste em testes/visao-por-perfil.test.ts.
 */
function unidadesCobremACarga(
  c: DatabaseSync,
  cargaId: number,
  unidades: readonly string[],
): boolean {
  const daCarga = c
    .prepare("SELECT DISTINCT unidade FROM lancamentos WHERE carga_id = ? AND unidade <> ''")
    .all(cargaId) as { unidade: string }[];
  if (!daCarga.length) return false;
  const permitidas = new Set(unidades);
  return daCarga.every((r) => permitidas.has(r.unidade));
}

/**
 * A PORTA ÚNICA de leitura das bases. Nenhum outro trecho do projeto consulta
 * as tabelas de dados — e é por isso que existe apenas um lugar para auditar
 * quando a pergunta for "esse pastor podia mesmo ver isso?".
 *
 * `unidades` é a lista do que quem pediu tem direito a ver; `null` significa
 * "tudo", e é o que o administrador recebe. O recorte acontece aqui, no
 * servidor: o navegador do pastor nunca chega a receber uma linha das outras
 * unidades, então esconder na tela nunca fez parte do desenho.
 *
 * Uma lista que cobre TODAS as unidades da carga também é "tudo": quem vê
 * todas as unidades recebe a base inteira, como o administrador (ver abaixo).
 */
export function lerBase(base: Base, unidades: string[] | null): BaseCompleta {
  const c = conectar();
  /*
   * A base escolhe a carga, e tudo o mais — lançamentos, membresia, saldos,
   * metas — é lido por `carga_id`. É assim que a base chega a todas as
   * tabelas sem coluna nova em nenhuma delas: elas herdam pela carga.
   *
   * `unidades` precisa ter sido lida DENTRO desta mesma base (ver
   * unidadesDoPerfil). Esta função confia nisso, e é a única que confia: é a
   * porta única de leitura, e a regra de quem vê o quê vive em quem a chama.
   */
  const carga = cargaAtiva(base);
  if (!carga) return VAZIA;

  /*
   * Sem nenhuma unidade permitida o recorte é vazio, e não "tudo" — e vazio
   * por inteiro, sem a `carga` junto. Antes ela ia: a data do envio, quem
   * enviou, os nomes dos arquivos e o total de linhas da base. Com uma base só
   * era inofensivo; com duas, um pastor só do Brasil que pedisse Angola direto
   * ao servidor receberia a prova de que Angola existe, e o tamanho dela. A
   * tela não usa esse campo, então nada muda para quem pede a própria base.
   */
  if (unidades && unidades.length === 0) return VAZIA;

  /*
   * Quem vê TODAS as unidades da carga recebe a base inteira — exatamente o que
   * o administrador recebe: as linhas de total (a "Total Geral" da membresia e
   * a da meta, a linha do país), as congregações da membresia que ainda não têm
   * lançamento, os lançamentos sem unidade. Decisão da Central, 09/10: o pastor
   * com todas as unidades marcadas vê os mesmos números do Financeiro. Só os
   * números — o papel continua de pastor; isto não abre tela nem permissão.
   *
   * Sem isto, o mesmo pastor via outra rede: a membresia somada só das
   * unidades com lançamento, a meta somada coluna por coluna em vez da "Meta
   * Anual Total Geral", e nenhuma das regras da visão consolidada.
   *
   * A conferência é feita AQUI, contra a carga que vai ser lida, e não antes de
   * chamar: se uma carga nova, com uma unidade a mais, fosse ativada entre a
   * conferência e a leitura, quem não tem essa unidade receberia a base nova
   * inteira. E ela é refeita a cada leitura: marcar ou desmarcar uma unidade, ou
   * uma base nova trazer uma unidade que o pastor ainda não tem, muda o
   * resultado na hora. Como a conferência é feita — e por que não é uma
   * contagem — está em unidadesCobremACarga, logo acima.
   */
  const baseInteira = unidades === null || unidadesCobremACarga(c, carga.id, unidades);
  const recorte = baseInteira ? null : unidades;

  const filtro = recorte ? ` AND unidade IN (${recorte.map(() => "?").join(",")})` : "";
  const args = recorte ? [carga.id, ...recorte] : [carga.id];

  const lanc = c
    .prepare(`SELECT * FROM lancamentos WHERE carga_id = ?${filtro}`)
    .all(...args) as LinhaSQL[];

  const financial: FinancialRow[] = lanc.map((r) => ({
    unidade: txt(r.unidade),
    nat2: txt(r.nat2),
    nat3: txt(r.nat3),
    nat4: txt(r.nat4),
    razaoSocial: txt(r.razao_social),
    projeto: txt(r.projeto),
    meta: txt(r.meta),
    credito: num(r.credito),
    credito1: num(r.credito1),
    debito: num(r.debito),
    debito1: num(r.debito1),
    data: r.data ? new Date(txt(r.data)) : null,
    dia: num(r.dia),
    mes: num(r.mes),
    ano: num(r.ano),
    nroUnico: txt(r.nro_unico),
  }));

  /*
   * A membresia tem uma linha "Total Geral" na própria planilha, e ela é o
   * número que a Seção 2 lê quando nenhuma unidade está filtrada. Para quem vê
   * a base inteira ela vem junto; para o pastor que vê parte dela, não — senão
   * o denominador do dízimo per capita seria o da rede inteira contra o
   * numerador de duas igrejas.
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
  const filtroMeta = recorte ? ` AND unidade IN (${recorte.map(() => "?").join(",")})` : "";
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
   *
   * As unidades de `metaForaDasSomas` (bases.ts) não entram: é soma de
   * unidades, e a meta delas só conta no Total Geral — que este pastor não vê.
   * Hoje a coluna da Central Picos - Missões tem outro nome e nem chega aqui;
   * no dia em que o cabeçalho for corrigido, chegaria, e entraria na soma.
   */
  if (!metaAnualTotalGeral) {
    metaAnualTotalGeral = Object.entries(metaAnualPorUnidade)
      .filter(([unidade]) => !metaFicaForaDasSomas(unidade, base))
      .reduce((s, [, v]) => s + v, 0);
  }

  return {
    financial,
    membership,
    saldo,
    metaAnualPorUnidade,
    metaAnualTotalGeral,
    carga,
    presenca: presencaDaCarga(c, carga.id),
    baseInteira,
  };
}

/*
 * O que a carga tem, lido da carga INTEIRA — sem o filtro de unidades acima.
 *
 * É de propósito: a presença responde "esta base tem meta?", e não "estas
 * unidades têm meta?". Um pastor cuja unidade não tem coluna de meta continua
 * vendo o card de meta, exatamente como sempre viu. O que ele recebe é um sim
 * ou não sobre a base dele — nenhum número de outra unidade.
 *
 * As regras são as de src/lib/presenca.ts. A do (A) roda lá, sobre as metas da
 * carga — poucas linhas, uma por unidade. A do (B) roda aqui, em SQL, porque
 * precisaria trazer todos os lançamentos para olhar uma coluna; ela para no
 * primeiro preenchido.
 */
function presencaDaCarga(c: DatabaseSync, cargaId: number): Presenca {
  const metas = c.prepare("SELECT anual FROM metas WHERE carga_id = ?").all(cargaId) as {
    anual: number;
  }[];
  return {
    metaDeDizimos: temMetaDeDizimos(metas.map((m) => m.anual)),
    metasDeAplicacao: !!c
      .prepare("SELECT 1 FROM lancamentos WHERE carga_id = ? AND TRIM(meta) <> '' LIMIT 1")
      .get(cargaId),
    membresia: !!c.prepare("SELECT 1 FROM membresia WHERE carga_id = ? LIMIT 1").get(cargaId),
    saldo: !!c.prepare("SELECT 1 FROM saldos WHERE carga_id = ? LIMIT 1").get(cargaId),
  };
}

/**
 * O que a carga ATIVA de uma base tem, ou nulo se a base ainda não tem carga.
 *
 * Para a tela de envio: ela avisa, antes de enviar, quando a carga nova vai
 * sair sem a membresia ou o saldo que a atual tem — cada envio substitui a
 * carga inteira, e o que não vier nele deixa de aparecer.
 */
export function presencaDaCargaAtiva(base: Base): Presenca | null {
  const carga = cargaAtiva(base);
  return carga ? presencaDaCarga(conectar(), carga.id) : null;
}
