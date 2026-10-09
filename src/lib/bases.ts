/*
 * As bases que o sistema opera, e tudo o que muda de uma para a outra.
 *
 * Brasil e Angola são duas bases independentes: nunca se misturam, nunca se
 * somam, e cada uma alimenta um dashboard próprio. Não é a mesma planilha com
 * outros números — Angola tem outra forma (5.383 linhas e 33 colunas, contra
 * 159.633 e 56 do Brasil), guarda a unidade em outro nível e chama a data por
 * outro nome.
 *
 * Por isso cada base DECLARA o que tem de diferente, em vez de o código
 * adivinhar ou se encher de `if (base === "angola")`. Quem precisar mudar uma
 * regra de uma base muda aqui, e o lugar é um só.
 *
 * O que NÃO é declarado aqui, de propósito: se a base tem meta, membresia ou
 * saldo. Isso não é propriedade do país, é fato de cada carga — o que veio no
 * envio. Angola não tem meta hoje e vai ter um dia; o saldo dela também não
 * existe ainda. Nesse dia tem de funcionar sem mexer em código. Quem decide é
 * src/lib/presenca.ts, a partir dos dados.
 *
 * Este arquivo é puro — sem node:, sem React — porque é lido dos dois lados: o
 * navegador o usa ao interpretar a planilha no envio, e o servidor, ao validar
 * a base pedida.
 */

export type Base = "brasil" | "angola";

/** A lista fechada. Qualquer outro valor vindo do navegador é recusado. */
export const BASES = ["brasil", "angola"] as const satisfies readonly Base[];

export function ehBase(x: unknown): x is Base {
  return typeof x === "string" && (BASES as readonly string[]).includes(x);
}

/** A meta de uma natureza na Seção 4, em porcentagem da despesa total. */
export interface AlvoDeMeta {
  nome: string;
  alvo: number;
}

/*
 * Naturezas que viram uma coluna só no eixo da Seção 4. Separadas, são fatias
 * pequenas que poluem o gráfico sem dizer muito; juntas, cabem numa barra. A
 * repartição continua à mão no tooltip da coluna e no painel de despesas.
 */
export interface GrupoDeMetas {
  /** Rótulo no eixo. Pode repetir o nome de uma das partes, como "Custeio". */
  nome: string;
  partes: readonly string[];
  /**
   * Meta do grupo. Sem valor aqui, é a soma das metas das partes — que é o
   * certo quando a fusão não muda o alvo (Custeio já valia 12% e Outras
   * Despesas, 0%). Investimentos precisa do valor explícito: as três partes
   * valiam 0% cada, mas o grupo responde por 7%.
   */
  metaPropria?: number;
}

export interface DeclaracaoBase {
  id: Base;
  nome: string;
  /** "do Brasil", "de Angola" — o português não deixa montar isto por regra. */
  nomeComDe: string;

  /*
   * O dinheiro da base: o código da moeda e o nome por extenso, o do "valores
   * em milhares de reais". O desenho do número é o mesmo nas duas — ver moedaDe
   * em src/lib/format.ts, e por que o kwanza sai "Kz 1.234,56".
   */
  moeda: { codigo: "BRL" | "AOA"; nomePlural: string };

  /*
   * As colunas que diferem entre as bases, com o nome EXATO do cabeçalho.
   *
   * São casadas por igualdade (depois de tirar acento, maiúscula e espaço nas
   * pontas), e nunca por "contém". A busca por "contém" — que o parser usa nas
   * colunas comuns às duas bases — aceitaria uma "Data Emissão" no lugar de uma
   * "Data", em silêncio. Para as colunas que definem o que é unidade e quando
   * algo aconteceu, um palpite errado não dá erro: dá um dashboard plausível e
   * falso.
   *
   * Os nomes foram conferidos nos cabeçalhos reais. Brasil: "Data" na coluna 0
   * e "Descrição CR. 1º Nível" na 4, do arquivo FINANCEIRO Ago-28. Angola:
   * conferidos byte a byte pela Central no arquivo de exemplo — inclusive o
   * ordinal "º" (0xBA), o mesmo do Brasil.
   */
  colunas: {
    unidade: string;
    data: string;
  };

