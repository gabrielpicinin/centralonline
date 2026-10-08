/*
 * O que a CARGA tem — e, a partir disso, o que o dashboard desenha.
 *
 * Vale para meta, membresia e saldo. Nenhum deles é propriedade de um país:
 * cada carga traz o que traz, e as telas seguem isso.
 *
 * Meta não é propriedade de um país, é um fato de cada carga. Angola não tem
 * meta hoje e vai ter um dia; o Brasil tem hoje e pode, um dia, vir sem. As
 * duas bases seguem a mesma regra, e a regra lê os dados — nunca o nome da
 * base. Quando a planilha de Angola chegar com as colunas preenchidas, os
 * blocos aparecem sozinhos, sem mudança de código nem implantação.
 *
 * A decisão é tomada UMA vez, no servidor, quando a base é lida (ver lerBase em
 * banco.server.ts), e desce pronta até os componentes. Nenhum bloco olha os
 * dados para decidir se aparece: é assim que um deles acaba esquecido e
 * desenha zero.
 *
 * Arquivo puro — sem React, sem node: — porque é lido pelo servidor, pelo
 * parser no navegador e pelos testes.
 */

/**
 * As chaves. Calculadas sobre a carga INTEIRA, e não sobre o recorte de quem
 * pede: um pastor cuja unidade não tem coluna de meta continua vendo o card de
 * meta, como sempre viu no Brasil. O que liga e desliga o bloco é a base ter ou
 * não ter meta, e não cada unidade.
 */
export interface Presenca {
  /**
   * (A) A meta de dízimos: as colunas "Meta Anual <Unidade>" e a "Meta Anual
   * Total Geral". Ligada se ao menos uma tiver valor acima de zero.
   */
  metaDeDizimos: boolean;
  /**
   * (B) As metas de aplicação: a coluna "Meta" de cada lançamento (Custeio,
   * Pessoal, Células…). Ligada se ao menos um lançamento a tiver preenchida.
   */
  metasDeAplicacao: boolean;
  /** O arquivo de membresia: ligada se a carga tiver ao menos uma linha dele. */
  membresia: boolean;
  /**
   * O arquivo de saldo: ligada se a carga tiver ao menos uma linha dele. O card
   * de saldo não precisa dela — decide pelas linhas que recebe —, mas o envio
   * precisa, para avisar quando a carga nova vai sair sem o saldo que a atual
   * tem.
   */
  saldo: boolean;
}

/** Base sem carga, ou pedido sem unidade nenhuma: nada a desenhar. */
export const SEM_DADOS: Presenca = {
  metaDeDizimos: false,
  metasDeAplicacao: false,
  membresia: false,
  saldo: false,
};

/*
 * Membresia e saldo ausentes têm o tratamento OPOSTO ao da meta.
 *
 * Meta ausente é o estado normal de uma base, e o bloco some calado. Membresia
 * ou saldo ausentes são esquecimento — um arquivo que não foi junto no envio —,
 * e o card fica, dizendo que a base não foi carregada. Nunca zero: um "0" de
 * membresia ou um "R$ 0,00" de dízimo per capita passariam por número real.
 *
 * A mesma regra para as duas bases. O que decide é o que a carga trouxe.
 */
export const NOTA_SEM_MEMBRESIA = "Base de membresia não carregada";
export const AVISO_SEM_SALDO = "Base de saldo não carregada.";

/**
 * O que um card que depende de membresia mostra: o valor, ou "—" com o porquê.
 * Vale para os três — Membresia, Dízimo per capita e Taxa de depositantes.
 */
export function cardDeMembresia(
  presenca: Presenca,
  valorFormatado: string,
): { valor: string; nota?: string } {
  return presenca.membresia ? { valor: valorFormatado } : { valor: "—", nota: NOTA_SEM_MEMBRESIA };
}

/** O aviso do card de saldo, ou nulo quando há saldo para mostrar. */
export function avisoDoCardDeSaldo(linhasDeSaldo: readonly unknown[]): string | null {
  return linhasDeSaldo.length ? null : AVISO_SEM_SALDO;
}

