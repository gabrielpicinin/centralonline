/*
 * A senha recuperável do pastor, e as garantias que o código promete sobre ela.
 *
 * Guardar senha de forma recuperável é o tipo de decisão que se degrada em
 * silêncio: basta um caminho novo esquecer de conferir o papel, ou uma troca de
 * senha esquecer a cópia cifrada, e o sistema passa a mostrar a senha errada —
 * ou a do administrador. Cada teste aqui fixa uma dessas promessas.
 *
 * Roda com `node --test`, sem framework e sem dependência, igual aos outros.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* O banco lê a pasta na carga do módulo; a senha lê o segredo a cada chamada. */
const PASTA = mkdtempSync(join(tmpdir(), "central-senha-"));
process.env.DADOS_DIR = PASTA;
const SEGREDO_ORIGINAL = "segredo-de-teste-com-mais-de-trinta-e-dois-caracteres";
process.env.SESSION_SECRET = SEGREDO_ORIGINAL;

type Banco = typeof import("../src/lib/banco.server.ts");
type Senha = typeof import("../src/lib/senha.server.ts");
let banco: Banco;
let senha: Senha;

before(async () => {
  banco = await import("../src/lib/banco.server.ts");
  senha = await import("../src/lib/senha.server.ts");
});

after(() => {
  // Fecha antes de apagar: no Windows um arquivo aberto não pode ser removido.
  banco.fechar();
  rmSync(PASTA, { recursive: true, force: true });
});

test("cifrar e decifrar devolve a mesma senha", () => {
  const original = "oliveira-4712";
  assert.equal(senha.decifrarSenha(senha.cifrarSenha(original)), original);
});

test("a mesma senha cifrada duas vezes dá dois valores diferentes", () => {
  /*
   * Sem vetor aleatório, duas contas com a mesma senha teriam o mesmo valor no
   * banco — e quem lesse o arquivo saberia quais pastores compartilham senha
   * sem decifrar nada.
   */
  const a = senha.cifrarSenha("vento-1234");
  const b = senha.cifrarSenha("vento-1234");
  assert.notEqual(a, b);
});

test("o banco não guarda a senha em texto", () => {
  const cifrada = senha.cifrarSenha("farol-9090");
  assert.ok(!cifrada.includes("farol"), "a palavra da senha aparece no valor guardado");
  assert.ok(!cifrada.includes("9090"), "os dígitos da senha aparecem no valor guardado");
});

test("SESSION_SECRET trocado: não decifra, e devolve nada em vez de lixo", () => {
  /*
   * É a consequência documentada de trocar o segredo. O importante é o
   * formato da falha: nulo, que a tela transforma em "gere outra". Uma senha
   * errada exibida como certa seria o pior resultado possível.
   */
  const guardada = senha.cifrarSenha("trilha-5555");
  process.env.SESSION_SECRET = "outro-segredo-completamente-diferente-com-32-caracteres";
  try {
    assert.equal(senha.decifrarSenha(guardada), null);
  } finally {
    process.env.SESSION_SECRET = SEGREDO_ORIGINAL;
  }
});

test("valor adulterado no banco não decifra", () => {
  const guardada = senha.cifrarSenha("semente-3131");
  const partes = guardada.split("$");
  // Troca um caractere do corpo cifrado.
  const corpo = partes[3];
  partes[3] = (corpo[0] === "A" ? "B" : "A") + corpo.slice(1);
  assert.equal(senha.decifrarSenha(partes.join("$")), null);
});

test("formato desconhecido não decifra nem derruba", () => {
  assert.equal(senha.decifrarSenha(""), null);
  assert.equal(senha.decifrarSenha("texto-qualquer"), null);
  assert.equal(senha.decifrarSenha("v9$a$b$c"), null);
});

test("a senha do ADMINISTRADOR nunca é guardada recuperável", () => {
  /*
   * Mesmo que alguém passe a cifrada por engano, criarPerfil a descarta para
   * administrador. E a consulta de leitura filtra por papel — duas camadas.
   */
  const admin = banco.criarPerfil({
    usuario: "Financeiro",
    nome: "Financeiro",
    papel: "admin",
    senhaHash: "scrypt$x$x$x$x$x",
    senhaCifrada: senha.cifrarSenha("nao-deveria-ficar"),
  });
  assert.equal(banco.senhaCifradaDoPastor(admin.id), null);
});

test("pastor tem a senha recuperável e ela bate com a gerada", () => {
  const gerada = "girassol-2468";
  const p = banco.criarPerfil({
    usuario: "pastor.a@central.online",
    nome: "Pastor A",
    papel: "pastor",
    senhaHash: "scrypt$x$x$x$x$x",
    senhaCifrada: senha.cifrarSenha(gerada),
  });
  const guardada = banco.senhaCifradaDoPastor(p.id);
  assert.ok(guardada);
  assert.equal(senha.decifrarSenha(guardada), gerada);
});

test("gerar senha nova troca a recuperável junto — nunca mostra a antiga", () => {
  /*
   * O defeito que este teste impede: hash novo, cifrada velha. O "Mostrar
   * senha" exibiria uma senha que não funciona mais.
   */
  const p = banco.criarPerfil({
    usuario: "pastor.b@central.online",
    nome: "Pastor B",
    papel: "pastor",
    senhaHash: "scrypt$antigo$x$x$x$x",
    senhaCifrada: senha.cifrarSenha("antiga-1111"),
  });
  banco.trocarSenha(p.id, "scrypt$novo$x$x$x$x", senha.cifrarSenha("nova-2222"));
  assert.equal(senha.decifrarSenha(banco.senhaCifradaDoPastor(p.id)!), "nova-2222");
});

test("trocar a senha sem cifrada apaga a recuperável, como faz a ferramenta de emergência", () => {
  const p = banco.criarPerfil({
    usuario: "pastor.c@central.online",
    nome: "Pastor C",
    papel: "pastor",
    senhaHash: "scrypt$x$x$x$x$x",
    senhaCifrada: senha.cifrarSenha("sumira-3333"),
  });
  banco.trocarSenha(p.id, "scrypt$y$y$y$y$y", null);
  assert.equal(banco.senhaCifradaDoPastor(p.id), null);
});

test("a listagem diz SE há senha, mas nunca traz a senha", () => {
  const lista = banco.listarPastores();
  const b = lista.find((x) => x.usuario === "pastor.b@central.online");
  const c = lista.find((x) => x.usuario === "pastor.c@central.online");
  assert.equal(b?.temSenhaVisivel, true);
  assert.equal(c?.temSenhaVisivel, false);
  // Nenhum campo da listagem pode conter o valor cifrado nem a senha.
  const serializado = JSON.stringify(lista);
  assert.ok(!serializado.includes("v1$"), "a listagem vazou o valor cifrado");
  assert.ok(!serializado.includes("nova-2222"), "a listagem vazou a senha");
});

test("último acesso: nulo até entrar, preenchido depois", () => {
  const antes = banco.listarPastores().find((x) => x.usuario === "pastor.a@central.online");
  assert.equal(antes?.ultimoAcesso, null, "quem nunca entrou precisa aparecer como nunca");

  const marco = Date.now();
  banco.registrarAcesso(antes!.id);

  const depois = banco.listarPastores().find((x) => x.usuario === "pastor.a@central.online");
  assert.ok(depois?.ultimoAcesso, "o acesso não foi registrado");
  assert.ok(Date.parse(depois!.ultimoAcesso!) >= marco - 1000, "a data registrada é antiga demais");
});
