import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import type { FinancialRow, MembershipRow, SaldoRow } from "./parsers";
import type { Base } from "./bases";
import { SEM_DADOS, type Presenca } from "./presenca";
import { getSessionServer, logoutServer } from "./gate.functions";
import { carregarBaseServer, basesDaSessaoServer } from "./dados.functions";

/*
 * "escolha" é a tela curta do pastor que tem as duas bases: depois do login,
 * antes do dashboard. Quem tem uma base só nunca passa por ela.
 */
type Step = "login" | "escolha" | "upload" | "dashboard";

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
  /*
   * As bases que esta sessão pode abrir, como o servidor respondeu depois do
   * login. Decidem só o que a TELA oferece — a escolha, o alternador. Pedir uma
   * base fora desta lista direto ao servidor dá dados vazios, e não erro: a
   * proteção nunca foi esconder o botão.
   */
  bases: Base[];
  /** A base aberta no dashboard. Nula antes da primeira, ou para quem não tem nenhuma. */
  base: Base | null;
  /** A base sendo aberta agora, enquanto a resposta não chega. */
  abrindo: Base | null;
  financial: FinancialRow[];
  membership: MembershipRow[];
  /** Saldo por centro de resultado. Base opcional: pode vir vazia. */
  saldo: SaldoRow[];
  metaAnualPorUnidade: Record<string, number>;
  metaAnualTotalGeral: number;
  /** O que a carga aberta tem — decide quais blocos existem. Ver src/lib/presenca.ts. */
  presenca: Presenca;
  /** Pergunta ao servidor quais bases esta sessão abre, e guarda a resposta. */
  carregarBasesDaSessao: () => Promise<Base[]>;
  /**
   * Abre o dashboard de uma base: busca os dados e só então troca tudo de uma
   * vez. Devolve `null` quando outro pedido mais novo passou na frente.
   *
   * O recorte por unidade não é decidido aqui: o servidor devolve só o que a
   * sessão de quem pediu pode ver, dentro da base pedida. Do ponto de vista do
   * dashboard, a base simplesmente é menor.
   */
  abrirBase: (base: Base) => Promise<{ vazio: boolean } | null>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [step, setStepRaw] = useState<Step>("login");
  const [user, setUser] = useState<string | null>(null);
  const [papel, setPapel] = useState<"admin" | "pastor" | null>(null);
  const [bases, setBases] = useState<Base[]>([]);
  const [base, setBase] = useState<Base | null>(null);
  const [abrindo, setAbrindo] = useState<Base | null>(null);
  const [financial, setFinancial] = useState<FinancialRow[]>([]);
  const [membership, setMembership] = useState<MembershipRow[]>([]);
  const [saldo, setSaldo] = useState<SaldoRow[]>([]);
  const [metaAnualPorUnidade, setMetaAnual] = useState<Record<string, number>>({});
  const [metaAnualTotalGeral, setMetaAnualTotal] = useState(0);
  const [presenca, setPresenca] = useState<Presenca>(SEM_DADOS);

  /*
   * O número do pedido mais recente de abrir uma base.
   *
   * Trocar de base depressa — Brasil, Angola, Brasil — dispara três pedidos, e
   * eles podem voltar fora de ordem: o de Angola, mais lento, chegaria depois
   * do último do Brasil e pintaria os números de Angola sob o alternador
   * dizendo "Brasil". Só a resposta do pedido mais novo entra na tela; as
   * outras são descartadas ao chegar.
   */
  const ultimoPedido = useRef(0);

  const carregarBasesDaSessao = async () => {
    const r = await basesDaSessaoServer();
    setBases(r.bases);
    return r.bases;
  };

  const abrirBase = async (alvo: Base) => {
    const meu = ++ultimoPedido.current;
    setAbrindo(alvo);
    try {
      const lida = await carregarBaseServer({ data: { base: alvo } });
      if (meu !== ultimoPedido.current) return null;
      /*
       * As seções chamam getMonth() em `data`, então ela precisa chegar como
       * Date e não como texto. Medido: a serialização do TanStack Start já
       * preserva o tipo, e getMonth() funciona sem tocar em nada.
       *
       * A guarda abaixo fica assim mesmo — mas só como guarda, sem custo no
       * caminho normal. Se um dia a serialização mudar, 20 mil linhas viram
       * string de uma vez e todos os gráficos de mês quebram juntos; o teste é
       * um `instanceof` numa linha, e a conversão só roda se ele falhar.
       */
      const precisaReviver =
        lida.financial.some((r) => r.data) &&
        !(lida.financial.find((r) => r.data)!.data instanceof Date);
      const financial = precisaReviver
        ? lida.financial.map((r) => ({ ...r, data: r.data ? new Date(r.data) : null }))
        : lida.financial;
      /*
       * Base e dados mudam na mesma renderização: não existe um instante em que
       * o dashboard tenha o rótulo de uma base e os números da outra.
       */
      setBase(alvo);
      setFinancial(financial);
      setMembership(lida.membership);
      setSaldo(lida.saldo);
      setMetaAnual(lida.metaAnualPorUnidade);
      setMetaAnualTotal(lida.metaAnualTotalGeral);
      setPresenca(lida.presenca);
      return { vazio: financial.length === 0 };
    } finally {
      if (meu === ultimoPedido.current) setAbrindo(null);
    }
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
    /*
     * Passos além do login passam pelo servidor. A tela de bases exige também
     * ser administrador: o comentário anterior dizia só "verifica a sessão", e
     * com isso um pastor podia chegar à tela do administrador e encontrar tudo
     * falhando — as funções de lá recusam, mas a tela não deveria abrir.
     */
    getSessionServer()
      .then((res) => {
        if (res.unlocked && (s !== "upload" || res.papel === "admin")) {
          setStepRaw(s);
        } else if (res.unlocked) {
          setStepRaw("dashboard");
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
    // Um pedido em voo, ao voltar, não pode repovoar a tela de quem saiu.
    ultimoPedido.current++;
    setUser(null);
    setPapel(null);
    setBases([]);
    setBase(null);
    setAbrindo(null);
    setFinancial([]);
    setMembership([]);
    setSaldo([]);
    setMetaAnual({});
    setMetaAnualTotal(0);
    setPresenca(SEM_DADOS);
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
        bases,
        base,
        abrindo,
        financial,
        membership,
        saldo,
        metaAnualPorUnidade,
        metaAnualTotalGeral,
        presenca,
        carregarBasesDaSessao,
        abrirBase,
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
