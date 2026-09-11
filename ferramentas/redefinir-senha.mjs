/*
 * A chave reserva.
 *
 * Existe para um caso só: a senha do Financeiro se perdeu e ninguém entra.
 * Como não há envio de e-mail, não existe "esqueci minha senha" — e a conta do
 * Financeiro é a única que administra as outras. Sem esta ferramenta, o sistema
 * ficaria trancado com os dados dentro.
 *
 * Não é um passo de instalação. É a página do manual que se espera nunca abrir.
 *
 * Só roda para quem tem acesso ao servidor e à pasta do banco — é a chave
 * reserva guardada com quem já tem a chave do prédio, e não uma porta a mais.
 *
 * USO, dentro da pasta do projeto no servidor:
 *
 *   node ferramentas/redefinir-senha.mjs Financeiro
 *   node ferramentas/redefinir-senha.mjs pastor@central.online
 *
 * Ele imprime uma senha nova. A antiga deixa de valer no mesmo instante.
 */
import { DatabaseSync } from "node:sqlite";
import { randomBytes, scryptSync } from "node:crypto";
import { join } from "node:path";
import { existsSync } from "node:fs";

const PASTA = process.env.DADOS_DIR ?? join(process.cwd(), "dados");
const ARQUIVO = join(PASTA, "central.db");

const usuario = process.argv[2];
if (!usuario) {
  console.error("Uso: node ferramentas/redefinir-senha.mjs <usuario ou e-mail>");
  console.error("Exemplo: node ferramentas/redefinir-senha.mjs Financeiro");
  process.exit(1);
}

if (!existsSync(ARQUIVO)) {
  console.error(`Não encontrei o banco em ${ARQUIVO}.`);
  console.error("Rode de dentro da pasta do projeto, ou defina DADOS_DIR.");
  process.exit(1);
}

/*
 * Os parâmetros do scrypt são os mesmos de src/lib/senha.server.ts. Se um dia
 * mudarem lá, precisam mudar aqui — o formato gravado carrega os valores, então
 * uma senha antiga continua conferindo, mas uma gerada aqui com parâmetros
 * diferentes viraria um hash que o app não reconheceria como equivalente.
 */
const N = 16384;
const r = 8;
const p = 1;

const PALAVRAS = [
  "aurora", "bonanca", "campina", "duna", "estrela", "farol", "girassol",
  "horizonte", "ilha", "jardim", "lago", "manha", "nascente", "oliveira",
  "pedra", "quintal", "raiz", "semente", "trilha", "vale", "vento", "vitoria",
];

const senha =
  PALAVRAS[randomBytes(1)[0] % PALAVRAS.length] +
  "-" +
  (1000 + (randomBytes(2).readUInt16BE(0) % 9000));

const sal = randomBytes(16);
const chave = scryptSync(senha.normalize("NFKC"), sal, 64, { N, r, p });
const hash = `scrypt$${N}$${r}$${p}$${sal.toString("hex")}$${chave.toString("hex")}`;

const db = new DatabaseSync(ARQUIVO);
const perfil = db
  .prepare("SELECT id, usuario, papel, ativo FROM perfis WHERE chave = ?")
  .get(usuario.trim().toLowerCase());

if (!perfil) {
  console.error(`Não existe conta com o usuário "${usuario}".`);
  const todos = db.prepare("SELECT usuario, papel FROM perfis ORDER BY papel, usuario").all();
  if (todos.length) {
    console.error("\nContas existentes:");
    for (const c of todos) console.error(`  ${c.usuario}  (${c.papel})`);
  } else {
    console.error("\nO banco não tem nenhuma conta — abra o site e crie o acesso do Financeiro.");
  }
  db.close();
  process.exit(1);
}

db.prepare("UPDATE perfis SET senha_hash = ? WHERE id = ?").run(hash, perfil.id);

/* Uma conta desativada não entra, mesmo com a senha certa. Avisar poupa uma
   meia hora de gente conferindo se digitou errado. */
if (!perfil.ativo) {
  console.log("AVISO: esta conta está DESATIVADA e não vai entrar mesmo com a senha nova.");
  console.log("       Reative pela tela do administrador, em Unidades por pastor.\n");
}

console.log(`Senha redefinida para ${perfil.usuario} (${perfil.papel}).`);
console.log("");
console.log(`    ${senha}`);
console.log("");
console.log("A senha anterior deixou de valer. Entregue esta à pessoa e peça que");
console.log("a guarde num gerenciador de senhas.");
db.close();
