/*
 * Quais unidades ficam de fora dos cards de Receita e Despesa Total na visão
 * consolidada — o Financeiro olhando a rede inteira.
 *
 * Decisão da Central. Vale SÓ para esses dois cards e SÓ nessa visão: com
 * qualquer unidade marcada no filtro, ou para qualquer pastor, os valores
 * voltam a incluir tudo o que o recorte contém — inclusive estas duas, se forem
 * elas as escolhidas. Ver `visaoConsolidada` no Dashboard.
 *
 * Medido na base de 2026, sobre as colunas "Crédito 2" / "Débito 2" que esses
 * cards usam na visão consolidada: as duas somam R$ 3,07 milhões de receita e
 * R$ 8,71 milhões de despesa. Tirá-las leva a Receita Total de R$ 57,75 mi para
 * R$ 54,67 mi e a Despesa Total de R$ 47,47 mi para R$ 38,77 mi.
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

/**
 * Os nomes como aparecem na coluna Unidade da base. A comparação ignora acento,
 * maiúscula e espaço nas pontas (ver `norm`): a exclusão não pode deixar de
 * funcionar em silêncio porque a planilha um dia veio com "Central Missionaria"
 * sem acento. Uma falha aqui não daria erro nenhum — só inflaria o total da
 * rede, e ninguém perceberia.
 */
const UNIDADES_FORA_DO_CONSOLIDADO = ["Central Missionária", "Central Social"];

const CHAVES = new Set(UNIDADES_FORA_DO_CONSOLIDADO.map((u) => norm(u)));

/** Se a unidade fica de fora dos cards de Receita e Despesa Total da rede. */
export function ficaForaDoConsolidado(unidade: string): boolean {
  return CHAVES.has(norm(unidade));
}
