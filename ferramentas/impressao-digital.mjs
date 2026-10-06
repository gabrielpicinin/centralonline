/*
 * Impressão digital do banco: quantas linhas cada tabela tem, e um hash do
 * conteúdo de cada uma.
 *
 * Existe para que a migração das duas bases (Brasil e Angola) possa ser
 * CONFERIDA, e não só confiada. A regra é que nenhuma linha se perde, e
 * "nenhuma" se prova contando e comparando o conteúdo, tabela por tabela,
 * antes e depois.
 *
 * USO, na pasta do projeto:
 *
 *   node ferramentas/impressao-digital.mjs <banco.db>
 *       mostra a impressão de um banco.
 *
 *   node ferramentas/impressao-digital.mjs <antes.db> <depois.db>
 *       compara dois — o backup feito antes da atualização e um feito logo
 *       depois do primeiro acesso, antes de qualquer envio novo. Sai com
 *       código 1 se qualquer tabela diferir.
 *
 * SÓ LÊ. O arquivo é aberto em modo somente-leitura e nada é gravado em lugar
 * nenhum. Rode sobre backups feitos com ferramentas/backup.mjs.
 *
 * O que entra na comparação: o conteúdo de cada tabela nas colunas que
 * existiam ANTES. Coluna que a migração acrescenta — a `base` — fica de fora,
 * porque o "antes" não a tem. A ordem física das linhas também não conta: o
 * hash é calculado com as linhas em ordem de conteúdo, porque recriar uma
 * tabela (a migração recria `permissoes`) e o VACUUM do backup podem mudar a
 * ordem em que elas estão gravadas sem mudar uma vírgula do que está guardado.
 */
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Todas as tabelas com dado. Nenhuma fica de fora: a pergunta é "perdeu alguma linha?". */
export const TABELAS = [
  "cargas",
  "lancamentos",
  "membresia",
  "saldos",
  "metas",
  "unidades",
  "perfis",
  "permissoes",
];

/** Colunas criadas pela migração das duas bases — não existem no "antes". */
const COLUNAS_NOVAS = new Set(["base"]);

/*
 * Os nomes de tabela e de coluna entram no texto do SQL, e não como parâmetro,
 * porque o SQLite não aceita parâmetro nesses lugares. Eles vêm da lista acima
 * e do próprio esquema do banco, nunca de quem digita o comando — mas, como o
 * arquivo pode ser qualquer um, o nome é conferido antes de ir para o SQL.
 */
const identificador = (nome) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(nome)) throw new Error(`nome inesperado no esquema: ${nome}`);
  return `"${nome}"`;
};

/**
 * Calcula a impressão de um banco.
 *
 * `colunas`, quando vem, diz quais colunas usar em cada tabela — é como o
 * "depois" é medido com a régua do "antes". Sem ela, usa todas menos as novas.
 */
export function impressaoDigital(caminho, { colunas } = {}) {
  if (!existsSync(caminho)) throw new Error(`não existe: ${caminho}`);
  const db = new DatabaseSync(caminho, { readOnly: true });
  try {
    // Um retrato só do banco inteiro, mesmo que alguém grave ao lado.
    db.exec("BEGIN");

    const tabelas = {};
    for (const tabela of TABELAS) {
      const existentes = db
        .prepare(`PRAGMA table_info(${identificador(tabela)})`)
        .all()
        .map((r) => r.name);
      if (!existentes.length) {
        tabelas[tabela] = null;
        continue;
      }

      const usar = [
        ...(colunas?.[tabela] ?? existentes.filter((c) => !COLUNAS_NOVAS.has(c))),
      ].sort();
      const faltando = usar.filter((c) => !existentes.includes(c));
      if (faltando.length) {
        tabelas[tabela] = { erro: `sem as colunas ${faltando.join(", ")}` };
        continue;
      }

      const lista = usar.map(identificador).join(", ");
      const hash = createHash("sha256");
      let linhas = 0;
      for (const r of db
        .prepare(`SELECT ${lista} FROM ${identificador(tabela)} ORDER BY ${lista}`)
        .iterate()) {
        hash.update(JSON.stringify(usar.map((c) => r[c])) + "\n");
        linhas++;
      }

      // Só informativo: como as linhas se dividem entre as bases, quando já há base.
      const porBase = existentes.includes("base")
        ? Object.fromEntries(
            db
              .prepare(`SELECT base, COUNT(*) AS n FROM ${identificador(tabela)} GROUP BY base`)
              .all()
              .map((r) => [r.base, r.n]),
          )
        : null;

      tabelas[tabela] = { linhas, colunas: usar, hash: hash.digest("hex"), porBase };
    }

    /*
     * Os contadores do AUTOINCREMENT. Se voltassem para trás, a próxima carga
     * poderia ganhar o número de uma antiga — e tudo que pendura nela por
     * carga_id ficaria ambíguo.
     */
    const temSequencias = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'")
      .get();
    const sequencias = temSequencias
      ? Object.fromEntries(
          db
            .prepare("SELECT name, seq FROM sqlite_sequence ORDER BY name")
            .all()
            .map((r) => [r.name, r.seq]),
        )
      : {};

    const integridade = db
      .prepare("PRAGMA integrity_check")
      .all()
      .map((r) => Object.values(r)[0])
      .join("; ");

    /*
     * Linhas que apontam para um pai que não existe — por exemplo, uma
     * permissão de um perfil apagado à mão. A migração recusa copiar uma
     * dessas e para; melhor descobrir aqui, num backup, do que no servidor.
     */
    const violacoes = {};
    for (const v of db.prepare("PRAGMA foreign_key_check").all()) {
      violacoes[v.table] = (violacoes[v.table] ?? 0) + 1;
    }

    /*
     * E, das órfãs, as de permissões dizem QUAL perfil: é o que a migração
     * pede para apagar antes de seguir, e com o número em mãos isso é um
     * comando só.
     */
    const perfisOrfaos =
      tabelas.permissoes && tabelas.perfis
        ? db
            .prepare(
              `SELECT DISTINCT perfil_id AS id FROM permissoes
                WHERE perfil_id NOT IN (SELECT id FROM perfis) ORDER BY perfil_id`,
            )
            .all()
            .map((r) => r.id)
        : [];

    db.exec("COMMIT");
    return { arquivo: resolve(caminho), tabelas, sequencias, integridade, violacoes, perfisOrfaos };
  } finally {
    db.close();
  }
}

