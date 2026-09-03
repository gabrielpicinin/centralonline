import { useMemo, useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LabelList,
  Cell,
} from "recharts";
import { motion } from "framer-motion";
import { BRLcompact, fmtBRL, MESES } from "@/lib/format";
import { norm, type FinancialRow } from "@/lib/parsers";
import { useAnimarGraficos } from "./secaoAtiva";

interface Props {
  /** Base já recortada pelos filtros universais do cabeçalho. */
  financial: FinancialRow[];
}

const ORANGE = "#e76f51";
const ORANGE_FADED = "#f5c4b6";

function fadeIn(delay = 0) {
  return {
    initial: { opacity: 0, y: 16 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true },
    transition: { duration: 0.45, delay: delay * 0.06 },
  } as const;
}

export function Section2Despesas({ financial }: Props) {
  /*
   * Ano, unidade, mês, natureza, projeto e meta já vieram aplicados do
   * cabeçalho. Aqui só resta o recorte que é da seção: linhas de despesa.
   */
  const base = useMemo(() => financial.filter((r) => r.debito1 > 0), [financial]);
  // Miniatura na trilha não anima: ver nota em secaoAtiva.tsx.
  const animarGraficos = useAnimarGraficos();

  // Cross-filter selections (chart interaction)
  const [selNat3, setSelNat3] = useState<string | null>(null);
  const [selNat4, setSelNat4] = useState<string | null>(null);
  const [selMes, setSelMes] = useState<number | null>(null);

  const toggle = <T,>(cur: T | null, v: T, set: (x: T | null) => void) => set(cur === v ? null : v);

  const applyFilters = (
    rows: FinancialRow[],
    opts: { skipNat3?: boolean; skipNat4?: boolean; skipMes?: boolean },
  ) =>
    rows.filter((r) => {
      if (!opts.skipNat3 && selNat3 !== null && norm(r.nat3) !== norm(selNat3)) return false;
      if (!opts.skipNat4 && selNat4 !== null && norm(r.nat4) !== norm(selNat4)) return false;
      if (!opts.skipMes && selMes !== null && r.mes !== selMes) return false;
      return true;
    });

  const nat3Data = useMemo(() => {
    const rows = applyFilters(base, { skipNat3: true });
    const map = new Map<string, number>();
    for (const r of rows) {
      const k = r.nat3 || "(sem categoria)";
      map.set(k, (map.get(k) ?? 0) + r.debito1);
    }
    return Array.from(map, ([name, value]) => ({ name, value }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [base, selNat4, selMes]);

  const nat4Data = useMemo(() => {
    const rows = applyFilters(base, { skipNat4: true });
    const map = new Map<string, number>();
    for (const r of rows) {
      const k = r.nat4 || "(sem categoria)";
      map.set(k, (map.get(k) ?? 0) + r.debito1);
    }
    return Array.from(map, ([name, value]) => ({ name, value }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [base, selNat3, selMes]);

  // Rows used to compute the ranking table inside the nat4 hover tooltip.
  // Honor other cross-filter selections (selNat3 / selMes), but NOT the nat4 selection.
  const nat4ContextRows = useMemo(
    () => applyFilters(base, { skipNat4: true }),
    [base, selNat3, selMes],
  );

  const mesData = useMemo(() => {
    const rows = applyFilters(base, { skipMes: true });
    const map = new Map<number, number>();
    for (const r of rows) {
      if (!r.mes) continue;
      map.set(r.mes, (map.get(r.mes) ?? 0) + r.debito1);
    }
    return Array.from({ length: 12 }, (_, i) => i + 1)
      .map((m) => ({ mes: m, name: MESES[m - 1], value: map.get(m) ?? 0 }))
      .filter((d) => d.value > 0);
  }, [base, selNat3, selNat4]);

  const suffixFor = (target: "nat3" | "nat4" | "mes") => {
    const parts: string[] = [];
    if (target !== "nat3" && selNat3) parts.push(selNat3);
    if (target !== "nat4" && selNat4) parts.push(selNat4);
    if (target !== "mes" && selMes) parts.push(MESES[selMes - 1]);
    return parts.length ? ` com ${parts.join(" / ")}` : "";
  };

  // Default tooltip (nat3, mensal)
  const Tip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0];
    return (
      <div className="rounded-lg border border-white/[.16] bg-[#161A21] px-3 py-2 shadow-lg text-xs">
        <p className="font-semibold text-ink mb-1">{label ?? d.payload?.name}</p>
        <p className="text-ink-2">{fmtBRL(d.value as number)}</p>
      </div>
    );
  };

  // Hover ranking table for the nat4 chart
  const Nat4RankingTip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const name = payload[0].payload?.name as string;
    const total = payload[0].value as number;
    const rows = nat4ContextRows.filter((r) => (r.nat4 || "(sem categoria)") === name);

    // group by (razaoSocial, nat4, projeto) summing debito
    const map = new Map<string, { razao: string; nat4: string; projeto: string; soma: number }>();
    for (const r of rows) {
      const razao = r.razaoSocial || "—";
      const projeto = r.projeto || "<SEM PROJETO>";
      const k = `${razao}|||${name}|||${projeto}`;
      const cur = map.get(k);
      if (cur) cur.soma += r.debito1;
      else map.set(k, { razao, nat4: name, projeto, soma: r.debito1 });
    }
    const top = Array.from(map.values())
      .sort((a, b) => b.soma - a.soma)
      .slice(0, 5);

    return (
      <div className="rounded-lg border border-line-soft bg-panel shadow-xl text-xs overflow-hidden min-w-[520px]">
        <div className="flex items-center justify-between px-4 py-2.5 bg-th text-ink border-b border-line-strong">
          <p className="font-semibold">Maiores despesas {name}</p>
          <p className="text-orange-300 font-semibold">Despesa total = {fmtBRL(total)}</p>
        </div>
        <table className="w-full">
          <thead>
            <tr className="text-ink-2 border-b border-line-soft">
              <th className="text-left font-semibold px-3 py-2">Razão Social Parceiro</th>
              <th className="text-left font-semibold px-3 py-2">Descrição Nat. 4º Nível</th>
              <th className="text-left font-semibold px-3 py-2">Nome Projeto</th>
              <th className="text-right font-semibold px-3 py-2">Soma de Débito</th>
            </tr>
          </thead>
          <tbody>
            {top.map((t, i) => (
              <tr key={i} className="border-b border-line-soft last:border-0">
                <td className="px-3 py-1.5 text-ink">{t.razao}</td>
                <td className="px-3 py-1.5 text-ink-2">{t.nat4}</td>
                <td className="px-3 py-1.5 text-ink-2">{t.projeto}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-ink font-medium">
                  {fmtBRL(t.soma)}
                </td>
              </tr>
            ))}
            {top.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-3 text-center text-ink-3">
                  Sem registros
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  };

  // Show 7 bars per viewport; the rest is scrollable
  const VISIBLE_BARS = 7;
  const ROW_H_NAT3 = 40;
  const ROW_H_NAT4 = 40;
  const nat3VisibleH = VISIBLE_BARS * ROW_H_NAT3;
  const nat4VisibleH = VISIBLE_BARS * ROW_H_NAT4;
  const nat3InnerH = Math.max(nat3VisibleH, nat3Data.length * ROW_H_NAT3 + 40);
  const nat4InnerH = Math.max(nat4VisibleH, nat4Data.length * ROW_H_NAT4 + 40);

  // Single-line Y-axis tick with abbreviation (at the END) when text is too long
  const makeYTick = (maxChars: number) => (props: any) => {
    const { x, y, payload } = props;
    let t: string = payload?.value ?? "";
    if (t.length > maxChars) t = t.slice(0, Math.max(1, maxChars - 1)).trimEnd() + "…";
    return (
      <text x={x} y={y} dy={4} textAnchor="end" fontSize={13} fill="#A6B2C2">
        {t}
      </text>
    );
  };
  const YTickNat3 = makeYTick(28);
  const YTickNat4 = makeYTick(26);

  // Hover-driven ranking panel (rendered to document.body, positioned to the left of the chart)
  const [hoverNat4, setHoverNat4] = useState<string | null>(null);
  const nat4CardRef = useRef<HTMLDivElement | null>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleHide = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setHoverNat4(null), 200);
  };
  const cancelHide = () => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };

  useEffect(() => {
    if (!hoverNat4 || !nat4CardRef.current) {
      setPanelPos(null);
      return;
    }
    const update = () => {
      const r = nat4CardRef.current!.getBoundingClientRect();
      const PANEL_W = 560;
      const GAP = 16;
      // Prefer left of chart; if not enough space, place at viewport left edge
      let left = r.left - PANEL_W - GAP;
      if (left < 8) left = 8;
      setPanelPos({ top: r.top, left });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [hoverNat4]);

  const rankingRows = useMemo(() => {
    if (!hoverNat4) return [] as { razao: string; nat4: string; projeto: string; soma: number }[];
    const rows = nat4ContextRows.filter((r) => (r.nat4 || "(sem categoria)") === hoverNat4);
    const map = new Map<string, { razao: string; nat4: string; projeto: string; soma: number }>();
    for (const r of rows) {
      const razao = r.razaoSocial || "—";
      const projeto = r.projeto || "<SEM PROJETO>";
      const k = `${razao}|||${hoverNat4}|||${projeto}`;
      const cur = map.get(k);
      if (cur) cur.soma += r.debito1;
      else map.set(k, { razao, nat4: hoverNat4, projeto, soma: r.debito1 });
    }
    return Array.from(map.values())
      .sort((a, b) => b.soma - a.soma)
      .slice(0, 30);
  }, [hoverNat4, nat4ContextRows]);
  const rankingTotal = useMemo(
    () =>
      nat4Data.find((d) => d.name === hoverNat4)?.value ??
      rankingRows.reduce((s, r) => s + r.soma, 0),
    [hoverNat4, nat4Data, rankingRows],
  );

  /* ---- mesmo painel de ranking, agora para o gráfico de despesa mensal ----
     Ancorado à esquerda do próprio cartão, que fica à direita na linha de baixo:
     o painel cai sobre a área do 4º nível, longe da barra que está sob o cursor. */
  const [hoverMes, setHoverMes] = useState<number | null>(null);
  const mesCardRef = useRef<HTMLDivElement | null>(null);
  const [panelPosMes, setPanelPosMes] = useState<{ top: number; left: number } | null>(null);
  const hideTimerMes = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleHideMes = () => {
    if (hideTimerMes.current) clearTimeout(hideTimerMes.current);
    hideTimerMes.current = setTimeout(() => setHoverMes(null), 200);
  };
  const cancelHideMes = () => {
    if (hideTimerMes.current) {
      clearTimeout(hideTimerMes.current);
      hideTimerMes.current = null;
    }
  };

  useEffect(() => {
    if (!hoverMes || !mesCardRef.current) {
      setPanelPosMes(null);
      return;
    }
    const update = () => {
      const r = mesCardRef.current!.getBoundingClientRect();
      const PANEL_W = 560;
      /*
       * Alinhado pela direita do cartão e abrindo para a esquerda, subindo um
       * pouco acima do topo dele — a posição do anexo. Assim o painel não cobre
       * a barra que está sob o cursor nem sai da tela pela direita.
       */
      const left = Math.max(8, Math.min(r.right - PANEL_W, window.innerWidth - PANEL_W - 8));
      const top = Math.max(8, r.top - 125);
      setPanelPosMes({ top, left });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [hoverMes]);

  // Mesmo escopo que alimenta o gráfico mensal, recortado no mês sob o cursor.
  const mesContextRows = useMemo(
    () => applyFilters(base, { skipMes: true }),
    [base, selNat3, selNat4],
  );

  const rankingMesRows = useMemo(() => {
    if (!hoverMes) return [] as { razao: string; nat4: string; projeto: string; soma: number }[];
    const map = new Map<string, { razao: string; nat4: string; projeto: string; soma: number }>();
    for (const r of mesContextRows) {
      if (r.mes !== hoverMes) continue;
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
  }, [hoverMes, mesContextRows]);

  const rankingMesTotal = useMemo(
    () =>
      mesData.find((d) => d.mes === hoverMes)?.value ??
      rankingMesRows.reduce((s, r) => s + r.soma, 0),
    [hoverMes, mesData, rankingMesRows],
  );

  return (
    // Preenche o quadro de design do deck (1440x840): a linha de filtros tem
    // altura própria e os dois blocos de gráficos dividem o que sobra.
    <div className="flex h-full w-full flex-col gap-4 p-6">
      {/* Top: Naturezas de despesas (nível 3) */}
      <motion.div
        {...fadeIn(0)}
        className="flex min-h-0 flex-1 flex-col rounded-[10px] border border-line-soft bg-panel p-5 shadow-panel transition-colors"
      >
        <div className="mb-3 text-center">
          <h3 className="text-lg font-semibold text-ink">
            Naturezas de despesas (nível 3){suffixFor("nat3")}
          </h3>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div style={{ height: nat3InnerH }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={nat3Data}
                layout="vertical"
                margin={{ top: 5, right: 120, left: 0, bottom: 5 }}
                barCategoryGap={10}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,.085)"
                  horizontal={false}
                />
                <XAxis
                  type="number"
                  tick={{ fontSize: 12, fill: "#9AA6B6" }}
                  tickFormatter={BRLcompact}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={210}
                  tick={<YTickNat3 />}
                  interval={0}
                  tickMargin={10}
                />
                <Tooltip content={<Tip />} cursor={{ fill: "rgba(231,111,81,0.08)" }} />
                <Bar
                  dataKey="value"
                  radius={[0, 4, 4, 0]}
                  barSize={28}
                  onClick={(d: any) => toggle(selNat3, d.name as string, setSelNat3)}
                  cursor="pointer"
                  animationDuration={600}
                  isAnimationActive={animarGraficos}
                >
                  {nat3Data.map((d) => (
                    <Cell
                      key={d.name}
                      fill={selNat3 === null || selNat3 === d.name ? ORANGE : ORANGE_FADED}
                    />
                  ))}
                  <LabelList
                    dataKey="value"
                    position="right"
                    formatter={(v: number) => BRLcompact(v).replace(/\s/g, "\u00A0")}
                    style={{ fontSize: 13, fill: "#E7ECF3", fontWeight: 600 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </motion.div>

      {/* Bottom: Detalhamento (nível 4) + Despesa mensal */}
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-4">
        <motion.div
          ref={nat4CardRef}
          {...fadeIn(1)}
          className="flex min-h-0 flex-col rounded-[10px] border border-line-soft bg-panel p-5 shadow-panel transition-colors"
          onMouseLeave={scheduleHide}
          onMouseEnter={cancelHide}
        >
          <div className="mb-3 text-center">
            <h3 className="text-lg font-semibold text-ink">
              Detalhamento de despesas (4º nível){suffixFor("nat4")}
            </h3>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div style={{ height: nat4InnerH }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={nat4Data}
                  layout="vertical"
                  margin={{ top: 5, right: 130, left: 0, bottom: 5 }}
                  barCategoryGap={10}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(255,255,255,.085)"
                    horizontal={false}
                  />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 12, fill: "#9AA6B6" }}
                    tickFormatter={BRLcompact}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={200}
                    tick={<YTickNat4 />}
                    interval={0}
                    tickMargin={10}
                  />
                  <Tooltip content={() => null} cursor={{ fill: "rgba(231,111,81,0.08)" }} />
                  <Bar
                    dataKey="value"
                    radius={[0, 4, 4, 0]}
                    barSize={26}
                    onClick={(d: any) => toggle(selNat4, d.name as string, setSelNat4)}
                    onMouseOver={(d: any) => {
                      cancelHide();
                      setHoverNat4(d?.name ?? null);
                    }}
                    cursor="pointer"
                    animationDuration={600}
                    isAnimationActive={animarGraficos}
                  >
                    {nat4Data.map((d) => (
                      <Cell
                        key={d.name}
                        fill={selNat4 === null || selNat4 === d.name ? ORANGE : ORANGE_FADED}
                      />
                    ))}
                    <LabelList
                      dataKey="value"
                      position="right"
                      formatter={(v: number) => BRLcompact(v).replace(/\s/g, "\u00A0")}
                      style={{ fontSize: 13, fill: "#E7ECF3", fontWeight: 600 }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </motion.div>

        <motion.div
          ref={mesCardRef}
          {...fadeIn(2)}
          onMouseLeave={scheduleHideMes}
          onMouseEnter={cancelHideMes}
          className="flex min-h-0 flex-col rounded-[10px] border border-line-soft bg-panel p-5 shadow-panel transition-colors"
        >
          <div className="mb-3 text-center">
            <h3 className="text-lg font-semibold text-ink">Despesa mensal{suffixFor("mes")}</h3>
          </div>
          <div className="min-h-0 flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={mesData} margin={{ top: 24, right: 16, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.085)" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#9AA6B6" }} />
                <YAxis
                  tick={{ fontSize: 11, fill: "#9AA6B6" }}
                  tickFormatter={BRLcompact}
                  width={80}
                />
                {/* O ranking substitui o tooltip padrão, como no 4º nível. */}
                <Tooltip content={() => null} cursor={{ fill: "rgba(231,111,81,0.08)" }} />
                <Bar
                  dataKey="value"
                  radius={[6, 6, 0, 0]}
                  onClick={(d: any) => toggle(selMes, d.mes as number, setSelMes)}
                  onMouseOver={(d: any) => {
                    cancelHideMes();
                    setHoverMes(d?.mes ?? null);
                  }}
                  cursor="pointer"
                  animationDuration={700}
                  isAnimationActive={animarGraficos}
                >
                  {mesData.map((d) => (
                    <Cell
                      key={d.mes}
                      fill={selMes === null || selMes === d.mes ? ORANGE : ORANGE_FADED}
                    />
                  ))}
                  <LabelList
                    dataKey="value"
                    position="top"
                    // Compacto (R$ 3,8M) como nos outros gráficos da seção: por
                    // extenso, os rótulos de meses vizinhos se sobrepunham.
                    formatter={(v: number) => BRLcompact(v).replace(/\s/g, " ")}
                    style={{ fontSize: 13, fill: "#E7ECF3", fontWeight: 600 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      </div>

      {hoverNat4 &&
        panelPos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: panelPos.top,
              left: panelPos.left,
              width: 560,
              zIndex: 60,
              pointerEvents: "auto",
            }}
            onMouseEnter={cancelHide}
            onMouseLeave={scheduleHide}
            className="rounded-lg border border-line-soft bg-panel shadow-xl text-xs overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-2.5 bg-th text-ink border-b border-line-strong">
              <p className="font-semibold truncate">Maiores despesas {hoverNat4}</p>
              <p className="text-orange-300 font-semibold whitespace-nowrap ml-3">
                Despesa total = {fmtBRL(rankingTotal)}
              </p>
            </div>
            <div className="max-h-[180px] overflow-y-auto">
              <table className="w-full">
                <thead className="sticky top-0 bg-panel z-10">
                  <tr className="text-ink-2 border-b border-line-soft">
                    <th className="text-left font-semibold px-3 py-2">Razão Social Parceiro</th>
                    <th className="text-left font-semibold px-3 py-2">Descrição Nat. 4º Nível</th>
                    <th className="text-left font-semibold px-3 py-2">Nome Projeto</th>
                    <th className="text-right font-semibold px-3 py-2">Soma de Débito</th>
                  </tr>
                </thead>
                <tbody>
                  {rankingRows.map((t, i) => (
                    <tr key={i} className="border-b border-line-soft last:border-0">
                      <td className="px-3 py-1.5 text-ink">{t.razao}</td>
                      <td className="px-3 py-1.5 text-ink-2">{t.nat4}</td>
                      <td className="px-3 py-1.5 text-ink-2">{t.projeto}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-ink font-medium">
                        {fmtBRL(t.soma)}
                      </td>
                    </tr>
                  ))}
                  {rankingRows.length === 0 && (
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

      {/* Mesmo painel, para o gráfico de despesa mensal. */}
      {hoverMes !== null &&
        panelPosMes &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: panelPosMes.top,
              left: panelPosMes.left,
              width: 560,
              zIndex: 60,
              pointerEvents: "auto",
            }}
            onMouseEnter={cancelHideMes}
            onMouseLeave={scheduleHideMes}
            className="overflow-hidden rounded-lg border border-line-soft bg-panel text-xs shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-line-strong bg-th px-4 py-2.5 text-ink">
              <p className="truncate font-semibold">
                Maiores despesas {MESES[hoverMes - 1]}
                {suffixFor("mes")}
              </p>
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
                  {rankingMesRows.map((t, i) => (
                    <tr key={i} className="border-b border-line-soft last:border-0">
                      <td className="px-3 py-1.5 text-ink">{t.razao}</td>
                      <td className="px-3 py-1.5 text-ink-2">{t.nat4}</td>
                      <td className="px-3 py-1.5 text-ink-2">{t.projeto}</td>
                      <td className="px-3 py-1.5 text-right font-medium tabular-nums text-ink">
                        {fmtBRL(t.soma)}
                      </td>
                    </tr>
                  ))}
                  {rankingMesRows.length === 0 && (
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
