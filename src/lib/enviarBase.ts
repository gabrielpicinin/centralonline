/*
 * Envio das bases para o servidor, em lotes.
 *
 * Roda no navegador: a leitura das planilhas continua onde sempre esteve — o
 * código de parsers.ts interpreta 20 mil linhas em milissegundos e não havia
 * motivo para movê-lo. O que muda é o destino do resultado, que antes era a
 * memória do React e agora é o banco.
 */
import { iniciarCargaServer, enviarLoteServer, finalizarCargaServer } from "./dados.functions";
import type { FinancialRow, MembershipRow, SaldoRow } from "./parsers";

/*
 * Duas mil linhas por requisição. O número não é mágico: é o maior que mantém
 * cada corpo abaixo de ~1 MB, tamanho que atravessa qualquer proxy sem
 * configuração especial e ainda dá passos de progresso visíveis o bastante para
 * a barra não parecer travada.
 */
const TAMANHO_DO_LOTE = 2000;

function fatiar<T>(lista: T[], tamanho: number): T[][] {
  const partes: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) partes.push(lista.slice(i, i + tamanho));
  return partes;
}

export interface BasesParaEnviar {
  arquivos: string[];
  financial: FinancialRow[];
  membership: MembershipRow[];
  saldo: SaldoRow[];
  metaAnualPorUnidade: Record<string, number>;
  metaAnualTotalGeral: number;
}

/**
 * Envia tudo e devolve o resumo da carga já ativa.
 *
 * `onProgresso` recebe de 0 a 1. A conta inclui todos os lotes das três bases,
 * e não só os lançamentos, para a barra não ficar parada nos 100% enquanto a
 * membresia e os saldos ainda sobem.
 */
export async function enviarBases(bases: BasesParaEnviar, onProgresso?: (fracao: number) => void) {
  const { cargaId } = await iniciarCargaServer({ data: { arquivos: bases.arquivos } });

  const lotes: { tipo: "lancamentos" | "membresia" | "saldos"; linhas: unknown[] }[] = [
    ...fatiar(bases.financial, TAMANHO_DO_LOTE).map((linhas) => ({
      tipo: "lancamentos" as const,
      linhas,
    })),
    ...fatiar(bases.membership, TAMANHO_DO_LOTE).map((linhas) => ({
      tipo: "membresia" as const,
      linhas,
    })),
    ...fatiar(bases.saldo, TAMANHO_DO_LOTE).map((linhas) => ({ tipo: "saldos" as const, linhas })),
  ];

  let feitos = 0;
  for (const lote of lotes) {
    await enviarLoteServer({ data: { cargaId, tipo: lote.tipo, linhas: lote.linhas } });
    feitos += 1;
    // O último passo é a finalização, então a barra vai até 95% aqui.
    onProgresso?.((feitos / Math.max(1, lotes.length)) * 0.95);
  }

  const resumo = await finalizarCargaServer({
    data: {
      cargaId,
      metaAnualPorUnidade: bases.metaAnualPorUnidade,
      metaAnualTotalGeral: bases.metaAnualTotalGeral,
    },
  });
  onProgresso?.(1);
  return resumo;
}
