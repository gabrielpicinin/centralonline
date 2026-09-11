/*
 * A sessão: quem está do outro lado da requisição.
 *
 * Separado do gate porque agora há dois consumidores — o login e as funções de
 * dados — e a configuração do cookie precisa ser idêntica nos dois. Duas cópias
 * da mesma configuração é o tipo de coisa que funciona por meses e quebra no
 * dia em que alguém mexe numa só.
 *
 * Sufixo `.server`: só pode ser importado de dentro de um `.functions.ts`.
 */
import { useSession } from "@tanstack/react-start/server";
import { buscarPorId, unidadesDoPerfil } from "./banco.server";

export interface DadosSessao {
  unlocked?: boolean;
  user?: string;
  /*
   * Quem é, de fato. O papel viaja no cookie só para a tela saber o que
   * desenhar; toda decisão de acesso reconfere no banco, porque uma conta
   * desativada ou com unidades alteradas precisa valer na hora — e não daqui a
   * sete dias, quando o cookie vencer.
   */
  perfilId?: number;
  papel?: "admin" | "pastor";
}

function exigirVariavel(nome: "SESSION_SECRET"): string {
  const valor = process.env[nome];
  if (!valor) {
    console.error(
      `[sessao] ${nome} não está definida. No seu computador, preencha o .env; ` +
        `no servidor, defina a variável de ambiente do serviço.`,
    );
    throw new Error("Internal server error");
  }
  return valor;
}

export function getSessionConfig() {
  const password = exigirVariavel("SESSION_SECRET");
  /*
   * A cifragem de sessão do h3 exige 32 caracteres. Abaixo disso ela falha lá
   * dentro, com um erro que não aponta para a causa.
   */
  if (password.length < 32) {
    console.error(
      "[sessao] SESSION_SECRET tem menos de 32 caracteres; a sessão não pode ser cifrada",
    );
    throw new Error("Internal server error");
  }
  return {
    password,
    name: "central-gate",
    maxAge: 60 * 60 * 24 * 7, // 7 dias
    cookie: {
      httpOnly: true,
      secure: true,
      /*
       * "lax", não "none". "none" manda o cookie de sessão junto em requisições
       * vindas de outros sites, que é a porta de entrada de CSRF; só faz sentido
       * quando a página precisa rodar dentro de um iframe de outro domínio, e
       * este dashboard é autônomo.
       */
      sameSite: "lax" as const,
      path: "/",
    },
  };
}

export async function lerSessao(): Promise<DadosSessao> {
  const s = await useSession<DadosSessao>(getSessionConfig());
  return s.data ?? {};
}

/**
 * Portão de entrada de toda função de servidor que devolve dados.
 *
 * Lança quando não há sessão. A mensagem é genérica de propósito: distinguir
 * "não está logado" de "não pode isso" entrega informação de graça a quem está
 * sondando, e para o usuário legítimo as duas levam à mesma ação — entrar.
 */
export async function exigirSessao(): Promise<DadosSessao> {
  const dados = await lerSessao();
  if (!dados.unlocked) throw new Error("Não autorizado");
  return dados;
}

/**
 * As unidades que esta sessão pode ver. `null` significa "todas".
 *
 * É daqui que sai o argumento de `lerBase`, a porta única de leitura. O valor
 * NUNCA vem do navegador: se viesse, bastaria alterá-lo na requisição para ver
 * qualquer unidade. Ele sai da sessão, e a sessão sai do cookie assinado.
 *
 * O papel é reconferido no banco a cada leitura em vez de confiar no cookie.
 * Sem isso, tirar uma unidade de um pastor só valeria quando o cookie dele
 * vencesse — até sete dias depois.
 */
export async function unidadesDaSessao(): Promise<string[] | null> {
  const dados = await exigirSessao();
  if (!dados.perfilId) throw new Error("Não autorizado");

  const perfil = buscarPorId(dados.perfilId);
  if (!perfil || !perfil.ativo) throw new Error("Não autorizado");
  if (perfil.papel === "admin") return null;

  /*
   * Pastor sem nenhuma unidade marcada recebe lista vazia, e lista vazia é
   * "nada" — não "tudo". Liberar acesso é sempre um ato explícito de quem
   * administra; nunca o resultado de um esquecimento.
   */
  return unidadesDoPerfil(perfil.id);
}

/** Só administradores. Usado pelas funções que enviam base e mudam permissões. */
export async function exigirAdministrador(): Promise<DadosSessao> {
  const dados = await exigirSessao();
  const perfil = dados.perfilId ? buscarPorId(dados.perfilId) : null;
  if (!perfil || !perfil.ativo || perfil.papel !== "admin") throw new Error("Não autorizado");
  return dados;
}
