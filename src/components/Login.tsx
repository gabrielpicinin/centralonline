import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Lock, User, ShieldCheck } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import logoCentral from "@/assets/logo-central.png";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApp } from "@/lib/appState";
import {
  loginServer,
  precisaConfigurarServer,
  criarAdministradorServer,
} from "@/lib/gate.functions";

const MINIMO_SENHA = 8;

export function Login() {
  const { setStep, setUser, setPapel, carregarDoServidor } = useApp();
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [p2, setP2] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const login = useServerFn(loginServer);
  const criarAdmin = useServerFn(criarAdministradorServer);

  /*
   * `null` enquanto não sabemos: a tela não pode piscar o login e trocar para a
   * criação um instante depois — quem visse o login ia concluir que a conta já
   * existe, que é justamente o sinal de alarme desta tela.
   */
  const [precisaConfigurar, setPrecisaConfigurar] = useState<boolean | null>(null);

  useEffect(() => {
    void precisaConfigurarServer()
      .then((r) => setPrecisaConfigurar(r.precisa))
      // Sem resposta do servidor, o login é a suposição segura: ele não cria nada.
      .catch(() => setPrecisaConfigurar(false));
  }, []);

  /*
   * Se esta pessoa chegou por uma conexão sem cifragem.
   *
   * Olha o NAVEGADOR, e não a variável do servidor, de propósito: o que importa
   * para quem está digitando a senha é como o pedido dela viajou. O servidor
   * pode estar configurado de um jeito e alguém chegar por outro caminho — por
   * IP, por um proxy diferente — e nesse caso é a experiência real que deve
   * mandar no aviso.
   *
   * `isSecureContext` em vez de comparar o protocolo com "https:": ele já trata
   * localhost como confiável, que é o certo. Quem desenvolve na própria máquina
   * não trafega nada por rede nenhuma e não precisa ver aviso.
   *
   * Calculado depois da montagem, nunca durante a renderização: `window` não
   * existe no servidor, e decidir isto na renderização faria o HTML do servidor
   * discordar do que o navegador monta.
   */
  const [semCifragem, setSemCifragem] = useState(false);
  useEffect(() => setSemCifragem(!window.isSecureContext), []);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const res = await login({ data: { usuario: u, senha: p } });
      if (res.ok) {
        setUser(res.user);
        setPapel(res.papel);
        /*
         * O administrador passa pela tela de bases; os demais vão direto ao
         * dashboard. O passo seguinte é decidido aqui porque é o único lugar em
         * que o papel acabou de ser confirmado pelo servidor.
         */
        if (res.papel === "admin") {
          setStep("upload");
        } else {
          /*
           * O pastor não passa por nenhuma tela que carregue a base, então ela é
           * buscada aqui. O servidor devolve só as unidades dele — do ponto de
           * vista do dashboard, a base simplesmente é menor.
           */
          await carregarDoServidor();
          setStep("dashboard");
        }
      } else {
        /*
         * Uma mensagem só para usuário inexistente e senha errada. Distinguir as
         * duas entrega de graça a quem está sondando a informação de quais
         * contas existem — e, para quem errou de verdade, as duas levam à mesma
         * ação.
         */
        setErr("Usuário ou senha inválidos");
      }
    } catch {
      setErr("Erro ao autenticar. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  const configurar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (p.length < MINIMO_SENHA) {
      setErr(`A senha precisa ter pelo menos ${MINIMO_SENHA} caracteres.`);
      return;
    }
    if (p !== p2) {
      setErr("As duas senhas não são iguais.");
      return;
    }
    setLoading(true);
    try {
      const res = await criarAdmin({ data: { senha: p } });
      if (res.ok) {
        setUser(res.user);
        setPapel("admin");
        setStep("upload");
      } else {
        setPrecisaConfigurar(false);
        setErr("Esta conta já foi criada. Se não foi você, avise o TI agora.");
      }
    } catch {
      setErr("Não consegui criar a conta. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  const campoSenha = (
    id: string,
    valor: string,
    onChange: (v: string) => void,
    rotulo: string,
    autoFoco = false,
  ) => (
    <div className="space-y-2">
      <Label htmlFor={id}>{rotulo}</Label>
      <div className="relative">
        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-3" />
        <Input
          id={id}
          type="password"
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          className="pl-9 h-11 bg-panel-2 border-line-strong text-ink placeholder:text-ink-3 focus-visible:border-acc"
          placeholder="••••••••"
          autoFocus={autoFoco}
        />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#10131A] via-[#141822] to-[#191E27] p-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md bg-panel rounded-2xl shadow-panel-lg border border-line-soft p-8"
      >
        <div className="flex flex-col items-center text-center mb-8">
          <div className="h-16 w-16 rounded-xl bg-panel-2 border border-line-strong grid place-content-center mb-4 shadow-panel overflow-hidden">
            <img src={logoCentral} alt="Central" className="h-14 w-14 object-contain" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            Dashboard Financeiro Central
          </h1>
          <p className="text-sm text-ink-2 mt-1">
            {precisaConfigurar ? "Primeira configuração" : "Acesso restrito"}
          </p>
        </div>

        {/* Enquanto não se sabe qual das duas telas é, nenhuma aparece. */}
        {precisaConfigurar === null ? (
          <p className="py-8 text-center text-sm text-ink-3">Verificando…</p>
        ) : precisaConfigurar ? (
          <form onSubmit={configurar} className="space-y-4">
            <div className="flex gap-3 rounded-lg border border-acc/30 bg-acc/[.07] p-3.5">
              <ShieldCheck className="h-5 w-5 shrink-0 text-acc" />
              <div className="text-sm text-ink-2">
                <p className="font-semibold text-ink">Criar o acesso do Financeiro</p>
                <p className="mt-1">
                  Ainda não existe nenhuma conta. Defina a senha do administrador — esta tela
                  desaparece depois e não volta.
                </p>
              </div>
            </div>
            {campoSenha("nova", p, setP, "Senha do Financeiro", true)}
            {campoSenha("conf", p2, setP2, "Repita a senha")}
            <p className="text-xs text-ink-3">
              Mínimo de {MINIMO_SENHA} caracteres. Guarde num gerenciador de senhas: não há
              recuperação por e-mail, e esta é a conta que administra todas as outras.
            </p>
            {err && <p className="text-sm text-neg">{err}</p>}
            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 bg-acc text-background font-semibold hover:brightness-110 shadow-panel transition-all disabled:opacity-60"
            >
              {loading ? "Criando…" : "Criar acesso e entrar"}
            </Button>
          </form>
        ) : (
          <form onSubmit={entrar} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="user">Usuário</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-3" />
                <Input
                  id="user"
                  value={u}
                  onChange={(e) => setU(e.target.value)}
                  className="pl-9 h-11 bg-panel-2 border-line-strong text-ink placeholder:text-ink-3 focus-visible:border-acc"
                  placeholder="Seu e-mail"
                  autoFocus
                />
              </div>
            </div>
            {campoSenha("pwd", p, setP, "Senha")}
            {err && <p className="text-sm text-neg">{err}</p>}
            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 bg-acc text-background font-semibold hover:brightness-110 shadow-panel transition-all disabled:opacity-60"
            >
              {loading ? "Entrando..." : "Entrar"}
            </Button>
          </form>
        )}

        {/*
          Informativo, não alerta. Fica no rodapé do cartão, na cor mais apagada
          da paleta e sem ícone de perigo: quem usa não escolheu isto e não pode
          resolver, então assustar só geraria chamado para o TI. O que a linha
          faz é evitar a surpresa de descobrir depois — e deixar a decisão de
          implantação visível no próprio produto, não só num documento que
          ninguém abre.
        */}
        {semCifragem && (
          <p className="mt-6 border-t border-line-soft pt-4 text-center text-xs text-ink-3">
            Conexão não cifrada. Use apenas na rede interna.
          </p>
        )}
      </motion.div>
    </div>
  );
}
