import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/*
 * "Esta seção está no palco?" — as outras três vivem na trilha lateral a ~18%
 * de escala, onde a animação de um gráfico é literalmente invisível: as barras
 * crescem ao longo de poucos pixels. O Recharts, porém, não sabe disso e paga
 * o preço cheio, reiniciando a animação de cada gráfico a cada mudança de
 * filtro, nas quatro seções ao mesmo tempo.
 *
 * O contexto deixa cada gráfico decidir. Fora do provedor o padrão é `true`,
 * para nada mudar de comportamento em quem não participa do deck.
 */
const CtxSecaoAtiva = createContext(true);

export const ProvedorSecaoAtiva = CtxSecaoAtiva.Provider;

/** Passe a `isAnimationActive` dos gráficos Recharts. */
export const useAnimarGraficos = () => useContext(CtxSecaoAtiva);

/**
 * Tira as seções fora do palco do caminho crítico do clique.
 *
 * Medido: um clique de filtro bloqueava a thread por ~540 ms com 21.600 linhas,
 * e o pipeline de dados inteiro respondia por 3,7 ms disso. O custo é
 * renderização — quatro seções e catorze gráficos Recharts redesenhados de uma
 * vez, sendo que três estão na trilha a 18% de escala.
 *
 * A do palco continua instantânea. As outras recebem o conteúdo novo quando o
 * navegador estiver ocioso, e não no meio do clique: continuam vivas, só que
 * fora do caminho da interação. Enquanto esperam, o React reencontra o mesmo
 * elemento e nem entra na subárvore.
 */
export function SecaoOciosa({ ativo, children }: { ativo: boolean; children: ReactNode }) {
  const [, forcar] = useState(0);
  const exibido = useRef(children);

  // No palco: sempre o conteúdo do momento.
  if (ativo) exibido.current = children;

  useEffect(() => {
    if (ativo || exibido.current === children) return;
    const aplicar = () => {
      exibido.current = children;
      forcar((v) => v + 1);
    };
    const ric = window.requestIdleCallback;
    if (ric) {
      const id = ric(aplicar, { timeout: 1200 });
      return () => window.cancelIdleCallback(id);
    }
    // Safari ainda não tem requestIdleCallback; o timer serve de substituto.
    const id = window.setTimeout(aplicar, 300);
    return () => window.clearTimeout(id);
  }, [ativo, children]);

  return <>{exibido.current}</>;
}
