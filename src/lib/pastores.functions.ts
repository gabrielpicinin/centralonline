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
  senhaCifradaDoPastor,
} from "./banco.server";
import { gerarHash, gerarSenhaLegivel, cifrarSenha, decifrarSenha } from "./senha.server";
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
     * A senha é gerada aqui e devolvida para o administrador copiar. Vai para o
     * banco de dois jeitos: em hash, que é o que o login confere, e cifrada,
     * para o "Mostrar senha" poder exibi-la de novo depois.
     *
     * Antes só existia o hash, e fechar a tela sem copiar obrigava a gerar
     * outra. Ficou pior em HTTP, onde o botão de copiar pode falhar. A decisão
     * de guardar recuperável, e por que ela é aceitável para pastor e não para
     * administrador, está em senha.server.ts.
     */
    const senha = gerarSenhaLegivel();
    const perfil = criarPerfil({
      usuario: data.usuario,
      nome: data.nome,
      papel: "pastor",
      senhaHash: await gerarHash(senha),
      senhaCifrada: cifrarSenha(senha),
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
    // Hash e cifrada juntos, num comando só — ver trocarSenha em banco.server.ts.
    trocarSenha(perfil.id, await gerarHash(senha), cifrarSenha(senha));
    return { ok: true as const, senha };
  });

/**
 * Mostra de novo a senha de um pastor.
 *
 * Três respostas possíveis, e a tela precisa distinguir as três:
 *   - a senha, quando ela existe e decifra;
 *   - "anterior", quando a conta é de antes deste recurso e só tem hash — a
 *     senha dela nunca foi guardada recuperável e não há como obtê-la;
 *   - "ilegivel", quando existia mas não decifra mais, o que quase sempre
 *     significa SESSION_SECRET trocado.
 * Nos dois casos sem senha, a saída é a mesma — gerar uma nova —, mas dizer
 * POR QUE evita que o administrador ache que o sistema está quebrado.
 */
export const mostrarSenhaServer = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ perfilId: z.number().int().positive() }).parse(d))
  .handler(async ({ data }) => {
    await exigirAdministrador();
    const perfil = buscarPorId(data.perfilId);
    // Só pastor. A consulta em senhaCifradaDoPastor já filtra por papel; esta
    // linha é a segunda camada, e a que devolve uma resposta legível.
    if (!perfil || perfil.papel !== "pastor")
      return { ok: false as const, motivo: "invalido" as const };

    const guardada = senhaCifradaDoPastor(perfil.id);
    if (!guardada) return { ok: false as const, motivo: "anterior" as const };

    const senha = decifrarSenha(guardada);
    if (!senha) return { ok: false as const, motivo: "ilegivel" as const };

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