/**
 * O que um envio apaga sem querer.
 *
 * Cada envio é uma carga inteira: o que não vier nele deixa de existir no
 * dashboard. Se a carga que está no servidor tem membresia e o envio novo não
 * traz o arquivo, a membresia some — e o mesmo com o saldo. Isto lista o que
 * vai sumir, para a tela avisar ANTES. Não impede: às vezes é de propósito.
 */
export function oQueOEnvioApaga(
  atual: Presenca | null,
  envio: { membresia: boolean; saldo: boolean },
): ("membresia" | "saldo")[] {
  if (!atual) return [];
  const some: ("membresia" | "saldo")[] = [];
  if (atual.membresia && !envio.membresia) some.push("membresia");
  if (atual.saldo && !envio.saldo) some.push("saldo");
  return some;
}

/*
 * A regra do (A).
 *
 * "Coluna existe" não basta, pela mesma pegadinha do (B): uma coluna de meta
 * presente e vazia vira zero na leitura, e zero desenharia "R$ 0,00" e "0%" — a
 * meta que ninguém definiu passando por meta zerada. Então vale ter ao menos um
 * valor acima de zero. Uma unidade com meta 0 numa base que tem meta continua
 * sendo meta 0, como sempre foi.
 */
export function temMetaDeDizimos(valores: Iterable<number>): boolean {
  for (const v of valores) if (v > 0) return true;
  return false;
}

/*
 * A regra do (B), para um valor da coluna "Meta".
 *
 * Em Angola a coluna EXISTE no arquivo, mas vem vazia nas 5.383 linhas — "a
 * coluna existir não basta" foi o aviso da Central. Espaço sozinho também é
 * vazio. A mesma regra está escrita em SQL em banco.server.ts (TRIM(meta) <>
 * ''), porque lá ela roda sobre a carga inteira sem trazer as linhas.
 */
export function eMetaDeAplicacao(valor: unknown): boolean {
  return String(valor ?? "").trim() !== "";
}

type ChaveDeMeta = "metaDeDizimos" | "metasDeAplicacao";

/*
 * TODO bloco do dashboard que depende de meta, e a chave que o liga.
 *
 * É a lista que responde "esqueci algum?". Bloco que depende de meta e não
 * está aqui é bloco que vai desenhar zero no dia em que a meta faltar. Sem a
 * chave, o bloco NÃO EXISTE — nem zerado, nem com espaço guardado — e não há
 * aviso: meta ausente é o estado normal de uma base, não um esquecimento.
 */
export const BLOCOS_DE_META = {
  /* Seção 1 — Total */
  cardMetaDeDizimos: "metaDeDizimos",
  graficoDizimosVsMeta: "metaDeDizimos",

  /*
   * Seção 2 — Acumulado diário. Uma chave só para tudo o que é meta nos dois
   * gráficos: a linha tracejada, o item "Meta" da legenda, o ponto de meta sob
   * o cursor, a "Diferença" do tooltip, o "% vs meta" do Gráfico 2 e o
   * "vs. meta mensal" do subtítulo. São partes de uma mesma coisa, e meia meta
   * na tela seria pior que nenhuma.
   */
  metaNosGraficosDiarios: "metaDeDizimos",
  linhasDeMetaDaTabela: "metaDeDizimos",

  /* Seção 4 inteira, e o filtro do topo que só serve a ela. */
  secaoControleDeMetas: "metasDeAplicacao",
  filtroMeta: "metasDeAplicacao",
} as const satisfies Record<string, ChaveDeMeta>;

export type BlocoDeMeta = keyof typeof BLOCOS_DE_META;

/** Se o bloco existe nesta carga. É a única pergunta que os componentes fazem. */
export function desenha(presenca: Presenca, bloco: BlocoDeMeta): boolean {
  return presenca[BLOCOS_DE_META[bloco]];
}
