import { createStart, createMiddleware, createCsrfMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

/*
 * Recusa chamadas de função de servidor vindas de outro site.
 *
 * Isto aqui não é um acréscimo: é a reposição de algo que o próprio framework
 * dá de graça e que este arquivo tinha tirado sem querer. O TanStack só instala
 * a proteção padrão quando o projeto NÃO define um `startInstance`; a partir do
 * momento em que definimos um (para a página de erro), a lista de middlewares
 * passa a ser a nossa, e a dele é descartada inteira. O aviso no console ao
 * subir o servidor era exatamente isso.
 *
 * Na prática o cookie de sessão já bloqueia o ataque clássico, porque está com
 * `SameSite=Lax` e não viaja num POST vindo de fora. São duas camadas
 * independentes, e é de propósito: a de cima depende de um atributo de cookie
 * que alguém pode afrouxar no futuro sem perceber a consequência.
 *
 * O filtro deixa passar a navegação normal — quem abre o dashboard vem de fora
 * e é legítimo. Só as chamadas RPC são conferidas.
 *
 * Se um dia aparecer 403 em tudo atrás do proxy do TI, é aqui: a conferência
 * olha `Sec-Fetch-Site` primeiro, que nenhum proxy mexe, mas cai para `Origin`
 * em navegador antigo — e aí um proxy que entrega em outro endereço interno faz
 * a comparação falhar.
 */
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

// O de erro vem primeiro para envolver todo o resto, inclusive o de CSRF.
export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware, csrfMiddleware],
}));
