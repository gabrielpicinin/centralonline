/*
 * Entrada no sistema: primeira execução, login e saída.
 *
 * Até a Fase 1 existia uma senha única, vinda do ambiente, igual para todos.
 * Ela sai daqui inteira: agora cada pessoa tem conta própria, e é por isso que
 * o recorte por unidade da Fase 4 vai significar alguma coisa — uma senha
 * compartilhada faria qualquer pastor entrar na conta de qualquer outro.
 */
import { createServerFn } from "@tanstack/react-start";
import { useSession, getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import {
  contarPerfis,
  criarPerfil,
  buscarPorUsuario,
  buscarPorId,
  registrarAcesso,
} from "./banco.server";
import { gerarHash, conferirSenha, queimarTempoDeSenha } from "./senha.server";
import { origemDaRequisicao } from "./origem";
import { getSessionConfig, type DadosSessao } from "./sessao.server";

/** O usuário do administrador, definido pela Central. */
const USUARIO_ADMIN = "Financeiro";

/*
 * Freio de força bruta por atraso progressivo, não por bloqueio.
 *
 * Um bloqueio após N erros tem um defeito que só aparece ao testar: quando o
 * cabeçalho de IP não chega — atrás de um proxy que não o repassa, ou em
 * desenvolvimento — todo mundo cai no mesmo balde, e quem errar a senha várias
 * vezes tranca o usuário legítimo junto. Um bloqueio que pode ser disparado de
 * fora é uma negação de serviço embutida.
 *
 * O atraso não tem esse problema: cada erro dobra a espera até um teto de 5s.
 * Depois de oito erros o atacante consegue ~12 tentativas por minuto, o que
 * inviabiliza a varredura, e quem sabe a senha entra na tentativa seguinte —
 * só que esperando alguns segundos. Ninguém fica trancado.
 */
const JANELA_MS = 10 * 60 * 1000;
const ATRASO_BASE_MS = 100;
const ATRASO_MAX_MS = 5000;
const tentativas = new Map<string, { falhas: number; ate: number }>();

function atrasoDaOrigem(chave: string): number {
  const reg = tentativas.get(chave);
  if (!reg || Date.now() > reg.ate) return 0;
  return Math.min(ATRASO_BASE_MS * 2 ** reg.falhas, ATRASO_MAX_MS);
}

/*
 * O balde do freio. A regra inteira — e o porquê de cada parte dela — está em
 * ./origem.ts; aqui fica só a ponte com a requisição.
 *
 * Em resumo: `cf-connecting-ip` saiu, porque sem Cloudflare na frente ele é
 * texto que o próprio cliente escreve, e tinha precedência sobre tudo. E do
 * `x-forwarded-for` passa a valer o ÚLTIMO elemento, não o primeiro, porque o
 * Apache acrescenta no fim da lista — o primeiro era o que o atacante mandava.
 */
function chaveDeOrigem(): string {
  try {
    return origemDaRequisicao(getRequest()?.headers.get("x-forwarded-for"));
  } catch {
    return "desconhecido";
  }
}

function registrarFalha(chave: string) {
  const agora = Date.now();
  const reg = tentativas.get(chave);
  if (!reg || agora > reg.ate) tentativas.set(chave, { falhas: 1, ate: agora + JANELA_MS });
  else reg.falhas += 1;
  // Limpeza preguiçosa: sem isto o Map cresceria com cada origem já expirada.
  if (tentativas.size > 5000) {
    for (const [k, v] of tentativas) if (agora > v.ate) tentativas.delete(k);
  }
}

/*
 * Regra de senha deliberadamente curta: só tamanho mínimo.
 *
 * Exigir maiúscula, número e símbolo produz senha anotada em papel — o
 * resultado prático é pior. O que sustenta a segurança aqui é o contexto: o app
 * só existe dentro da rede da Central, atrás da VPN, e o freio acima torna a
 * varredura inviável.
 */
const MINIMO_SENHA = 8;

/* ============================ primeira execução ============================ */

/**
 * Diz se o sistema ainda não tem nenhuma conta.
 *
 * Enquanto for verdade, a tela mostra a criação do administrador em vez do
 * login. Assim que a primeira conta nasce vira falso para sempre, e não há
 * caminho de volta — se você abrir o endereço e vir o login quando esperava a
 * criação, alguém chegou antes e é hora de falar com o TI.
 */
export const precisaConfigurarServer = createServerFn({ method: "GET" }).handler(async () => ({
  precisa: contarPerfis() === 0,
}));

export const criarAdministradorServer = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ senha: z.string().min(MINIMO_SENHA).max(256) }).parse(d))
  .handler(async ({ data }) => {
    /*
     * A contagem é conferida aqui de novo, e não só na tela. A tela some sozinha
     * depois da primeira conta, mas quem chamasse esta função direto contornaria
     * a tela — e sem esta linha criaria um segundo administrador.
     */
    if (contarPerfis() > 0) return { ok: false as const, motivo: "ja-configurado" as const };

    const perfil = criarPerfil({
      usuario: USUARIO_ADMIN,
      nome: USUARIO_ADMIN,
      papel: "admin",
      senhaHash: await gerarHash(data.senha),
    });
    // Criar o acesso já é entrar: a tela seguinte é a do administrador.
    registrarAcesso(perfil.id);

    const session = await useSession<DadosSessao>(getSessionConfig());
    await session.update({
      unlocked: true,
      user: perfil.usuario,
      perfilId: perfil.id,
      papel: "admin",
    });
    return { ok: true as const, user: perfil.usuario };
  });