/** As colunas usadas em cada tabela — a régua para medir o "depois". */
export function colunasDe(impressao) {
  return Object.fromEntries(
    Object.entries(impressao.tabelas)
      .filter(([, t]) => t && t.colunas)
      .map(([nome, t]) => [nome, t.colunas]),
  );
}

/** Lista o que difere entre duas impressões. Vazia quer dizer: nenhuma linha mudou. */
export function comparar(antes, depois) {
  const diferencas = [];
  for (const tabela of TABELAS) {
    const a = antes.tabelas[tabela];
    const d = depois.tabelas[tabela];
    if (!a && !d) continue;
    if (!a || !d) {
      diferencas.push(`${tabela}: existe só ${a ? "antes" : "depois"}`);
    } else if (a.erro || d.erro) {
      diferencas.push(`${tabela}: ${a.erro ?? d.erro}`);
    } else if (a.linhas !== d.linhas) {
      diferencas.push(`${tabela}: ${a.linhas} linhas antes, ${d.linhas} depois`);
    } else if (a.hash !== d.hash) {
      diferencas.push(`${tabela}: as mesmas ${a.linhas} linhas, mas com conteúdo diferente`);
    }
  }
  for (const [nome, seq] of Object.entries(antes.sequencias)) {
    if ((depois.sequencias[nome] ?? 0) < seq) {
      diferencas.push(`contador de ${nome} voltou de ${seq} para ${depois.sequencias[nome] ?? 0}`);
    }
  }
  if (depois.integridade !== "ok") diferencas.push(`integridade depois: ${depois.integridade}`);
  return diferencas;
}

/* ============================ relatório ============================ */

const n = (v) => Number(v).toLocaleString("pt-BR");

/**
 * A impressão em linhas de texto, para gente ler. Com `outra`, marca cada
 * tabela como igual ou diferente dela. Usada aqui e no teste de migração.
 */
export function descrever(titulo, imp, outra) {
  const linhas = [`${titulo}: ${imp.arquivo}`];
  for (const tabela of TABELAS) {
    const t = imp.tabelas[tabela];
    if (!t) {
      linhas.push(`  ${tabela.padEnd(12)} (não existe)`);
      continue;
    }
    if (t.erro) {
      linhas.push(`  ${tabela.padEnd(12)} ${t.erro}`);
      continue;
    }
    const o = outra?.tabelas[tabela];
    const marca = !outra ? "" : o && !o.erro && o.hash === t.hash ? "  igual" : "  DIFERENTE";
    const bases = t.porBase
      ? "  por base: " +
        Object.entries(t.porBase)
          .map(([b, q]) => `${b} ${n(q)}`)
          .join(", ")
      : "";
    linhas.push(
      `  ${tabela.padEnd(12)} ${n(t.linhas).padStart(9)} linhas  ${t.hash.slice(0, 16)}${marca}${bases}`,
    );
  }
  const violacoes = Object.entries(imp.violacoes);
  linhas.push(`  integridade: ${imp.integridade}`);
  linhas.push(
    `  chaves estrangeiras: ${
      violacoes.length
        ? violacoes.map(([t, q]) => `${q} linha(s) órfã(s) em ${t}`).join(", ")
        : "nenhuma linha órfã"
    }`,
  );
  if (imp.perfisOrfaos.length) {
    const ids = imp.perfisOrfaos.join(", ");
    linhas.push(`  permissões de perfis que não existem mais: perfil_id ${ids}`);
    linhas.push(
      `    a migração para nelas; para seguir: DELETE FROM permissoes WHERE perfil_id IN (${ids});`,
    );
  }
  return linhas;
}

/* ============================ linha de comando ============================ */

const mostrar = (...args) => console.log(descrever(...args).join("\n"));

const rodandoDireto =
  process.argv[1] &&
  resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();

if (rodandoDireto) {
  const [primeiro, segundo] = process.argv.slice(2);
  if (!primeiro) {
    console.error("Uso: node ferramentas/impressao-digital.mjs <banco.db> [<outro.db>]");
    process.exit(2);
  }
  try {
    const antes = impressaoDigital(primeiro);
    if (!segundo) {
      mostrar("Banco", antes);
    } else {
      // O segundo é medido com a régua do primeiro: as colunas que o "antes" tinha.
      const depois = impressaoDigital(segundo, { colunas: colunasDe(antes) });
      mostrar("Antes ", antes);
      console.log("");
      mostrar("Depois", depois, antes);
      console.log("");
      const diferencas = comparar(antes, depois);
      if (diferencas.length) {
        console.log("DIFERENÇAS:");
        for (const d of diferencas) console.log(`  - ${d}`);
        process.exit(1);
      }
      console.log("Nenhuma linha perdida ou alterada em nenhuma tabela.");
    }
  } catch (e) {
    console.error("Falhou:", e.message);
    process.exit(1);
  }
}
