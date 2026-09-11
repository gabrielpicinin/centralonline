/*
 * Administração de pastores: cadastrar, definir unidades, gerar senha nova e
 * desativar.
 *
 * Toda função aqui começa por exigirAdministrador(). Esconder a tela não
 * protegeria nada — quem chamasse estas funções direto contornaria a tela
 * inteira —, e por isso a verificação vive no servidor, operação a operação.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  listarPastores,
  listarUnidades,
  permissoesOrfas,
  criarPerfil,
  salvarPermissoes,
  definirAtivo,
  trocarSenha,
  usuarioExiste,
  buscarPorId,
} from "./banco.server";
import { gerarHash, gerarSenhaLegivel } from "./senha.server";
import { exigirAdministrador } from "./sessao.server";

/** Tudo o que a seção "Unidades por pastor" precisa, numa chamada. */
export const listarPastoresServer = createServerFn({ method: "GET" }).handler(async () => {
  await exigirAdministrador();
  return { pastores: listarPastores(), unidades: listarUnidades(), orfas: permissoesOrfas() };
});

const usuarioSchema = z
  .string()
  .trim()
  .min(3)
  .max(200)
  /*
   * O usuário do pastor é o e-mail dele, por decisão da Central. A validação é
   * frouxa de propósito: recusar endereços válidos por excesso de zelo numa
   * tela que só o administrador usa trocaria um problema raro por um comum.
   */
  .refine((v) => v.includes("@") && v.includes("."), {
    message: "Informe um e-mail válido",
  });

export const criarPastorServer = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ nome: z.string().trim().min(2).max(200), usuario: usuarioSchema }).parse(d),
  )
  .handler(async ({ data }) => {
    await exigirAdministrador();
    if (usuarioExiste(data.usuario)) {
      return { ok: false as const, motivo: "ja-existe" as const };
    }

    /*
     * A senha é gerada aqui e devolvida UMA vez, para o administrador copiar.
     * Ela não é guardada em texto em lugar nenhum — o que fica no banco é o
     * hash. Se a tela for fechada antes de copiar, o caminho é gerar outra;
     * não existe "ver a senha de novo", porque isso exigiria guardá-la.
     */
    const senha = gerarSenhaLegivel();
    const perfil = criarPerfil({
      usuario: data.usuario,
      nome: data.nome,
      papel: "pastor",
      senhaHash: await gerarHash(senha),
    });
    return { ok: true as const, perfil, senha };
  });

export const regerarSenhaServer = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ perfilId: z.number().int().positive() }).parse(d))
  .handler(async ({ data }) => {
    await exigirAdministrador();
    const perfil = buscarPorId(data.perfilId);
    /*
     * Só pastores. Sem esta linha, um administrador poderia gerar senha nova
     * para a própria conta por engano e se trancar para fora — e, sem e-mail de
     * recuperação, isso exigiria o TI no arquivo do banco.
     */
    if (!perfil || perfil.papel !== "pastor") return { ok: false as const };

    const senha = gerarSenhaLegivel();
    trocarSenha(perfil.id, await gerarHash(senha));
    return { ok: true as const, senha };
  });

export const salvarPermissoesServer = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        alteracoes: z
          .array(
            z.object({
              perfilId: z.number().int().positive(),
              unidades: z.array(z.string().max(300)).max(500),
            }),
          )
          .max(200),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await exigirAdministrador();
    salvarPermissoes(data.alteracoes);
    /*
     * Devolve a lista relida do banco, e não a que chegou. É o que faz a tela
     * mostrar o que de fato ficou gravado: se algo tivesse sido descartado, o
     * administrador veria na hora em vez de sair achando que salvou.
     */
    return { pastores: listarPastores(), orfas: permissoesOrfas() };
  });

export const definirAtivoServer = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ perfilId: z.number().int().positive(), ativo: z.boolean() }).parse(d),
  )
  .handler(async ({ data }) => {
    await exigirAdministrador();
    const perfil = buscarPorId(data.perfilId);
    // Mesma razão do regerar: o administrador não se desativa por engano.
    if (!perfil || perfil.papel !== "pastor") return { ok: false as const };
    definirAtivo(perfil.id, data.ativo);
    return { ok: true as const, pastores: listarPastores(), orfas: permissoesOrfas() };
  });
