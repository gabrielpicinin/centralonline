/*
 * As funções de servidor que movem as bases entre o navegador e o banco.
 *
 * O envio é fatiado em lotes de propósito. Uma base tem 20 mil linhas, e mandar
 * tudo numa requisição só produz um corpo de vários megabytes que fica sem
 * resposta por segundos — sem barra de progresso possível e com a chance de
 * esbarrar em limite de tamanho de proxy. Em lotes, a tela mostra o avanço e
 * uma falha no meio não perde o que já subiu.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  iniciarCarga,
  gravarLancamentos,
  gravarMembresia,
  gravarSaldos,
  gravarMetas,
  finalizarCarga,
  cargaAtiva,
  listarUnidades,
  lerBase,
} from "./banco.server";
import { exigirSessao, unidadesDaSessao } from "./sessao.server";

/*
 * O conteúdo das linhas não é validado campo a campo aqui. Elas vêm dos
 * normalizadores de parsers.ts, que já garantem forma e tipo, e revalidar 20
 * mil objetos a cada lote custaria mais do que protege. O que é validado é o
 * envelope: identificadores, tamanhos e o tipo do lote.
 */
const loteSchema = z.object({
  cargaId: z.number().int().positive(),
  tipo: z.enum(["lancamentos", "membresia", "saldos"]),
  linhas: z.array(z.any()).max(5000),
});

export const iniciarCargaServer = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ arquivos: z.array(z.string().max(300)).max(10) }).parse(d),
  )
  .handler(async ({ data }) => {
    const sessao = await exigirSessao();
    return { cargaId: iniciarCarga(data.arquivos, sessao.user ?? null) };
  });

export const enviarLoteServer = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => loteSchema.parse(d))
  .handler(async ({ data }) => {
    await exigirSessao();
    if (data.tipo === "lancamentos") gravarLancamentos(data.cargaId, data.linhas);
    else if (data.tipo === "membresia") gravarMembresia(data.cargaId, data.linhas);
    else gravarSaldos(data.cargaId, data.linhas);
    return { ok: true as const, gravadas: data.linhas.length };
  });

export const finalizarCargaServer = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        cargaId: z.number().int().positive(),
        metaAnualPorUnidade: z.record(z.string(), z.number()),
        metaAnualTotalGeral: z.number(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await exigirSessao();
    gravarMetas(data.cargaId, data.metaAnualPorUnidade, data.metaAnualTotalGeral);
    return finalizarCarga(data.cargaId);
  });

/**
 * Carrega a base já recortada para quem pediu.
 *
 * O recorte não é um argumento que o navegador manda: ele sai da sessão, aqui
 * no servidor. Se viesse do cliente, bastaria alterá-lo na requisição para ver
 * qualquer unidade.
 */
export const carregarBaseServer = createServerFn({ method: "GET" }).handler(async () => {
  const unidades = await unidadesDaSessao();
  return lerBase(unidades);
});

/** Estado para a tela do administrador: a carga atual e o universo de unidades. */
export const estadoServer = createServerFn({ method: "GET" }).handler(async () => {
  await exigirSessao();
  return { carga: cargaAtiva(), unidades: listarUnidades() };
});
