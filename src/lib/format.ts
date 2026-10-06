/*
 * Com a extensão `.ts`: os testes carregam este arquivo direto no Node — ver o
 * comentário em src/lib/consolidado.ts.
 */
import { BASES, DECLARACOES, type Base } from "./bases.ts";

/*
 * O dinheiro de cada base.
 *
 * Eram formatadores fixos em real — "R$" escrito à mão em duas linhas. Agora
 * cada base tem o seu, e os antigos deixaram de existir: um ponto da tela
 * esquecido no real não compila, em vez de mostrar "R$" no dashboard de Angola.
 *
 * O kwanza sai "Kz 1.234.567,89" — o mesmo desenho do real, só com o símbolo
 * trocado. O padrão de Angola (pt-AO) seria "1 234 567,89 Kz", com espaço
 * separando os milhares e o símbolo no fim. Ficou o desenho brasileiro de
 * propósito: os números que não são dinheiro (membresia, eventos, a tabela em
 * milhares) continuam com ponto, e misturar os dois padrões na mesma tela faria
 * "1.234" e "1 234" parecerem coisas diferentes. Se a Central preferir o
 * padrão angolano, é aqui, e só aqui, que se troca.
 *
 * Para o real, o resultado é idêntico ao de antes, caractere por caractere — o
 * teste em testes/moeda.test.ts compara com os formatadores antigos.
 */
export interface Moeda {
  /** "R$ 1.234,56" — cards, tooltips e rankings. */
  formatar: (v: number) => string;
  /** "R$ 1,5M", "R$ 900k" — eixos e rótulos de barra, onde o número inteiro não cabe. */
  compacto: (v: number) => string;
  /** "R$" ou "Kz". */
  simbolo: string;
  /** "reais" ou "kwanzas", para "valores em milhares de reais". */
  nomePlural: string;
}

function criarMoeda(base: Base): Moeda {
  const { codigo, nomePlural } = DECLARACOES[base].moeda;
  /*
   * pt-BR para as duas, com o símbolo curto: é o que dá "Kz" para o kwanza —
   * sem ele, o pt-BR escreve "AOA" — e mantém o real exatamente como era.
   */
  const intl = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: codigo,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const simbolo = intl.formatToParts(0).find((p) => p.type === "currency")?.value ?? codigo;

  const compacto = (v: number) => {
    if (Math.abs(v) >= 1_000_000)
      return (
        simbolo + " " + (v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "M"
      );
    if (Math.abs(v) >= 1_000)
      return (
        simbolo + " " + (v / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "k"
      );
    return intl.format(v);
  };

  return {
    formatar: (v: number) => intl.format(isFinite(v) ? v : 0),
    compacto,
    simbolo,
    nomePlural,
  };
}

const MOEDAS = Object.fromEntries(BASES.map((b) => [b, criarMoeda(b)])) as Record<Base, Moeda>;

/** A moeda de uma base. Nas telas, venha por useBaseAtiva() — ver src/lib/baseAtiva.ts. */
export function moedaDe(base: Base): Moeda {
  return MOEDAS[base];
}

export const fmtPct = (v: number, digits = 1) =>
  (isFinite(v) ? v : 0).toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }) + "%";

export const MESES = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];
