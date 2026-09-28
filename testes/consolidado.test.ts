/*
 * As duas regras da visão consolidada: quais UNIDADES saem dos cards, e quais
 * METAS leem "Débito 2" no gráfico da Seção 4.
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

import { ficaForaDoConsolidado, metaUsaDebito2 } from "../src/lib/consolidado.ts";

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

/* ======================= metas em Débito 2 (Seção 4) ======================= */

test("as duas metas pedidas leem Débito 2", () => {
  assert.equal(metaUsaDebito2("Central Missionária"), true);
  assert.equal(metaUsaDebito2("Assistência Social"), true);
});

test("variações de grafia da meta continuam lendo Débito 2", () => {
  assert.equal(metaUsaDebito2("central missionaria"), true);
  assert.equal(metaUsaDebito2("  Assistencia Social "), true);
  assert.equal(metaUsaDebito2("ASSISTÊNCIA SOCIAL"), true);
});

test('"Central Social" é UNIDADE, não meta — não aciona o Débito 2', () => {
  /*
   * A decisão que este teste fixa: o pedido falava em "Central Social" no
   * gráfico de metas, mas não existe meta com esse nome — conferido na base
   * inteira de 2026. A meta que corresponde à unidade Central Social é
   * "Assistência Social", e foi ela que a Central escolheu. Se alguém
   * "corrigir" a lista acrescentando "Central Social", este teste avisa que
   * isso não muda nada no gráfico e mistura as duas listas.
   */
  assert.equal(metaUsaDebito2("Central Social"), false);
});

test("as demais metas continuam lendo Débito", () => {
  for (const m of [
    "Custeio",
    "Pessoal",
    "Pastores e Obreiros",
    "Investimentos Central",
    "Células",
    "",
  ]) {
    assert.equal(
      metaUsaDebito2(m),
      false,
      `a meta "${m}" passou a ler Débito 2 sem ter sido pedida`,
    );
  }
});

test("as duas listas são independentes", () => {
  /*
   * "Central Social" sai dos cards como UNIDADE, e não aciona nada como META.
   * "Assistência Social" aciona o Débito 2 como META, e não sai dos cards como
   * UNIDADE. Misturar as duas listas foi exatamente a confusão que já houve.
   */
  assert.equal(ficaForaDoConsolidado("Central Social"), true);
  assert.equal(metaUsaDebito2("Central Social"), false);
  assert.equal(ficaForaDoConsolidado("Assistência Social"), false);
  assert.equal(metaUsaDebito2("Assistência Social"), true);
});