  /*
   * O que identifica a planilha desta base. O envio é RECUSADO se o arquivo
   * não bater.
   *
   * Existe por causa do erro mais caro possível na operação: o arquivo de
   * Angola enviado no lugar do Brasil. O parser leria sem reclamar — o 1º nível
   * viraria uma unidade só, "Central Angola" — e a base do Brasil inteira, 159
   * mil lançamentos, seria substituída por 5 mil. O backup mais recente pode
   * ser de dias antes.
   *
   * "Central Angola" no 1º nível é a assinatura porque está em todas as linhas
   * de Angola e em nenhuma do Brasil. Não dá para usar a presença da coluna do
   * 2º nível: o Brasil também a tem.
   *
   * A mesma declaração dá o nome da base inteira, para a membresia e o saldo —
   * ver identidadeDaBase, no fim deste arquivo.
   */
  assinatura: {
    coluna: string;
    valor: string;
    /** "todas": toda linha precisa ter o valor. "nenhuma": nenhuma pode ter. */
    exige: "todas" | "nenhuma";
  };

  /*
   * Se a meta de uma unidade pode ser achada por nome APROXIMADO quando não há
   * coluna "Meta Anual <unidade>" com o nome exato.
   *
   * O destino é o casamento exato nas duas bases — é ele que impede a armadilha
   * 7: "Central Angola" (1º nível) está contido em "Central Angola Sede", e a
   * Sede sem coluna de meta herdaria a meta do país inteiro, um número
   * plausível e errado que ninguém percebe na tela.
   *
   * O Brasil continua aproximado por um tempo, e só por ordem: o defeito já
   * está lá — "Central Picos - Missões" pega os R$ 900 mil de "Central Picos",
   * porque a coluna dela se chama "Central Picos - Missão" —, mas ligar o exato
   * antes de corrigir os cabeçalhos da planilha faria as unidades afetadas
   * perderem a meta. Decisão da Central, de 06/10: primeiro os cabeçalhos são
   * corrigidos e a base é reenviada; só então o Brasil passa a `false`. Nesse
   * dia esta propriedade inteira pode sair, e o casamento vira exato sempre.
   */
  metaAproximada: boolean;

  /*
   * Unidades cuja Meta de Dízimo NUNCA entra numa soma de unidades. Ela só
   * conta dentro do Total Geral — a coluna "Meta Anual Total Geral" da
   * planilha, que é o que se lê com todas as unidades marcadas, ou nenhuma.
   *
   * É a Central Picos - Missões, e a regra é PERMANENTE: regra de negócio da
   * Central (09/10), e não conserto de um erro de digitação na planilha. Ela
   * vale para o pastor que tem a unidade, sozinha ou com outras, e para o
   * Financeiro (ou quem vê todas as unidades) sempre que há unidades filtradas.
   *
   * A meta verdadeira dela é zero, e a planilha fecha sem ela: das 22 unidades
   * do Brasil, 19 têm coluna de meta com o nome exato, e essas 19 colunas somam
   * R$ 76.171.000 — exatamente a "Meta Anual Total Geral". A coluna dela se
   * chama "Central Picos - Missão", no singular, e vale zero; pela busca
   * aproximada (acima), a unidade pegava emprestados os R$ 900 mil da "Central
   * Picos", e toda soma que a incluía contava a meta de Picos duas vezes.
   *
   * Por ser permanente, a regra NÃO se desliga quando a coluna passar a ter o
   * nome exato: a meta da unidade fica fora das somas qualquer que seja o valor
   * da coluna — inclusive um valor de verdade, que seria excluído em silêncio.
   * ATENÇÃO:
   * se a Picos - Missões ganhar meta própria um dia, esta regra precisa sair.
   * Tire o nome desta lista, e junto o teste "com o cabeçalho corrigido, a
   * regra continua", em testes/visao-por-perfil.test.ts.
   */
  metaForaDasSomas: readonly string[];

  /*
   * As metas de aplicação da Seção 4, em porcentagem da despesa total.
   *
   * Por base, para poderem divergir sem mexer em componente. Hoje são as
   * mesmas nas duas, por decisão da Central. Se a carga não tiver meta nenhuma
   * nos lançamentos, a Seção 4 não aparece e isto simplesmente não é lido.
   */
  metasDeAplicacao: { alvos: readonly AlvoDeMeta[]; grupos: readonly GrupoDeMetas[] };

