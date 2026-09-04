import { createContext, useContext, useState, type ReactNode } from "react";
import type { FinancialRow, MembershipRow, SaldoRow } from "./parsers";
import { getSessionServer, logoutServer } from "./gate.functions";

type Step = "login" | "upload" | "dashboard";

interface AppState {
  step: Step;
  setStep: (s: Step) => void;
  user: string | null;
  setUser: (u: string | null) => void;
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
  signOut: () => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [step, setStepRaw] = useState<Step>("login");
  const [user, setUser] = useState<string | null>(null);
  const [financial, setFinancial] = useState<FinancialRow[]>([]);
  const [membership, setMembership] = useState<MembershipRow[]>([]);
  const [saldo, setSaldo] = useState<SaldoRow[]>([]);
  const [metaPorUnidade, setMeta] = useState<Record<string, number>>({});
  const [metaAnualPorUnidade, setMetaAnual] = useState<Record<string, number>>({});
  const [metaAnualTotalGeral, setMetaAnualTotal] = useState(0);

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
