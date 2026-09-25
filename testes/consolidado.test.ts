/*
 * Quais unidades ficam fora dos cards de Receita e Despesa Total da rede.
 *
 * O ponto frágil desta regra é o NOME. Ela compara texto vindo de planilha, e
 * uma comparação que falha não dá erro nenhum: a unidade simplesmente volta a
 * ser somada, o total da rede sobe milhões, e ninguém percebe. Estes testes
 * fixam o que precisa casar — e, tão importante quanto, o que NÃO pode casar.
 *
 * Roda com `node --test`, sem framework e sem dependência, igual aos outros.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { ficaForaDoConsolidado } from "../src/lib/consolidado.ts";

test("as duas unidades pedidas ficam de fora", () => {
  assert.equal(ficaForaDoConsolidado("Central Missionária"), true);
  assert.equal(ficaForaDoConsolidado("Central Social"), true);
});

test("variações de grafia da planilha continuam de fora", () => {
  /*
   * Sem acento, em minúscula, com espaço sobrando: tudo isso aparece em
   * planilha exportada à mão. Se qualquer uma dessas voltasse a ser somada, a
   * Despesa Total da rede subiria em até R$ 6 milhões sem aviso.
   */
  assert.equal(ficaForaDoConsolidado("Central Missionaria"), true);
  assert.equal(ficaForaDoConsolidado("central missionária"), true);
  assert.equal(ficaForaDoConsolidado("  Central Social  "), true);
  assert.equal(ficaForaDoConsolidado("CENTRAL SOCIAL"), true);
});

test("unidades de nome parecido NÃO ficam de fora", () => {
  /*
   * O contrário importa tanto quanto: uma regra frouxa demais tiraria da conta
   * unidades que a Central não pediu. "Central Picos - Missões" tem "Missões"
   * no nome e é outra unidade, com os próprios 253 lançamentos.
   */
  assert.equal(ficaForaDoConsolidado("Central Picos - Missões"), false);
  assert.equal(ficaForaDoConsolidado("Central Missionária Norte"), false);
  assert.equal(ficaForaDoConsolidado("Assistência Social"), false);
});

test("as demais unidades continuam somadas", () => {
  for (const u of ["Central Sede", "Central Contagem", "Central Luxemburgo", "Colégio Central"]) {
    assert.equal(ficaForaDoConsolidado(u), false, `${u} saiu da conta sem ter sido pedida`);
  }
});

test("unidade vazia não é tirada nem derruba", () => {
  assert.equal(ficaForaDoConsolidado(""), false);
});
