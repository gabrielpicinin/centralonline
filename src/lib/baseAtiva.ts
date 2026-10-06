/*
 * A base que o dashboard está mostrando, para quem está dentro dele.
 *
 * As seções precisam saber três coisas da base — a moeda, as regras da visão
 * consolidada e as metas percentuais —, e nenhuma delas deve ter de recebê-la
 * por parâmetro em cada função. O Dashboard fornece; as seções leem.
 *
 * Sem valor padrão, de propósito: uma seção desenhada fora do Dashboard lança
 * em vez de cair num "brasil" que ninguém disse. A base é sempre dita, nunca
 * suposta — a mesma regra que vale no servidor.
 */
import { createContext, useContext } from "react";
import { BASES, DECLARACOES, type Base, type DeclaracaoBase } from "./bases";
import { moedaDe, type Moeda } from "./format";

export interface BaseAtiva {
  base: Base;
  declaracao: DeclaracaoBase;
  moeda: Moeda;
}

/*
 * Um objeto por base, criado uma vez: o valor do contexto não muda de
 * identidade a cada renderização, e quem o lê não redesenha à toa.
 */
const ATIVAS = Object.fromEntries(
  BASES.map((b) => [b, { base: b, declaracao: DECLARACOES[b], moeda: moedaDe(b) }]),
) as Record<Base, BaseAtiva>;

export const baseAtivaDe = (base: Base): BaseAtiva => ATIVAS[base];

export const BaseAtivaContexto = createContext<BaseAtiva | null>(null);

export function useBaseAtiva(): BaseAtiva {
  const v = useContext(BaseAtivaContexto);
  if (!v) throw new Error("useBaseAtiva fora do Dashboard: a base precisa ser dita, nunca suposta");
  return v;
}