  /*
   * As regras da visão consolidada — a base inteira, sem filtro de unidade: o
   * administrador, ou o pastor com todas as unidades marcadas. Ver
   * src/lib/consolidado.ts para o que cada lista faz e por quê.
   *
   * São do Brasil: Central Missionária e Central Social são unidades
   * brasileiras. Angola começa sem nenhuma, e se um dia precisar de uma regra,
   * o lugar é aqui.
   */
  consolidado: {
    /** UNIDADES (coluna de unidade) fora dos cards de Receita e Despesa Total. */
    unidadesForaDosCards: readonly string[];
    /** METAS (coluna Meta) que leem "Débito 2" no gráfico de metas. */
    metasEmDebito2: readonly string[];
  };
}

/* As metas de aplicação de hoje — as mesmas para as duas bases. */
const METAS_DE_APLICACAO_DA_CENTRAL: DeclaracaoBase["metasDeAplicacao"] = {
  alvos: [
    { nome: "Pastores e Obreiros", alvo: 17 },
    { nome: "Central Missionária", alvo: 16 },
    { nome: "Pessoal", alvo: 13 },
    { nome: "Custeio", alvo: 12 },
    { nome: "Assistência Social", alvo: 10 },
    { nome: "Ativos Imobilizados", alvo: 0 },
    { nome: "Células", alvo: 4 },
    { nome: "Ministérios", alvo: 4 },
    { nome: "Investimento em Terceiros", alvo: 0 },
    { nome: "Investimentos Central", alvo: 0 },
    { nome: "Outras Despesas", alvo: 0 },
    { nome: "Outras Empresas", alvo: 0 },
  ],
  grupos: [
    {
      nome: "Investimentos em Ativos",
      partes: ["Investimentos Central", "Ativos Imobilizados", "Investimento em Terceiros"],
      metaPropria: 7,
    },
    {
      nome: "Custeio",
      partes: ["Custeio", "Outras Despesas"],
    },
  ],
};

export const DECLARACOES: Record<Base, DeclaracaoBase> = {
  brasil: {
    id: "brasil",
    nome: "Brasil",
    nomeComDe: "do Brasil",
    moeda: { codigo: "BRL", nomePlural: "reais" },
    colunas: {
      unidade: "Descrição CR. 1º Nível",
      data: "Data",
    },
    assinatura: { coluna: "Descrição CR. 1º Nível", valor: "Central Angola", exige: "nenhuma" },
    metaAproximada: true,
    metaForaDasSomas: ["Central Picos - Missões"],
    metasDeAplicacao: METAS_DE_APLICACAO_DA_CENTRAL,
    consolidado: {
      unidadesForaDosCards: ["Central Missionária", "Central Social"],
      metasEmDebito2: ["Central Missionária", "Assistência Social"],
    },
  },

  angola: {
    id: "angola",
    nome: "Angola",
    nomeComDe: "de Angola",
    moeda: { codigo: "AOA", nomePlural: "kwanzas" },
    colunas: {
      // A unidade de verdade está no 2º nível; o 1º diz "Central Angola" em tudo.
      unidade: "Descrição CR. 2º Nível",
      data: "Dt. Baixa",
    },
    assinatura: { coluna: "Descrição CR. 1º Nível", valor: "Central Angola", exige: "todas" },
    metaAproximada: false,
    metaForaDasSomas: [],
    metasDeAplicacao: METAS_DE_APLICACAO_DA_CENTRAL,
    consolidado: {
      unidadesForaDosCards: [],
      metasEmDebito2: [],
    },
  },
};

/**
 * O nome que responde pela base inteira, quando ela tem um: o 1º nível que está
 * em TODAS as linhas do financeiro dela. Em Angola, "Central Angola".
 *
 * Não é declaração nova: é a assinatura, lida de outro jeito. Uma assinatura
 * "todas" diz que aquele nome está em cada linha da base — então ele É a base.
 * Uma assinatura "nenhuma" diz o contrário: o nome está PROIBIDO ali. É o caso
 * do Brasil, e por isso o Brasil não tem identidade.
 *
 * Ler o `valor` sem olhar o `exige` seria o erro: "Central Angola" viraria o
 * nome do Brasil, e a linha "Central Angola" que a membresia do Brasil traz
 * passaria a ser o total do Brasil — 3.170 membros no lugar de 25.432.
 *
 * Quem usa (ver parsers.ts): a conferência da membresia e do saldo, em que este
 * nome é assinatura bastante para um arquivo que não traz unidades; e o total da
 * membresia, em que a linha com este nome vale pela base inteira.
 */
export function identidadeDaBase(base: Base): string | null {
  const { valor, exige } = DECLARACOES[base].assinatura;
  return exige === "todas" ? valor : null;
}
