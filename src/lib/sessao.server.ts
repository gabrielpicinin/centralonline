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

export interface DadosSessao {
  unlocked?: boolean;
  user?: string;
  /*
   * Preenchidos na Fase 2, quando existirem contas de verdade. Até lá a sessão
   * carrega só o gate de senha única, e `papel` ausente é tratado como
   * administrador — que é exatamente o que a senha única concede hoje.
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
 * Hoje devolve sempre `null`, porque ainda não existem contas por pessoa — a
 * senha única do gate concede o acesso inteiro. Na Fase 4 esta função passa a
 * consultar as permissões do perfil, e o recorte entra em vigor em todo o
 * dashboard sem que nenhuma outra linha precise mudar: quem chama `lerBase` já
 * a chama através daqui.
 */
export async function unidadesDaSessao(): Promise<string[] | null> {
  const dados = await exigirSessao();
  if (dados.papel === "pastor") {
    // Fase 4 preenche. Até lá, um perfil de pastor sem permissões não vê nada,
    // que é o padrão seguro: liberar é um ato explícito, nunca o esquecimento.
    return [];
  }
  return null;
}
