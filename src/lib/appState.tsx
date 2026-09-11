import { createContext, useContext, useState, type ReactNode } from "react";
import type { FinancialRow, MembershipRow, SaldoRow } from "./parsers";
import { getSessionServer, logoutServer } from "./gate.functions";
import { carregarBaseServer } from "./dados.functions";

type Step = "login" | "upload" | "dashboard";

interface AppState {
  step: Step;
  setStep: (s: Step) => void;
  user: string | null;
  setUser: (u: string | null) => void;
  /*
   * O papel decide o caminho: administrador passa pela tela de bases, pastor vai
   * direto ao dashboard. Serve só para a tela saber o que desenhar — toda
   * decisão de acesso é reconferida no servidor a cada requisição.
   */
  papel: "admin" | "pastor" | null;
  setPapel: (p: "admin" | "pastor" | null) => void;
  financial: FinancialRow[];
  membership: MembershipRow[];
  /** Saldo por centro de resultado. Base opcional: pode vir vazia. */
  saldo: SaldoRow[];
  metaPorUnidade: Record<string, number>;
  metaAnualPorUnidade: Record<string, number>;
  metaAnualTotalGeral: number;
  setData: (
    f: FinancialRow[],
    m: MembershipRow[],
    s: SaldoRow[],
    meta: Record<string, number>,
    metaAnual: Record<string, number>,
    metaAnualTotal: number,
  ) => void;
  /**
   * Busca as bases no servidor e as coloca em memória.
   *
   * O recorte por unidade não é decidido aqui: o servidor devolve só o que a
   * sessão de quem pediu pode ver. Do ponto de vista do dashboard, a base
   * simplesmente é menor — nenhuma seção precisa saber que existe um recorte.
   */
  carregarDoServidor: () => Promise<{ vazio: boolean }>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [step, setStepRaw] = useState<Step>("login");
  const [user, setUser] = useState<string | null>(null);
  const [papel, setPapel] = useState<"admin" | "pastor" | null>(null);
  const [financial, setFinancial] = useState<FinancialRow[]>([]);
  const [membership, setMembership] = useState<MembershipRow[]>([]);
  const [saldo, setSaldo] = useState<SaldoRow[]>([]);
  const [metaPorUnidade, setMeta] = useState<Record<string, number>>({});
  const [metaAnualPorUnidade, setMetaAnual] = useState<Record<string, number>>({});
  const [metaAnualTotalGeral, setMetaAnualTotal] = useState(0);

  const carregarDoServidor = async () => {
    const base = await carregarBaseServer();
    /*
     * As seções chamam getMonth() em `data`, então ela precisa chegar como Date
     * e não como texto. Medido: a serialização do TanStack Start já preserva o
     * tipo, e getMonth() funciona sem tocar em nada.
     *
     * A guarda abaixo fica assim mesmo — mas só como guarda, sem custo no
     * caminho normal. Se um dia a serialização mudar, 20 mil linhas viram
     * string de uma vez e todos os gráficos de mês quebram juntos; o teste é um
     * `instanceof` numa linha, e a conversão só roda se ele falhar.
     */
    const precisaReviver =
      base.financial.some((r) => r.data) &&
      !(base.financial.find((r) => r.data)!.data instanceof Date);
    const financial = precisaReviver
      ? base.financial.map((r) => ({ ...r, data: r.data ? new Date(r.data) : null }))
      : base.financial;
    setFinancial(financial);
    setMembership(base.membership);
    setSaldo(base.saldo);
    setMetaAnual(base.metaAnualPorUnidade);
    setMetaAnualTotal(base.metaAnualTotalGeral);
    /*
     * A meta MENSAL por unidade é a anual dividida por doze — derivada, não
     * guardada. Uma segunda cópia no banco só criaria a chance de as duas
     * discordarem.
     */
    const mensal: Record<string, number> = {};
    for (const [nome, anual] of Object.entries(base.metaAnualPorUnidade)) mensal[nome] = anual / 12;
    setMeta(mensal);
    return { vazio: financial.length === 0 };
  };

  /*
   * Toda carga de página começa no login, mesmo com o cookie de sessão ainda
   * válido. Antes o app pulava direto para "upload" quando havia sessão, o que
   * escondia a tela de login de quem voltava ao site dentro dos 7 dias.
   *
   * Restaurar o passo não trazia ganho real: as bases vivem só em memória e se
   * perdem no reload, então quem voltava caía numa tela de upload vazia e tinha
   * de subir os arquivos de novo de qualquer jeito.
   *
   * O cookie continua existindo e é ele que o setStep abaixo valida no servidor
   * antes de liberar qualquer passo além do login.
   */

  // Gate any client navigation away from "login" through the server session.
  const setStep = (s: Step) => {
    if (s === "login") {
      setStepRaw("login");
      return;
    }
    // For upload/dashboard, verify the server session before allowing it.
    getSessionServer()
      .then((res) => {
        if (res.unlocked) {
          setStepRaw(s);
        } else {
          setUser(null);
          setStepRaw("login");
        }
      })
      .catch(() => {
        setUser(null);
        setStepRaw("login");
      });
  };

  const signOut = async () => {
    try {
      await logoutServer();
    } catch {
      // Best-effort — clear local state regardless.
    }
    setUser(null);
    setPapel(null);
    setFinancial([]);
    setMembership([]);
    setSaldo([]);
    setMeta({});
    setMetaAnual({});
    setMetaAnualTotal(0);
    setStepRaw("login");
  };

  return (
    <Ctx.Provider
      value={{
        step,
        setStep,
        user,
        setUser,
        papel,
        setPapel,
        financial,
        membership,
        saldo,
        metaPorUnidade,
        metaAnualPorUnidade,
        metaAnualTotalGeral,
        setData: (f, m, s, meta, metaAnual, metaAnualTotal) => {
          setFinancial(f);
          setMembership(m);
          setSaldo(s);
          setMeta(meta);
          setMetaAnual(metaAnual);
          setMetaAnualTotal(metaAnualTotal);
        },
        carregarDoServidor,
        signOut,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error("AppProvider missing");
  return v;
}
