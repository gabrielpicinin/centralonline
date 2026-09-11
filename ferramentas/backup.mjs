/*
 * Backup do banco, com o sistema no ar.
 *
 * Existe porque copiar o arquivo do banco enquanto ele está sendo usado não é
 * seguro, e a razão não é óbvia: o SQLite trabalha em modo WAL, e as escritas
 * mais recentes ficam num arquivo ao lado (`central.db-wal`) até serem
 * consolidadas. Medido neste projeto, com o servidor rodando: o `central.db`
 * tinha 122 KB enquanto o `-wal` guardava 86 KB de gravações ainda não
 * incorporadas. Uma cópia só do `.db` teria perdido 300 lançamentos — e nada
 * indicaria isso, porque o arquivo abriria normalmente.
 *
 * O comando abaixo pede ao próprio SQLite um retrato consistente, incluindo o
 * que está no WAL, num arquivo único. Pode rodar com gente usando o sistema.
 *
 * USO, na pasta do projeto no servidor:
 *
 *   node ferramentas/backup.mjs
 *   node ferramentas/backup.mjs /mnt/backup/central
 *
 * Sem argumento, grava em `backups/` ao lado da pasta de dados. O nome leva a
 * data e a hora, então chamadas repetidas não se sobrescrevem.
 */
import { DatabaseSync } from "node:sqlite";
import { join, resolve, isAbsolute } from "node:path";
import { existsSync, mkdirSync, statSync } from "node:fs";

const PASTA_DADOS = process.env.DADOS_DIR ?? join(process.cwd(), "dados");
const ARQUIVO = join(PASTA_DADOS, "central.db");

if (!existsSync(ARQUIVO)) {
  console.error(`Não encontrei o banco em ${ARQUIVO}.`);
  console.error("Rode de dentro da pasta do projeto, ou defina DADOS_DIR.");
  process.exit(1);
}

const destinoPasta = process.argv[2]
  ? isAbsolute(process.argv[2])
    ? process.argv[2]
    : resolve(process.argv[2])
  : join(process.cwd(), "backups");
mkdirSync(destinoPasta, { recursive: true });

/* 2026-09-11T16-42-07 — ordenável por nome, sem caractere que o Windows recuse. */
const carimbo = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
const destino = join(destinoPasta, `central-${carimbo}.db`);

if (existsSync(destino)) {
  console.error(`Já existe ${destino}. Nada foi feito.`);
  process.exit(1);
}

const db = new DatabaseSync(ARQUIVO, { readOnly: true });
try {
  /*
   * O caminho vai entre aspas simples e com as barras invertidas trocadas: o
   * SQLite espera barra normal mesmo no Windows, e um caminho com aspas dentro
   * quebraria o comando. Nenhum dos dois vem de entrada de usuário remoto —
   * quem roda isto já tem acesso ao servidor —, mas caminho de rede do Windows
   * tem barra invertida de sobra e quebraria sem a troca.
   */
  const caminho = destino.replace(/\\/g, "/").replace(/'/g, "''");
  db.exec(`VACUUM INTO '${caminho}'`);
} catch (e) {
  console.error("Falhou:", e.message);
  db.close();
  process.exit(1);
}
db.close();

const tamanho = statSync(destino).size;
console.log(`Backup gravado: ${destino}`);
console.log(`Tamanho: ${(tamanho / 1024 / 1024).toFixed(2)} MB`);
console.log("");
console.log("Este arquivo sozinho é o backup completo — contas, senhas,");
console.log("permissões e as bases enviadas. Leve uma cópia para fora do prédio.");
