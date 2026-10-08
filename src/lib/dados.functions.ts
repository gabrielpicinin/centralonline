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
  presencaDaCargaAtiva,
} from "./banco.server";
import { exigirAdministrador, unidadesDaSessao, basesDaSessao } from "./sessao.server";
import { BASES } from "./bases";

/*
 * A base, como chega do navegador: uma das duas, e nada mais. Qualquer outro
 * valor é recusado aqui, antes de chegar perto do banco. Isto valida o FORMATO
 * do pedido — quem pode ver o quê é decidido depois, em unidadesDaSessao.
 */
const baseSchema = z.enum(BASES);

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
  .validator((d: unknown) =>
    z.object({ base: baseSchema, arquivos: z.array(z.string().max(300)).max(10) }).parse(d),
  )
  .handler(async ({ data }) => {
    const sessao = await exigirAdministrador();
    return { cargaId: iniciarCarga(data.base, data.arquivos, sessao.user ?? null) };
  });

export const enviarLoteServer = createServerFn({ method: "POST" })
  .validator((d: unknown) => loteSchema.parse(d))
  .handler(async ({ data }) => {
    await exigirAdministrador();
    if (data.tipo === "lancamentos") gravarLancamentos(data.cargaId, data.linhas);
    else if (data.tipo === "membresia") gravarMembresia(data.cargaId, data.linhas);
    else gravarSaldos(data.cargaId, data.linhas);
    return { ok: true as const, gravadas: data.linhas.length };
  });

export const finalizarCargaServer = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        cargaId: z.number().int().positive(),
        metaAnualPorUnidade: z.record(z.string(), z.number()),
        metaAnualTotalGeral: z.number(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await exigirAdministrador();
    gravarMetas(data.cargaId, data.metaAnualPorUnidade, data.metaAnualTotalGeral);
    return finalizarCarga(data.cargaId);
  });

/**
 * Carrega a base pedida, já recortada para quem pediu.
 *
 * O navegador diz QUAL base quer — com dois dashboards, precisa dizer. Mas isso
 * é um pedido, não uma autorização: as unidades saem da sessão, relidas no
 * banco dentro da base pedida, a cada requisição. Quem pede uma base onde não
 * tem nenhuma unidade recebe a base vazia — sem erro e sem dados. Ver a regra
 * inteira em unidadesDaSessao.
 *
 * As unidades, essas, continuam fora do alcance do navegador: se viessem dele,
 * bastaria alterá-las na requisição para ver qualquer uma.
 */
export const carregarBaseServer = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ base: baseSchema }).parse(d))
  .handler(async ({ data }) => {
    const unidades = await unidadesDaSessao(data.base);
    return lerBase(data.base, unidades);
  });

/** As bases que a sessão pode abrir — para a tela de escolha e o alternador. */
export const basesDaSessaoServer = createServerFn({ method: "GET" }).handler(async () => ({
  bases: await basesDaSessao(),
}));

/**
 * Estado para a tela do administrador: a carga atual de uma base, o universo de
 * unidades dela, e o que a carga tem — para o envio avisar quando a carga nova
 * vai sair sem a membresia ou o saldo que a atual tem.
 */
export const estadoServer = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ base: baseSchema }).parse(d))
  .handler(async ({ data }) => {
    await exigirAdministrador();
    return {
      carga: cargaAtiva(data.base),
      unidades: listarUnidades(data.base),
      presenca: presencaDaCargaAtiva(data.base),
    };
  });
