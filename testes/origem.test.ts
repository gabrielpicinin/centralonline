/*
 * O freio de força bruta precisa de um balde que o atacante não escolha.
 *
 * Estes testes existem porque a versão anterior tinha exatamente esse defeito e
 * ele passou despercebido por meses: a origem saía do PRIMEIRO elemento do
 * `x-forwarded-for`, que é a parte que o cliente manda. Quem trocasse o valor a
 * cada tentativa ganhava um balde novo toda vez, e o atraso progressivo nunca
 * chegava a atrasar nada.
 *
 * Sem TLS na implantação atual, a resistência do login é a única defesa real.
 * Um teste que falha quando alguém volta atrás nisso vale mais do que o
 * comentário explicando.
 *
 * Roda com `node --test`, sem framework e sem dependência — igual ao
 * recorte.test.ts.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { origemDaRequisicao } from "../src/lib/origem.ts";

/*
 * O que o Apache produz. Ele ACRESCENTA a observação dele ao que veio de fora,
 * conforme a documentação do mod_proxy — então o endereço real fica no fim.
 */
const IP_REAL = "192.168.1.77";
const comoApacheEntrega = (mandadoPeloCliente: string | null) =>
  mandadoPeloCliente === null ? IP_REAL : `${mandadoPeloCliente}, ${IP_REAL}`;

test("cliente honesto: a origem é o endereço que o proxy viu", () => {
  assert.equal(origemDaRequisicao(comoApacheEntrega(null)), IP_REAL);
});

test("x-forwarded-for forjado NÃO ganha balde novo", () => {
  /*
   * O coração do teste. O atacante inventa um valor diferente a cada tentativa;
   * todas têm que cair no mesmo balde, senão o atraso progressivo nunca sobe.
   */
  const tentativas = [
    "9.9.9.9",
    "10.0.0.1",
    "203.0.113.5",
    "1.1.1.1, 2.2.2.2, 3.3.3.3",
    "desconhecido",
    IP_REAL, // tentando imitar o endereço real, para ver se confunde
  ];

  const baldes = new Set(tentativas.map((t) => origemDaRequisicao(comoApacheEntrega(t))));

  assert.equal(
    baldes.size,
    1,
    `cada valor forjado gerou um balde diferente: ${[...baldes].join(" | ")}`,
  );
  assert.equal([...baldes][0], IP_REAL);
});

test("dois endereços reais diferentes continuam em baldes diferentes", () => {
  /*
   * O contrário também precisa valer: se tudo caísse no mesmo balde, quem
   * errasse a senha atrasaria todo mundo junto. O freio tem que distinguir
   * origens de verdade.
   */
  const a = origemDaRequisicao(comoApacheEntrega(null));
  const b = origemDaRequisicao("192.168.1.99");
  assert.notEqual(a, b);
});

test("sem cabeçalho nenhum, cai no balde compartilhado", () => {
  /*
   * Acesso direto à porta, ou proxy sem ProxyAddHeaders. Todo mundo junto é
   * deliberado: o atraso para em 5s, então o pior caso é uma espera, nunca
   * alguém trancado para fora.
   */
  assert.equal(origemDaRequisicao(null), "desconhecido");
  assert.equal(origemDaRequisicao(undefined), "desconhecido");
  assert.equal(origemDaRequisicao(""), "desconhecido");
});

test("lista malformada não vira balde vazio nem derruba o login", () => {
  /*
   * Vírgulas soltas e espaços são o que se recebe de quem está sondando. O
   * resultado nunca pode ser string vazia: duas requisições com lixo diferente
   * cairiam em baldes distintos se cada uma virasse um valor próprio.
   */
  assert.equal(origemDaRequisicao(",,,"), "desconhecido");
  assert.equal(origemDaRequisicao("   "), "desconhecido");
  assert.equal(origemDaRequisicao(`  ${IP_REAL}  `), IP_REAL);
  assert.equal(origemDaRequisicao(`9.9.9.9 , , ${IP_REAL} ,`), IP_REAL);
});

test("cabeçalho da Cloudflare deixou de valer", () => {
  /*
   * Não há Cloudflare nesta implantação, então `cf-connecting-ip` era texto que
   * o próprio cliente escrevia — e tinha precedência sobre todo o resto. A
   * função não o recebe mais; o que prova a remoção é que só existe uma entrada.
   */
  assert.equal(origemDaRequisicao.length, 1);
});
