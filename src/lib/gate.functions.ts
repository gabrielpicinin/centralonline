import { createServerFn } from "@tanstack/react-start";
import { useSession, getRequest } from "@tanstack/react-start/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

type GateSession = { unlocked?: boolean; user?: string };

/*
 * As três variáveis nunca vivem no código nem no bundle — são lidas do ambiente
 * a cada requisição. Localmente vêm do .env (que está no .gitignore); no site
 * publicado, do ambiente configurado no projeto do Lovable, que é quem hospeda.
 * Ver README, "Segredos".
 *
 * A mensagem diz onde procurar. Sem ela, um ambiente sem as variáveis devolve
 * 500 em toda tela de login, sem nenhuma pista do motivo.
 */
function exigir(nome: "SITE_USERNAME" | "SITE_PASSWORD" | "SESSION_SECRET"): string {
  const valor = process.env[nome];
  if (!valor) {
    console.error(
      `[gate] ${nome} não está definida. No seu computador, preencha o .env; ` +
        `no site publicado, defina a variável no projeto do Lovable.`,
    );
    throw new Error("Internal server error");
  }
  return valor;
}

function getSessionConfig() {
  const password = exigir("SESSION_SECRET");
  /*
   * A cifragem de sessão do h3 exige 32 caracteres. Abaixo disso ela falha lá
   * dentro, com um erro que não aponta para a causa.
   */
  if (password.length < 32) {
    console.error(
      "[gate] SESSION_SECRET tem menos de 32 caracteres; a sessão não pode ser cifrada",
    );
    throw new Error("Internal server error");
  }
  return {
    password,
    name: "central-gate",
    maxAge: 60 * 60 * 24 * 7, // 7 days
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

/*
 * Freio de força bruta por atraso progressivo, não por bloqueio.
 *
 * A primeira versão travava a origem após 8 erros, e isso tem um defeito que só
 * apareceu ao testar: quando o cabeçalho de IP não chega — atrás de um proxy que
 * não o repassa, ou em desenvolvimento — todo mundo cai no mesmo balde, e quem
 * errar a senha oito vezes tranca o usuário legítimo junto. Um bloqueio que
 * pode ser disparado de fora é uma negação de serviço embutida.
 *
 * O atraso não tem esse problema: cada erro dobra a espera até um teto de 5s.
 * Depois de oito erros o atacante consegue ~12 tentativas por minuto, o que
 * inviabiliza a varredura, e quem sabe a senha entra na tentativa seguinte —
 * só que esperando alguns segundos. Ninguém fica trancado.
 *
 * O estado é de processo; num Worker vive por isolate, então não é uma trava
 * absoluta. Não precisa ser: o objetivo é encarecer, não impedir.
 */
const JANELA_MS = 10 * 60 * 1000;
const ATRASO_BASE_MS = 100;
const ATRASO_MAX_MS = 5000;
const tentativas = new Map<string, { falhas: number; ate: number }>();

/** Quanto esperar antes de responder a esta origem. */
function atrasoDaOrigem(chave: string): number {
  const reg = tentativas.get(chave);
  if (!reg || Date.now() > reg.ate) return 0;
  return Math.min(ATRASO_BASE_MS * 2 ** reg.falhas, ATRASO_MAX_MS);
}

function chaveDeOrigem(): string {
  try {
    const req = getRequest();
    return (
      req?.headers.get("cf-connecting-ip") ??
      req?.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
      "desconhecido"
    );
  } catch {
    return "desconhecido";
  }
}

function registrarFalha(chave: string) {
  const agora = Date.now();
  const reg = tentativas.get(chave);
  if (!reg || agora > reg.ate) tentativas.set(chave, { falhas: 1, ate: agora + JANELA_MS });
  else reg.falhas += 1;
  // Limpeza preguiçosa: sem isto o Map cresceria com cada IP que já expirou.
  if (tentativas.size > 5000) {
    for (const [k, v] of tentativas) if (agora > v.ate) tentativas.delete(k);
  }
}

function safeEquals(a: string, b: string): boolean {
  const da = createHash("sha256").update(a, "utf8").digest();
  const db = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(da, db);
}

const loginSchema = z.object({
  username: z.string().min(1).max(128),
  password: z.string().min(1).max(256),
});

export const loginServer = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => loginSchema.parse(data))
  .handler(async ({ data }) => {
    const expectedUser = exigir("SITE_USERNAME");
    const expectedPass = exigir("SITE_PASSWORD");
    const origem = chaveDeOrigem();
    /*
     * A espera vem antes da comparação e vale para qualquer resposta: se só
     * atrasasse os erros, o tempo de resposta viraria um oráculo de acerto.
     */
    const espera = atrasoDaOrigem(origem);
    if (espera) await new Promise((r) => setTimeout(r, espera));

    const userOk = safeEquals(data.username.trim(), expectedUser);
    const passOk = safeEquals(data.password, expectedPass);
    if (!userOk || !passOk) {
      registrarFalha(origem);
      return { ok: false as const };
    }

    tentativas.delete(origem);
    const session = await useSession<GateSession>(getSessionConfig());
    await session.update({ unlocked: true, user: expectedUser });
    return { ok: true as const, user: expectedUser };
  });

export const getSessionServer = createServerFn({ method: "GET" }).handler(async () => {
  const session = await useSession<GateSession>(getSessionConfig());
  if (!session.data.unlocked) return { unlocked: false as const };
  return { unlocked: true as const, user: session.data.user ?? null };
});

export const logoutServer = createServerFn({ method: "POST" }).handler(async () => {
  const session = await useSession<GateSession>(getSessionConfig());
  await session.clear();
  return { ok: true as const };
});
