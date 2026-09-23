import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  ReferenceLine,
  ComposedChart,
} from "recharts";
import { motion } from "framer-motion";
import {
  Target,
  Wallet,
  HandCoins,
  TrendingDown,
  User,
  Users,
  Banknote,
  Percent,
  Maximize2,
  Minimize2,
  Scale,
} from "lucide-react";
import { BRLcompact, fmtBRL, fmtPct, MESES } from "@/lib/format";
import {
  classifyNat3,
  isDizimosOfertas,
  membershipForMonth,
  norm,
  type FinancialRow,
  type MembershipRow,
  type SaldoRow,
  metaAnualDaUnidade,
} from "@/lib/parsers";
import { useAnimarGraficos } from "./secaoAtiva";

interface Props {
  /**
   * Como nomear o recorte quando nenhuma unidade está filtrada. Vem do
   * Dashboard porque depende de quem está logado — ver a nota lá.
   */
  rotuloTodasUnidades: string;
  /**
   * Se os cards de Receita e Despesa Total leem "Crédito 2" / "Débito 2" em
   * vez de "Crédito" / "Débito". Decidido no Dashboard — ver a nota lá sobre
   * quando isso vale e por quê.
   */
  usarColunas2: boolean;
  /** Base já recortada pelos filtros universais do cabeçalho. */
  financial: FinancialRow[];
  membership: MembershipRow[];
  metaAnualPorUnidade: Record<string, number>;
  metaAnualTotalGeral: number;
  /** Saldo por centro de resultado, já recortado pela unidade. Pode vir vazio. */
  saldo: SaldoRow[];
  // Valores dos filtros universais que a seção ainda precisa conhecer: o ano e
  // os meses para buscar membresia, as unidades para somar a meta anual delas.
  ano: number;
  unidadesSel: string[]; // vazio = todas (Total Geral)
  mesesSel: number[]; // vazio = todos
}

const BLUE = "#2E9BC7"; // entradas / crédito e barras que batem a meta
const VERMELHO = "#E7524B"; // despesas / débito
const AZUL_CLARO = "#84CDDF"; // barras abaixo da meta
const GRID = "rgba(255,255,255,.085)";
const EIXO = "#9AA6B6";

/* O mesmo vermelho da linha de meta do Gráfico 1 da Seção 2. */
const VERMELHO_META = "#FF5C57";

/* Mesma curva e o mesmo compasso das trocas de seção do SectionDeck: sai rápido,
   chega devagar — é o que dá a sensação de peso de um app abrindo. */
const CURVA = "cubic-bezier(0.22, 1, 0.36, 1)";
const DUR_ABRIR = 620;
const TRANSICAO_CAIXA = (["top", "left", "width", "height"] as const)
  .map((p) => `${p} ${DUR_ABRIR}ms ${CURVA}`)
  .join(", ");

