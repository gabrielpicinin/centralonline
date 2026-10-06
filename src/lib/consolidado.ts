/*
 * As duas regras da visão consolidada — o Financeiro olhando a rede inteira.
 *
 * Decisões da Central. Valem SÓ nessa visão: com qualquer unidade marcada no
 * filtro, ou para qualquer pastor, tudo volta a ser a soma simples de
 * "Crédito" e "Débito", com todas as unidades do recorte. Ver `visaoConsolidada`
 * no Dashboard.
 *
 * ---------------------------------------------------------------------------
 * ATENÇÃO: SÃO DUAS LISTAS, E ELAS OLHAM COLUNAS DIFERENTES
 * ---------------------------------------------------------------------------
 *
 * Os nomes se cruzam, e já houve confusão por causa disso:
 *
 *   UNIDADES_FORA_DOS_CARDS olha a coluna "Descrição CR. 1º Nível" — a UNIDADE.
 *   METAS_EM_DEBITO_2       olha a coluna "Meta".
 *
 * "Central Missionária" aparece nas duas, porque existe como unidade e como
 * meta. "Central Social" existe só como UNIDADE; a META que corresponde a ela
 * se chama "Assistência Social". Não existe meta "Central Social" na base —
 * conferido nos 140.776 lançamentos de 2026 —, e por isso ela não está na
 * segunda lista.
 *
 * Fica num arquivo próprio, e puro, para poder ser testado sem desenhar tela
 * nenhuma — ver testes/consolidado.test.ts.
 */

/*
 * Com a extensão `.ts`, ao contrário do resto do projeto — e não tire.
 *
 * Os testes rodam no próprio Node, que executa TypeScript mas não resolve
 * import sem extensão: `from "./parsers"` funciona no Vite e falha no
 * `node --test` com ERR_MODULE_NOT_FOUND. Os outros módulos testados nunca
 * esbarraram nisso porque só importam TIPOS de parsers, e import de tipo é
 * apagado antes de rodar. Este é o primeiro a precisar de uma função de lá.
 * O tsconfig já permite a extensão (allowImportingTsExtensions), e o Vite
 * resolve igual.
 */
import { norm } from "./parsers.ts";
import { BASES, DECLARACOES, type Base } from "./bases.ts";

/*
 * As listas moram em src/lib/bases.ts, declaradas POR BASE, e cada função
 * recebe a base. O Brasil tem as duas regras; Angola começa sem nenhuma — e,
 * com a lista vazia, as funções dizem "não" para tudo, que é exatamente a soma
 * simples. Se um dia Angola precisar de uma regra, ela entra lá, e não aqui.
 */
const chaves = (lista: readonly string[]) => new Set(lista.map((v) => norm(v)));
const porBase = (lista: (b: Base) => readonly string[]) =>
  Object.fromEntries(BASES.map((b) => [b, chaves(lista(b))])) as Record<Base, Set<string>>;

/*
 * As comparações ignoram acento, maiúscula e espaço nas pontas (ver `norm`):
 * uma regra destas não pode deixar de funcionar em silêncio porque a planilha
 * um dia veio com "Central Missionaria" sem acento. Uma falha aqui não daria
 * erro nenhum — só mudaria milhões de reais nos números da rede, e ninguém
 * perceberia.
 */

/* ============================ 1. os cards ============================ */

/*
 * Unidades que ficam FORA dos cards de Receita Total e Despesa Total.
 *
 * Nesses cards, a visão consolidada soma "Crédito" e "Débito" — as colunas
 * simples — de todas as unidades MENOS estas. Medido na base de 2026: a
 * Receita Total fica em R$ 55.053.598,50 e a Despesa Total em
 * R$ 48.828.247,08.
 */
const UNIDADES_FORA_DOS_CARDS = porBase((b) => DECLARACOES[b].consolidado.unidadesForaDosCards);

/** Se a UNIDADE fica de fora dos cards de Receita e Despesa Total da rede, nesta base. */
export function ficaForaDoConsolidado(unidade: string, base: Base): boolean {
  return UNIDADES_FORA_DOS_CARDS[base].has(norm(unidade));
}

/* ======================= 2. o gráfico de metas ======================= */

/*
 * Metas cujo Realizado lê "Débito 2" em vez de "Débito" na Seção 4.
 *
 * Todas as outras metas leem "Débito". São justamente estas as duas únicas
 * metas em que as duas colunas diferem de forma relevante: "Débito 2" tira
 * delas os repasses que as unidades fazem aos fundos centrais, que na visão da
 * rede é dinheiro circulando dentro da própria Central. Medido em 2026:
 * Central Missionária vai de R$ 13,58 mi em "Débito" para R$ 7,25 mi em
 * "Débito 2"; Assistência Social, de R$ 6,27 mi para R$ 2,55 mi. Nas demais,
 * as colunas são iguais — por isso o gráfico resultante é o mesmo que já era
 * desenhado com "Débito 2" em tudo, só que agora pela regra que a Central
 * descreveu.
 *
 * Isto NÃO vale fora da visão consolidada, e a razão é grave: para uma unidade
 * sozinha, "Débito 2" zera essas metas. A Central Contagem mandou 13,3% das
 * despesas para a Central Missionária; em "Débito 2" isso vira 0,0%, como se
 * ela não tivesse contribuído com nada.
 */
const METAS_EM_DEBITO_2 = porBase((b) => DECLARACOES[b].consolidado.metasEmDebito2);

/** Se a META lê "Débito 2" no gráfico de metas da rede, nesta base. */
export function metaUsaDebito2(meta: string, base: Base): boolean {
  return METAS_EM_DEBITO_2[base].has(norm(meta));
}