/* ================================ login ================================ */

const loginSchema = z.object({
  usuario: z.string().min(1).max(200),
  senha: z.string().min(1).max(256),
});

export const loginServer = createServerFn({ method: "POST" })
  .validator((data: unknown) => loginSchema.parse(data))
  .handler(async ({ data }) => {
    const origem = chaveDeOrigem();
    /*
     * A espera vem antes da conferência e vale para qualquer resposta: se só
     * atrasasse os erros, o tempo de resposta viraria um oráculo de acerto.
     */
    const espera = atrasoDaOrigem(origem);
    if (espera) await new Promise((r) => setTimeout(r, espera));

    const perfil = buscarPorUsuario(data.usuario);

    /*
     * Usuário inexistente também paga o custo do scrypt. Sem isso, "não existe"
     * responderia na hora e "senha errada" levaria ~60ms — e essa diferença diz
     * a quem está sondando quais e-mails têm conta.
     */
    if (!perfil || !perfil.ativo) {
      await queimarTempoDeSenha(data.senha);
      registrarFalha(origem);
      return { ok: false as const };
    }

    if (!(await conferirSenha(data.senha, perfil.senhaHash))) {
      registrarFalha(origem);
      return { ok: false as const };
    }

    tentativas.delete(origem);
    /*
     * Registrado só depois de tudo conferido, e antes da sessão: tentativa
     * errada não conta como acesso. Neste sistema, login bem-sucedido é o
     * mesmo que "entrou no dashboard", porque toda carga de página começa
     * pela tela de login — ver appState.tsx.
     */
    registrarAcesso(perfil.id);
    const session = await useSession<DadosSessao>(getSessionConfig());
    await session.update({
      unlocked: true,
      user: perfil.usuario,
      perfilId: perfil.id,
      papel: perfil.papel,
    });
    return { ok: true as const, user: perfil.usuario, papel: perfil.papel };
  });

export const getSessionServer = createServerFn({ method: "GET" }).handler(async () => {
  const session = await useSession<DadosSessao>(getSessionConfig());
  if (!session.data.unlocked || !session.data.perfilId) return { unlocked: false as const };

  /*
   * O papel é reconferido no banco a cada visita, em vez de confiar no que está
   * no cookie. Uma conta desativada precisa perder o acesso na hora, e não
   * daqui a sete dias quando o cookie vencer.
   */
  const perfil = buscarPorId(session.data.perfilId);
  if (!perfil || !perfil.ativo) {
    await session.clear();
    return { unlocked: false as const };
  }
  return { unlocked: true as const, user: perfil.usuario, papel: perfil.papel };
});

export const logoutServer = createServerFn({ method: "POST" }).handler(async () => {
  const session = await useSession<DadosSessao>(getSessionConfig());
  await session.clear();
  return { ok: true as const };
});