/** Os dois gráficos da linha de baixo, que podem tomar a área inteira. */
type PainelId = "totais" | "meta";
interface Caixa {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Caixa do tooltip: título e uma linha por valor. */
function CaixaTooltip({
  titulo,
  linhas,
}: {
  titulo: string;
  linhas: Array<{ cor: string; nome: string; valor: number }>;
}) {
  return (
    <div className="rounded-lg border border-white/[.16] bg-[#161A21] px-3 py-2 text-xs shadow-panel-lg">
      <p className="mb-1.5 font-semibold text-[#F6F8FB]">{titulo}</p>
      <div className="space-y-1">
        {linhas.map((l, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: l.cor }} />
            <span className="text-ink-2">{l.nome}:</span>
            <span className="font-medium text-ink tabular-nums">{fmtBRL(l.valor)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <CaixaTooltip
      titulo={label}
      linhas={payload.map((p: any) => ({
        cor: p.color || p.fill,
        nome: p.name,
        valor: p.value,
      }))}
    />
  );
}

/**
 * Saldo por centro de resultado: a abertura do exercício e o saldo de agora.
 *
 * Duas linhas em vez de um número só porque o valor sozinho não diz nada — é a
 * distância entre eles que informa. O card responde apenas ao filtro de unidade;
 * ver a nota em Dashboard.tsx sobre por que mês e natureza não se aplicam a um
 * saldo acumulado.
 */
function CardSaldo({ saldo }: { saldo: SaldoRow[] }) {
  const { abertura, atual, temAtual } = useMemo(() => {
    let soma = 0;
    let achouAtual = false;
    // Competências somadas por mês: a base traz uma linha por centro de resultado.
    const porMes = new Map<string, { ano: number; mes: number; soma: number }>();

    for (const r of saldo) {
      if (r.quando === "atual") {
        soma += r.saldo;
        achouAtual = true;
        continue;
      }
      if (!r.quando) continue;
      const k = `${r.quando.ano}-${r.quando.mes}`;
      const cur = porMes.get(k);
      if (cur) cur.soma += r.saldo;
      else porMes.set(k, { ...r.quando, soma: r.saldo });
    }

    /*
     * A abertura é a competência mais antiga da base, não um "janeiro" fixo:
     * assim o card acompanha a virada do ano sem ninguém ter de editar código.
     */
    const primeira =
      Array.from(porMes.values()).sort((a, b) => a.ano - b.ano || a.mes - b.mes)[0] ?? null;

    return { abertura: primeira, atual: soma, temAtual: achouAtual };
  }, [saldo]);

  /*
   * O rótulo fica preso à esquerda e o número é centrado no card — o mesmo eixo
   * em que os valores dos outros cards da seção se alinham. O rótulo sai do
   * fluxo justamente para não deslocar esse centro: se os dois dividissem a
   * linha, "Jan/26" e "Atual" — de larguras diferentes — empurrariam cada
   * número para um ponto distinto.
   */
  const Linha = ({ rotulo, valor }: { rotulo: string; valor: number }) => (
    <div className="relative">
      <span className="absolute inset-y-0 left-0 flex items-center text-[13px] text-ink-2">
        {rotulo}
      </span>
      <p className="text-center text-[17px] font-semibold leading-tight tabular-nums text-ink">
        {fmtBRL(valor)}
      </p>
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className="flex shrink-0 flex-col items-center gap-2.5 rounded-[10px] border border-line-soft bg-panel px-5 py-4 shadow-panel transition-colors hover:border-line-strong"
    >
      <Scale className="h-6 w-6 text-pos" />
      <span className="text-[15px] font-medium leading-tight tracking-tight text-ink-2">
        Saldo Centro de Resultado
      </span>

      {saldo.length === 0 ? (
        <p className="pb-1 text-center text-[12.5px] leading-snug text-ink-3">
          Base de saldo não carregada.
          <br />
          Envie o Arquivo 3 na tela anterior.
        </p>
      ) : (
        <div className="w-full space-y-1">
          {abertura && (
            <Linha
              rotulo={`${MESES[abertura.mes - 1]}/${String(abertura.ano).slice(-2)}`}
              valor={abertura.soma}
            />
          )}
          {temAtual && <Linha rotulo="Atual" valor={atual} />}
        </div>
      )}
    </motion.div>
  );
}

/** Botão de expandir/recolher, no canto superior direito de um painel. */
function BotaoExpandir({ aberto, onClick }: { aberto: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={aberto ? "Recolher gráfico" : "Expandir gráfico"}
      title={aberto ? "Recolher (Esc)" : "Expandir"}
      className="grid h-8 w-8 shrink-0 place-content-center rounded-lg border border-line-strong bg-panel-2 text-ink-2 transition hover:border-acc hover:text-ink active:scale-95"
    >
      {aberto ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
    </button>
  );
}

/**
 * Casca absoluta de um painel expansível: ocupa a caixa que lhe passam e anima
 * até a próxima. O conteúdo só monta depois da primeira medida — o
 * ResponsiveContainer se ancora no tamanho que encontra ao nascer, e nascer
 * dentro de uma caixa 0x0 o deixaria esperando um segundo aviso do
 * ResizeObserver para desenhar. A medida acontece antes da pintura, então nada
 * pisca.
 */
function Flutuante({
  caixa,
  animar,
  camada,
  innerRef,
  onMouseEnter,
  onMouseLeave,
  children,
}: {
  caixa: Caixa | null;
  animar: boolean;
  /** Empilhamento. Ver `camadaDe`: quem se move fica acima de quem está parado. */
  camada: number;
  innerRef?: React.RefObject<HTMLDivElement | null>;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      ref={innerRef}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: "absolute",
        top: caixa?.top ?? 0,
        left: caixa?.left ?? 0,
        width: caixa?.width ?? 0,
        height: caixa?.height ?? 0,
        zIndex: camada,
        opacity: caixa ? 1 : 0,
        transition: animar ? TRANSICAO_CAIXA : "none",
      }}
    >
      {caixa && children}
    </div>
  );
}

export function Section1Total({
  rotuloTodasUnidades,
  usarColunas2,
  financial,
  membership,
  metaAnualPorUnidade,
  metaAnualTotalGeral,
  saldo,
  ano,
  unidadesSel,
  mesesSel,
}: Props) {
  // Miniatura na trilha não anima: ver nota em secaoAtiva.tsx.
  const animarGraficos = useAnimarGraficos();
  const isAll = unidadesSel.length === 0;
  const mesesAtivos =
    mesesSel.length === 0 ? Array.from({ length: 12 }, (_, i) => i + 1) : mesesSel;

  // Ano, unidade e mês já vieram aplicados do cabeçalho.
  const filtered = financial;

  /*
   * Meta ANUAL do recorte: com todas as unidades é a coluna "Meta Anual Total
   * Geral" da base; com uma seleção, a soma das colunas "Meta Anual <Unidade>"
   * das escolhidas. A mensal é essa anual dividida por 12.
   */
  const metaAnual = useMemo(() => {
    if (isAll) return metaAnualTotalGeral;
    return unidadesSel.reduce((s, u) => s + metaAnualDaUnidade(metaAnualPorUnidade, u), 0);
  }, [metaAnualPorUnidade, metaAnualTotalGeral, unidadesSel.join("|"), isAll]);

  const metaMensal = metaAnual / 12;
  // O card mostra a meta anual como está na base, sem escalar pelo filtro de mês.
  const metaTotal = metaAnual;

  const tituloTotal = isAll ? rotuloTodasUnidades : `Total ${unidadesSel.join(", ")}`;

  // KPIs base
  /*
   * Uma varredura só para tudo o que a seção soma. Eram sete percursos sobre a
   * mesma lista — um por KPI, um por gráfico, um por donut —, cada um relendo
   * do começo ao fim e repetindo o teste de dízimos e ofertas.
   *
   * As colunas de origem são deliberadamente diferentes entre si e ficam como
   * estavam: os totais e os donuts leem "Crédito" (credito1); o gráfico mensal
   * de dízimos lê "Crédito 2" (credito).
   */
  const agregados = useMemo(() => {
    let credito = 0;
    let debito = 0;
    // "Crédito 2" e "Débito 2", somados junto na mesma varredura para os cards
    // da visão consolidada. Ver usarColunas2.
    let credito2 = 0;
    let debito2 = 0;
    let dizimos = 0;
    const eventos = new Set<string>();
    const credPorMes = Array<number>(12).fill(0);
    const debPorMes = Array<number>(12).fill(0);
    const dizPorMes = Array<number>(12).fill(0);
    const canais: Record<string, number> = {
      Gazofilácio: 0,
      PIX: 0,
      "Depósitos Diretos": 0,
      Cartões: 0,
      "In Church": 0,
    };

    for (const r of filtered) {
      const m = r.mes;
      const noAno = m >= 1 && m <= 12;
      credito += r.credito1;
      debito += r.debito1;
      credito2 += r.credito;
      debito2 += r.debito;
      if (noAno) {
        credPorMes[m - 1] += r.credito1;
        debPorMes[m - 1] += r.debito1;
      }
      if (!isDizimosOfertas(r.nat2)) continue;
      dizimos += r.credito1;
      if (r.nroUnico) eventos.add(r.nroUnico);
      if (noAno) dizPorMes[m - 1] += r.credito;
      const c = classifyNat3(r.nat3);
      if (c) canais[c] += r.credito1;
    }

    return {
      credito,
      debito,
      credito2,
      debito2,
      dizimos,
      eventos: eventos.size,
      credPorMes,
      debPorMes,
      dizPorMes,
      canais,
    };
  }, [filtered]);

  /*
   * Receita e Despesa Total: "Crédito 2" / "Débito 2" na visão consolidada do
   * administrador, "Crédito" / "Débito" em todo o resto. Só os dois cards — o
   * gráfico mensal "Entradas x Despesas" e os demais continuam nas colunas de
   * sempre.
   */
  const totalCredito = usarColunas2 ? agregados.credito2 : agregados.credito;
  const totalDebito = usarColunas2 ? agregados.debito2 : agregados.debito;
  // Card "Dízimos e Ofertas": soma da coluna "Crédito" da base, restrita às
  // linhas de dízimos e ofertas — a mesma coluna que os dois donuts leem.
  const totalDizimos = agregados.dizimos;
  const eventosDepositos = agregados.eventos;

  // Membresia (sum across selected months for the selected units) and média
  const { membTotal, membMedia } = useMemo(() => {
    let total = 0;
    let nWith = 0;
    const units = isAll ? ["Total Geral"] : unidadesSel;
    for (const m of mesesAtivos) {
      let mTotal = 0;
      for (const u of units) mTotal += membershipForMonth(membership, u, ano, m);
      total += mTotal;
      if (mTotal > 0) nWith += 1;
    }
    return { membTotal: total, membMedia: nWith > 0 ? Math.round(total / nWith) : 0 };
  }, [membership, isAll, unidadesSel.join("|"), ano, mesesAtivos.join(",")]);

  // Dízimo per Capta (média por mês selecionado) e Taxa de Depositantes
  const perCapta = membTotal > 0 ? Math.trunc((totalDizimos / membTotal) * 100) / 100 : 0;
  const taxaDep = membTotal > 0 ? Math.trunc((eventosDepositos / membTotal) * 100 * 100) / 100 : 0;

  // Monthly entradas Dízimos & Ofertas (by Mês Baixa) — restricted to active months
  const entradasDizimosPorMes = agregados.dizPorMes;

  /*
   * "Entradas Totais x Despesas Totais": soma das colunas "Crédito" e "Débito"
   * da base (credito1 / debito1), sobre todas as linhas do recorte — não só as
   * de dízimos e ofertas, que é o que o gráfico mostrava antes.
   */
  const monthlyTotals = useMemo(
    () =>
      MESES.map((m, i) => ({
        mes: m,
        credito: agregados.credPorMes[i],
        debito: agregados.debPorMes[i],
      })).filter((d) => d.credito > 0 || d.debito > 0),
    [agregados],
  );

  // Dízimos vs Meta (mensal)
  const monthlyDizimosMeta = useMemo(
    () =>
      entradasDizimosPorMes
        .map((v, i) => ({
          mes: MESES[i],
          real: v,
          meta: metaMensal,
          pct: metaMensal > 0 ? (v / metaMensal) * 100 : 0,
        }))
        .filter((d) => d.real > 0),
    [entradasDizimosPorMes, metaMensal],
  );

  /*
   * Donuts. Os dois leem a coluna "Crédito" — os mesmos totais dos KPIs, que a
   * varredura única já apurou: este bloco só dá forma ao que foi somado lá.
   */
  const donutData = useMemo(() => {
    const outros = Math.max(0, agregados.credito - agregados.dizimos);
    const distribuicao = [
      { name: "Dízimos e Ofertas", value: agregados.dizimos },
      { name: "Outros", value: outros },
    ].filter((d) => d.value > 0);
    const dizimos = Object.entries(agregados.canais)
      .map(([name, value]) => ({ name, value }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
    return {
      distribuicao,
      dizimos,
      total: agregados.credito,
      totalDizimos: agregados.dizimos,
    };
  }, [agregados]);

  /* ============ "Entradas Totais x Despesas Totais": abrir e fechar ============
   * O painel sai do fluxo e vive absoluto sobre a área de conteúdo; um vão vazio
   * guarda o lugar dele na grade. Expandir é só trocar a caixa de destino — a
   * transição de top/left/width/height cuida do movimento e o gráfico redesenha
   * junto, crescendo como uma janela que se abre, em vez de dar um salto.
   */
  const areaRef = useRef<HTMLDivElement | null>(null);
  const vaoTotaisRef = useRef<HTMLDivElement | null>(null);
  const vaoMetaRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  // Um de cada vez: dois painéis abertos disputariam a mesma área.
  const [expandido, setExpandido] = useState<PainelId | null>(null);
  /*
   * A transição só existe quando o usuário abre ou fecha. Sem essa trava, a
   * primeira medida (e qualquer remedida do layout) também viraria animação: o
   * painel nasceria de uma caixa 0x0 e levaria 620ms para ocupar a própria vaga,
   * tempo em que o ResponsiveContainer mede zero e não desenha gráfico nenhum.
   */
  const [animar, setAnimar] = useState(false);
  const [geo, setGeo] = useState<{
    totais: Caixa;
    meta: Caixa;
    area: { w: number; h: number };
  } | null>(null);

  useLayoutEffect(() => {
    const area = areaRef.current;
    const vt = vaoTotaisRef.current;
    const vm = vaoMetaRef.current;
    if (!area || !vt || !vm) return;
    /*
     * offsetTop/offsetLeft ignoram o scale que o SectionDeck aplica acima: são
     * coordenadas de layout, que é justamente o sistema em que o posicionamento
     * absoluto trabalha. getBoundingClientRect viria escalado e desalinharia o
     * painel da própria vaga.
     */
    const doVao = (el: HTMLDivElement): Caixa => ({
      top: el.offsetTop,
      left: el.offsetLeft,
      width: el.offsetWidth,
      height: el.offsetHeight,
    });
    const medir = () => {
      setAnimar(false);
      setGeo({
        totais: doVao(vt),
        meta: doVao(vm),
        area: { w: area.clientWidth, h: area.clientHeight },
      });
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(area);
    ro.observe(vt);
    ro.observe(vm);
    return () => ro.disconnect();
  }, []);

  /*
   * Qual painel ainda está em trânsito. Sem isso, o painel que recolhe perde a
   * elevação no instante do clique — `expandido` já é nulo — e atravessa os
   * 620ms de volta por baixo do vizinho, que está parado. Ele precisa continuar
   * por cima até pousar.
   */
  const [emMovimento, setEmMovimento] = useState<PainelId | null>(null);
  const timerMovimento = useRef<ReturnType<typeof setTimeout> | null>(null);

  const marcarMovimento = (id: PainelId | null) => {
    if (timerMovimento.current) clearTimeout(timerMovimento.current);
    setEmMovimento(id);
    if (id) timerMovimento.current = setTimeout(() => setEmMovimento(null), DUR_ABRIR);
  };

  useEffect(() => () => void (timerMovimento.current && clearTimeout(timerMovimento.current)), []);

  const fechar = () => {
    setAnimar(true);
    marcarMovimento(expandido); // quem está saindo segue elevado até pousar
    setExpandido(null);
  };
  const alternar = (id: PainelId) => {
    setAnimar(true);
    marcarMovimento(id);
    setExpandido((v) => (v === id ? null : id));
  };

  /** Aberto por cima de tudo; em trânsito acima do parado; parado no chão. */
  const camadaDe = (id: PainelId) => (expandido === id ? 30 : emMovimento === id ? 25 : 1);

  // Esc fecha, como em qualquer coisa que abre por cima.
  useEffect(() => {
    if (!expandido) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") fechar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expandido]);

  const caixaDe = (id: PainelId): Caixa | null =>
    !geo
      ? null
      : expandido === id
        ? { top: 0, left: 0, width: geo.area.w, height: geo.area.h }
        : geo[id];

  /* ============ Maiores despesas do mês sob o cursor ============
   * Mesmo painel do gráfico "Despesa mensal" da Seção 3, aqui pendurado nas
   * barras de débito. Ancorado logo acima do cartão: assim nunca cobre a barra
   * que está sob o mouse, aberto ou fechado.
   */
  const [hoverMes, setHoverMes] = useState<number | null>(null);
  const [posPainel, setPosPainel] = useState<{ bottom: number; left: number } | null>(null);
  const timerSaida = useRef<ReturnType<typeof setTimeout> | null>(null);

  const agendarSaida = () => {
    if (timerSaida.current) clearTimeout(timerSaida.current);
    timerSaida.current = setTimeout(() => setHoverMes(null), 200);
  };
  const cancelarSaida = () => {
    if (timerSaida.current) {
      clearTimeout(timerSaida.current);
      timerSaida.current = null;
    }
  };

  useEffect(() => {
    if (hoverMes === null || !cardRef.current) {
      setPosPainel(null);
      return;
    }
    const atualizar = () => {
      const r = cardRef.current!.getBoundingClientRect();
      const LARGURA = 560;
      const ALTURA_MAX = 232; // cabeçalho + corpo rolável
      const left = Math.max(8, Math.min(r.right - LARGURA, window.innerWidth - LARGURA - 8));
      /*
       * Preso pela base, 10px acima do topo do cartão: a altura do painel varia
       * com o número de linhas e ancorar por baixo o mantém fora do gráfico sem
       * precisar medi-lo. O piso impede que ele saia pelo topo da tela.
       */
      const bottom = Math.max(
        8,
        Math.min(window.innerHeight - r.top + 10, window.innerHeight - ALTURA_MAX - 8),
      );
      setPosPainel({ bottom, left });
    };
    atualizar();
    window.addEventListener("scroll", atualizar, true);
    window.addEventListener("resize", atualizar);
    return () => {
      window.removeEventListener("scroll", atualizar, true);
      window.removeEventListener("resize", atualizar);
    };
  }, [hoverMes, expandido]);

  const rankingMes = useMemo(() => {
    if (hoverMes === null)
      return [] as { razao: string; nat4: string; projeto: string; soma: number }[];
    const map = new Map<string, { razao: string; nat4: string; projeto: string; soma: number }>();
    for (const r of filtered) {
      if (r.mes !== hoverMes || r.debito1 <= 0) continue;
      const razao = r.razaoSocial || "—";
      const nat4 = r.nat4 || "(sem categoria)";
      const projeto = r.projeto || "<SEM PROJETO>";
      const k = `${razao}|||${nat4}|||${projeto}`;
      const cur = map.get(k);
      if (cur) cur.soma += r.debito1;
      else map.set(k, { razao, nat4, projeto, soma: r.debito1 });
    }
    return Array.from(map.values())
      .sort((a, b) => b.soma - a.soma)
      .slice(0, 30);
  }, [hoverMes, filtered]);

  const rankingMesTotal = useMemo(() => rankingMes.reduce((s, r) => s + r.soma, 0), [rankingMes]);

  return (
    // Layout de tamanho fixo: o SectionDeck escala este quadro inteiro para o
    // palco ou para a miniatura, então aqui só precisamos preencher 1440x840.
    <div className="flex h-full w-full flex-col gap-4 p-6">
      {/* Cabeçalho da seção. Os filtros agora são universais e vivem no topo. */}
      <div className="min-w-0">
        {/*
         * O título nomeia o recorte: "Total Geral" quando o filtro de unidade
         * está em branco ou pegou todas (o cabeçalho reduz "todas" a "nenhuma"),
         * e "Total <unidades>" quando é uma escolha. Truncado com o texto inteiro
         * no title, para uma seleção longa não empurrar a grade para baixo.
         */}
        <h1
          title={tituloTotal}
          className="truncate text-[32px] font-semibold leading-none tracking-tight text-ink"
        >
          {tituloTotal}
        </h1>
        <p className="mt-2 text-[15px] text-ink-2">Entradas Dízimos e Ofertas — {ano}</p>
      </div>

      {/*
       * Uma grade só para as quatro áreas, em vez de duas linhas independentes:
       * assim o donut de cima encosta exatamente na base do bloco de KPIs e o de
       * baixo alinha com os gráficos, sem depender de alturas escritas na mão.
       */}
      <div
        ref={areaRef}
        /*
         * A coluna da direita cresceu de 390 para 440px e passou a atravessar as
         * duas linhas. Ela abriga o saldo e os dois donuts empilhados; a largura
         * extra é o que faz "Depósitos Diretos" caber inteiro na legenda, que
         * antes era truncada.
         */
        className="relative grid min-h-0 flex-1 grid-cols-[1fr_440px] grid-rows-[auto_1fr] gap-4"
      >
        <div className="grid grid-cols-4 grid-rows-2 gap-4">
          <MiniKpi
            icon={<HandCoins />}
            label="Dízimos e Ofertas"
            value={fmtBRL(totalDizimos)}
            delay={0}
          />
          <MiniKpi icon={<Target />} label="Meta de Dízimos" value={fmtBRL(metaTotal)} delay={1} />
          <MiniKpi icon={<Wallet />} label="Receita Total" value={fmtBRL(totalCredito)} delay={2} />
          <MiniKpi
            icon={<TrendingDown />}
            label="Despesa Total"
            value={fmtBRL(totalDebito)}
            iconColor="#FF7A70"
            delay={3}
          />
          <MiniKpi icon={<User />} label="Dízimo per Capta" value={fmtBRL(perCapta)} delay={4} />
          <MiniKpi
            icon={<Users />}
            label="Membresia"
            value={membMedia.toLocaleString("pt-BR")}
            delay={5}
          />
          <MiniKpi
            icon={<Banknote />}
            label="Eventos de Depósitos"
            value={eventosDepositos.toLocaleString("pt-BR")}
            delay={6}
          />
          <MiniKpi
            icon={<Percent />}
            label="Taxa de Depositantes"
            value={
              taxaDep.toLocaleString("pt-BR", {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              }) + "%"
            }
            delay={7}
          />
        </div>

        {/* Coluna da direita: saldo em cima, os dois donuts embaixo. */}
        <div className="row-span-2 flex min-h-0 flex-col gap-4">
          <CardSaldo saldo={saldo} />

          <DonutCard
            title="Distribuição de Dízimos e Ofertas"
            subtitle="Participação por canal"
            data={donutData.dizimos}
            total={donutData.totalDizimos}
            delay={2}
            colors={donutData.dizimos.map((d) => {
              const map: Record<string, string> = {
                PIX: "#0F5F73",
                "Depósitos Diretos": "#2E9BC7",
                Cartões: "#7DD3FC",
                Gazofilácio: "#8C9AAD",
                "In Church": "#4E5A6B",
              };
              return map[d.name] ?? "#8b5cf6";
            })}
          />

          <DonutCard
            title="Distribuição das Receitas"
            subtitle="Dízimos e Ofertas vs. demais receitas"
            data={donutData.distribuicao}
            total={donutData.total}
            delay={4}
            colors={["#2E9BC7", "#4E5A6B"]}
          />
        </div>

        {/*
         * Vagas dos dois gráficos expansíveis. Eles vivem fora do fluxo,
         * absolutos sobre a área inteira, e estes vãos vazios seguram o lugar
         * deles na grade para que nada se espalhe quando um abre.
         */}
        <div className="grid min-h-0 grid-cols-2 gap-4">
          <div ref={vaoTotaisRef} className="min-h-0 min-w-0" aria-hidden />
          <div ref={vaoMetaRef} className="min-h-0 min-w-0" aria-hidden />
        </div>

        {/*
         * Véu: o resto da seção recua enquanto o gráfico está aberto. Clicar nele
         * fecha, como tocar fora de uma janela.
         */}
        <div
          onClick={fechar}
          className="absolute inset-0 rounded-[10px] bg-void/70 backdrop-blur-[2px]"
          style={{
            zIndex: 20,
            opacity: expandido ? 1 : 0,
            pointerEvents: expandido ? "auto" : "none",
            transition: `opacity ${expandido ? 420 : 300}ms ${CURVA}`,
          }}
        />

        {/* Entradas x Despesas — absoluto sobre a área de conteúdo. */}
        <Flutuante
          caixa={caixaDe("totais")}
          animar={animar}
          camada={camadaDe("totais")}
          innerRef={cardRef}
          onMouseEnter={cancelarSaida}
          onMouseLeave={agendarSaida}
        >
          <Painel
            titulo="Entradas Totais x Despesas Totais"
            legenda="Crédito e débito mensais"
            delay={6}
            className="h-full"
            acao={
              <BotaoExpandir aberto={expandido === "totais"} onClick={() => alternar("totais")} />
            }
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyTotals} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis
                  dataKey="mes"
                  tick={{ fontSize: 11, fill: EIXO }}
                  axisLine={{ stroke: "rgba(255,255,255,.22)" }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: EIXO }}
                  tickFormatter={BRLcompact}
                  width={72}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,.05)" }} />
                <Legend wrapperStyle={{ fontSize: 11, color: EIXO }} iconSize={8} />
                <Bar
                  dataKey="credito"
                  name="Crédito"
                  fill={BLUE}
                  radius={[6, 6, 0, 0]}
                  animationDuration={800}
                  isAnimationActive={animarGraficos}
                />
                <Bar
                  dataKey="debito"
                  name="Débito"
                  fill={VERMELHO}
                  radius={[6, 6, 0, 0]}
                  animationDuration={900}
                  isAnimationActive={animarGraficos}
                  cursor="pointer"
                  // Só as barras de despesa abrem o ranking do mês.
                  onMouseOver={(d: any) => {
                    cancelarSaida();
                    const i = MESES.indexOf(d?.mes);
                    setHoverMes(i >= 0 ? i + 1 : null);
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          </Painel>
        </Flutuante>

        {/* Dízimos e Ofertas vs. Meta — mesma mecânica de expansão. */}
        <Flutuante caixa={caixaDe("meta")} animar={animar} camada={camadaDe("meta")}>
          <Painel
            titulo="Dízimos e Ofertas vs. Meta"
            legenda="Dízimos e ofertas mensais vs. meta mensal"
            delay={7}
            className="h-full"
            acao={<BotaoExpandir aberto={expandido === "meta"} onClick={() => alternar("meta")} />}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={monthlyDizimosMeta}
                margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis
                  dataKey="mes"
                  tick={{ fontSize: 11, fill: EIXO }}
                  axisLine={{ stroke: "rgba(255,255,255,.22)" }}
                  tickLine={false}
                />
                {/*
                 * O topo do eixo tem de caber a meta. Enquanto ela era uma série,
                 * o eixo a enxergava sozinho; agora é só uma régua desenhada por
                 * cima, e sem este domínio ela seria recortada para fora do
                 * gráfico sempre que o realizado ficasse abaixo dela — que é
                 * justamente quando olhar para a meta importa.
                 */}
                <YAxis
                  tick={{ fontSize: 11, fill: EIXO }}
                  tickFormatter={BRLcompact}
                  width={72}
                  axisLine={false}
                  tickLine={false}
                  domain={[0, (dataMax: number) => Math.max(dataMax, metaMensal) * 1.05]}
                />
                {/*
                 * A meta entra no tooltip pela mão: ela não é mais uma série do
                 * gráfico, e sim a régua desenhada pela ReferenceLine abaixo.
                 */}
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,.05)" }}
                  content={({ active, payload, label }: any) =>
                    active && payload?.length ? (
                      <CaixaTooltip
                        titulo={label}
                        linhas={[
                          {
                            cor: payload[0].payload.pct >= 100 ? BLUE : AZUL_CLARO,
                            nome: "Real",
                            valor: payload[0].value,
                          },
                          { cor: VERMELHO_META, nome: "Meta", valor: metaMensal },
                        ]}
                      />
                    ) : null
                  }
                />
                {/*
                 * Legenda escrita à mão: a meta deixou de ser série e some da
                 * legenda automática. O `payload` de cada entrada não é enfeite —
                 * é de lá que a legenda lê o tracejado ao desenhar a linha.
                 */}
                <Legend
                  wrapperStyle={{ fontSize: 11, color: EIXO }}
                  iconSize={8}
                  payload={[
                    {
                      value: "Real",
                      type: "rect",
                      id: "real",
                      color: BLUE,
                      payload: { strokeDasharray: "" },
                    },
                    {
                      value: "Meta",
                      type: "plainline",
                      id: "meta",
                      color: VERMELHO_META,
                      payload: { strokeDasharray: "6 4" },
                    },
                  ]}
                />
                <Bar
                  dataKey="real"
                  name="Real"
                  radius={[6, 6, 0, 0]}
                  animationDuration={900}
                  isAnimationActive={animarGraficos}
                >
                  {monthlyDizimosMeta.map((d, i) => (
                    <Cell key={i} fill={d.pct >= 100 ? BLUE : AZUL_CLARO} />
                  ))}
                </Bar>
                {/*
                 * Régua, não série. Como Line, a meta nascia no centro da célula
                 * de janeiro e morria no centro da última — sobrava meia coluna
                 * vazia de cada lado. A ReferenceLine atravessa a área plotada
                 * inteira, de extremidade a extremidade, como as barras.
                 * extendDomain porque, sem a série, o eixo Y não conhecia mais a
                 * meta e a régua poderia cair fora do gráfico.
                 */}
                <ReferenceLine
                  y={metaMensal}
                  ifOverflow="extendDomain"
                  stroke={VERMELHO_META}
                  strokeWidth={2}
                  strokeDasharray="6 4"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </Painel>
        </Flutuante>
      </div>

      {hoverMes !== null &&
        posPainel &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            style={{
              position: "fixed",
              bottom: posPainel.bottom,
              left: posPainel.left,
              width: 560,
              zIndex: 60,
              pointerEvents: "auto",
            }}
            onMouseEnter={cancelarSaida}
            onMouseLeave={agendarSaida}
            className="overflow-hidden rounded-lg border border-line-soft bg-panel text-xs shadow-panel-lg"
          >
            <div className="flex items-center justify-between border-b border-line-strong bg-th px-4 py-2.5 text-ink">
              <p className="truncate font-semibold">Maiores despesas {MESES[hoverMes - 1]}</p>
              <p className="ml-3 font-semibold whitespace-nowrap text-orange-300">
                Despesa total = {fmtBRL(rankingMesTotal)}
              </p>
            </div>
            <div className="max-h-[180px] overflow-y-auto">
              <table className="w-full">
                <thead className="sticky top-0 z-10 bg-panel">
                  <tr className="border-b border-line-soft text-ink-2">
                    <th className="px-3 py-2 text-left font-semibold">Razão Social Parceiro</th>
                    <th className="px-3 py-2 text-left font-semibold">Descrição Nat. 4º Nível</th>
                    <th className="px-3 py-2 text-left font-semibold">Nome Projeto</th>
                    <th className="px-3 py-2 text-right font-semibold">Soma de Débito</th>
                  </tr>
                </thead>
                <tbody>
                  {rankingMes.map((t, i) => (
                    <tr key={i} className="border-b border-line-soft last:border-0">
                      <td className="px-3 py-1.5 text-ink">{t.razao}</td>
                      <td className="px-3 py-1.5 text-ink-2">{t.nat4}</td>
                      <td className="px-3 py-1.5 text-ink-2">{t.projeto}</td>
                      <td className="px-3 py-1.5 text-right font-medium tabular-nums text-ink">
                        {fmtBRL(t.soma)}
                      </td>
                    </tr>
                  ))}
                  {rankingMes.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-3 text-center text-ink-3">
                        Sem registros
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

/* Casca de gráfico: título, legenda e a área que sobra para o desenho. */
function Painel({
  titulo,
  legenda,
  delay,
  acao,
  className,
  children,
}: {
  titulo: string;
  legenda: string;
  delay: number;
  /** Controle opcional no canto superior direito (ex.: expandir). */
  acao?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: delay * 0.05 }}
      className={`flex min-h-0 min-w-0 flex-col rounded-[10px] border border-line-soft bg-panel p-5 shadow-panel ${className ?? ""}`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-ink">{titulo}</h3>
          <p className="mt-0.5 text-[12.5px] text-ink-2">{legenda}</p>
        </div>
        {acao}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </motion.div>
  );
}

function MiniKpi({
  icon,
  label,
  value,
  iconColor,
  delay,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  iconColor?: string;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: delay * 0.05 }}
      className="flex min-h-0 flex-col items-center justify-center gap-3 rounded-[10px] border border-line-soft bg-panel px-4 py-5 text-center shadow-panel transition-colors hover:border-line-strong"
    >
      <span className="[&>svg]:h-6 [&>svg]:w-6" style={{ color: iconColor ?? "#6D9BFF" }}>
        {icon}
      </span>
      <span className="text-[15px] font-medium leading-tight tracking-tight text-ink-2">
        {label}
      </span>
      <p className="w-full truncate text-[21px] font-semibold leading-tight tabular-nums text-ink">
        {value}
      </p>
    </motion.div>
  );
}

function DonutCard({
  title,
  subtitle,
  data,
  total,
  delay,
  colors,
}: {
  title: string;
  subtitle: string;
  data: Array<{ name: string; value: number }>;
  total: number;
  delay: number;
  colors: string[];
}) {
  const palette = colors;
  // Lê o contexto por conta própria: é um componente à parte da seção.
  const animarGraficos = useAnimarGraficos();
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: delay * 0.06 }}
      // flex-1: os dois donuts dividem o que sobra da coluna abaixo do saldo.
      // Sem isso ficavam na altura natural e deixavam um vão morto no pé.
      className="flex min-h-0 flex-1 flex-col rounded-[10px] border border-line-soft bg-panel p-5 shadow-panel"
    >
      <div className="mb-2">
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
        <p className="text-[12.5px] text-ink-2">{subtitle}</p>
      </div>
      <div className="flex min-h-0 flex-1 items-center gap-4">
        <div className="aspect-square h-full max-h-[230px] shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius="58%"
                outerRadius="88%"
                paddingAngle={2}
                stroke="none"
                animationDuration={900}
                isAnimationActive={animarGraficos}
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={palette[i % palette.length]} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }: any) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0];
                  const pct = total > 0 ? ((d.value as number) / total) * 100 : 0;
                  return (
                    <div className="rounded-lg border border-white/[.16] bg-[#161A21] px-3 py-2 text-xs shadow-panel-lg">
                      <p className="font-semibold text-[#F6F8FB]">{d.name}</p>
                      <p className="text-ink tabular-nums">{fmtBRL(d.value as number)}</p>
                      <p className="text-ink-2">{fmtPct(pct)} do total</p>
                    </div>
                  );
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex-1 min-w-0 space-y-1.5">
          {data.map((d, i) => {
            const pct = total > 0 ? (d.value / total) * 100 : 0;
            return (
              <div key={d.name} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ background: palette[i % palette.length] }}
                  />
                  <span className="text-xs font-medium text-ink-2 truncate">{d.name}</span>
                </div>
                <span className="text-xs text-ink-3 tabular-nums">{fmtPct(pct)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
