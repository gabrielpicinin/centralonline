import { useEffect, useMemo, useRef, useState } from "react";
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
  Legend,
} from "recharts";
import { motion } from "framer-motion";
import { fmtBRL } from "@/lib/format";
import { norm, type FinancialRow } from "@/lib/parsers";
import { useAnimarGraficos } from "./secaoAtiva";

interface Props {
  /** Base já recortada pelos filtros universais do cabeçalho. */
  financial: FinancialRow[];
  /**
   * Total de Dízimos e Ofertas do mesmo período e unidade, lido da coluna
   * "Crédito". Denominador da aba "Relação entre Dízimos e Ofertas". Vem pronto
   * do Dashboard porque precisa escapar dos filtros de Meta e Projeto — ver a
   * nota lá.
   */
  dizimosOfertas: number;
}

/*
 * Naturezas que viram uma coluna só no eixo. Separadas, são fatias pequenas que
 * poluem o gráfico sem dizer muito; juntas, cabem numa barra. A repartição
 * continua à mão no tooltip da coluna e na coluna "Identificação" do painel de
 * maiores despesas.
 */
interface Grupo {
  /** Rótulo no eixo. Pode repetir o nome de uma das partes, como "Custeio". */
  nome: string;
  partes: string[];
  /**
   * Meta do grupo. Sem valor aqui, é a soma das metas das partes — que é o certo
   * quando a fusão não muda o alvo (Custeio já valia 12% e Outras Despesas, 0%).
   * Investimentos precisa do valor explícito: as três partes valiam 0% cada,
   * mas o grupo responde por 9%.
   */
  metaPropria?: number;
}

const GRUPOS: Grupo[] = [
  {
    nome: "Investimentos em Ativos",
    partes: ["Investimentos Central", "Ativos Imobilizados", "Investimento em Terceiros"],
    metaPropria: 9,
  },
  {
    nome: "Custeio",
    partes: ["Custeio", "Outras Despesas"],
  },
];

const grupoChamado = (nome: string) => GRUPOS.find((g) => norm(g.nome) === norm(nome));

/** Naturezas absorvidas por algum grupo — saem do eixo como colunas próprias. */
const PARTES_AGRUPADAS = new Set(GRUPOS.flatMap((g) => g.partes).map(norm));

const META_TARGETS: { name: string; target: number }[] = [
  { name: "Pastores e Obreiros", target: 17 },
  { name: "Central Missionária", target: 16 },
  { name: "Pessoal", target: 13 },
  { name: "Custeio", target: 12 },
  { name: "Assistência Social", target: 10 },
  { name: "Ativos Imobilizados", target: 0 },
  { name: "Células", target: 4 },
  { name: "Ministérios", target: 4 },
  { name: "Investimento em Terceiros", target: 0 },
  { name: "Investimentos Central", target: 0 },
  { name: "Outras Despesas", target: 0 },
  { name: "Outras Empresas", target: 0 },
];

/*
 * Colunas que ganham a aba "Relação entre Dízimos e Ofertas" no tooltip.
 *
 * Só estas duas por escolha do financeiro: são as que ele acompanha contra a
 * arrecadação, e não contra o gasto total. Nenhuma delas é coluna agrupada,
 * então a aba nunca disputa espaço com a de "Composição" — uma coluna mostra
 * uma ou outra, nunca as duas.
 */
const RELACAO_DIZIMOS = new Set(["Pastores e Obreiros", "Pessoal"].map(norm));

/* Cor das colunas de Meta no gráfico. Separa a Meta do laranja do Realizado
   por matiz, e não só por tom — o que sobrevive a uma impressão em preto e
   branco e a quem enxerga cor de forma diferente. */
const AZUL_META = "#2E9BC7";

/* O traço da meta nas réguas do tooltip NÃO usa a cor das colunas, e isso é
   deliberado: a régua "sobre dízimos" já é #2E9BC7, e um traço do mesmo tom
   desapareceria dentro dela justamente quando o realizado passa da meta — o
   caso que mais importa enxergar. Fica no azul claro da paleta, que é a única
   das duas cores que se lê sobre as duas barras. */
const TRACO_META = "#84CDDF";
const ORANGE = "#e76f51";
/* Segunda régua da aba: o realizado medido contra a arrecadação. É o mesmo azul
   que a Seção 1 usa para as entradas de crédito — e não por acaso, já que são
   exatamente essas entradas que estão no denominador aqui. A cor faz a ponte
   entre as duas telas. */
const AZUL_DIZIMOS = "#2E9BC7";
/* Tons do laranja do "Realizado": a barra de um grupo repartida entre as partes.
   Só um grupo é exibido por vez, então a mesma escala serve para todos. */
const TONS_GRUPO = ["#e76f51", "#f0a58f", "#f8d3c6"];

/** Uma natureza dentro do grupo que a absorveu. */
interface ParteDoGrupo {
  name: string;
  realizado: number;
  abs: number;
  /** Peso dentro do grupo — é o que a barra repartida do tooltip desenha. */
  fatia: number;
  cor: string;
}

const MultiLineTick = (props: any) => {
  const { x, y, payload } = props;
  const text: string = payload.value ?? "";
  const words = text.split(" ");
  let lines: string[] = [text];
  if (text.length > 12 && words.length > 1) {
    const mid = Math.ceil(words.length / 2);
    lines = [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
  }
  return (
    <g transform={`translate(${x},${y + 10})`}>
      {lines.map((ln, i) => (
        <text key={i} x={0} y={i * 15} textAnchor="middle" fontSize={13} fill="#E7ECF3">
          {ln}
        </text>
      ))}
    </g>
  );
};

export function Section3Metas({ financial, dizimosOfertas }: Props) {
  // Unidade e mês já vieram aplicados do cabeçalho; resta o recorte da seção.
  const filtered = useMemo(() => financial.filter((r) => r.debito1 > 0), [financial]);
  // Miniatura na trilha não anima: ver nota em secaoAtiva.tsx.
  const animarGraficos = useAnimarGraficos();

  /*
   * Total, somas por meta e grafia de cada nome numa varredura só. Eram três
   * percursos sobre a mesma lista, dois deles normalizando a coluna Meta linha
   * a linha para chegar exatamente à mesma chave.
   */
  const { totalDebito, sumByMeta, displayName } = useMemo(() => {
    let total = 0;
    const somas = new Map<string, number>();
    const nomes = new Map<string, string>();
    for (const r of filtered) {
      total += r.debito1;
      const k = norm(r.meta);
      if (!k) continue;
      somas.set(k, (somas.get(k) ?? 0) + r.debito1);
      if (!nomes.has(k)) nomes.set(k, r.meta);
    }
    return { totalDebito: total, sumByMeta: somas, displayName: nomes };
  }, [filtered]);

  const data = useMemo(() => {
    // Cópia: as metas fixas entram só nesta conta, sem sujar o Map memoizado.
    const nomes = new Map(displayName);
    for (const t of META_TARGETS) {
      const k = norm(t.name);
      if (!nomes.has(k)) nomes.set(k, t.name);
    }

    const targetMap = new Map(META_TARGETS.map((t) => [norm(t.name), t.target]));

    const todas = Array.from(nomes.entries()).map(([k, name]) => {
      const realizadoAbs = sumByMeta.get(k) ?? 0;
      const realizadoPct = totalDebito > 0 ? (realizadoAbs / totalDebito) * 100 : 0;
      const target = targetMap.get(k) ?? 0;
      return { name, meta: target, realizado: realizadoPct, abs: realizadoAbs };
    });

    // As naturezas absorvidas somem do eixo; cada grupo entra no lugar delas.
    const rows = todas.filter((r) => !PARTES_AGRUPADAS.has(norm(r.name)));
    const composicaoPorGrupo = new Map<string, ParteDoGrupo[]>();

    for (const g of GRUPOS) {
      const partes = todas.filter((r) => g.partes.some((p) => norm(p) === norm(r.name)));
      if (!partes.length) continue;

      const somaPct = partes.reduce((s, p) => s + p.realizado, 0);
      const somaAbs = partes.reduce((s, p) => s + p.abs, 0);
      const meta = g.metaPropria ?? partes.reduce((s, p) => s + p.meta, 0);
      rows.push({ name: g.nome, meta, realizado: somaPct, abs: somaAbs });

      /*
       * A cor sai daqui e é a mesma em toda parte: nas fatias do mini gráfico do
       * tooltip e nas bolinhas da coluna "Identificação" do painel de despesas.
       * Uma origem só evita que as duas leituras discordem sobre quem é quem.
       */
      composicaoPorGrupo.set(
        norm(g.nome),
        partes
          .slice()
          .sort((a, b) => b.realizado - a.realizado)
          .map((p, i) => ({
            name: p.name,
            realizado: p.realizado,
            abs: p.abs,
            fatia: somaPct > 0 ? (p.realizado / somaPct) * 100 : 0,
            cor: TONS_GRUPO[i % TONS_GRUPO.length],
          })),
      );
    }

    rows.sort((a, b) => {
      if (a.meta > 0 && b.meta === 0) return -1;
      if (a.meta === 0 && b.meta > 0) return 1;
      if (a.meta !== b.meta) return b.meta - a.meta;
      return b.realizado - a.realizado;
    });

    return { rows, composicaoPorGrupo };
  }, [displayName, sumByMeta, totalDebito]);

  const { rows: dataRows, composicaoPorGrupo } = data;

  /*
   * Soma das metas que o gráfico realmente desenha — inclui os 9% do grupo de
   * investimentos, que não existem em META_TARGETS (lá as três naturezas valem
   * 0% cada). Ler de dataRows mantém o rodapé em dia com as barras.
   */
  /*
   * As duas leituras do realizado, para as colunas de RELACAO_DIZIMOS.
   *
   * "sobre despesa" é o próprio número que a barra desenha: a categoria dividida
   * pela despesa total. "sobre dízimos" troca o denominador pela arrecadação do
   * período — mesma quantia em cima, base diferente embaixo.
   *
   * A meta é a mesma nas duas réguas de propósito. Ela é o alvo da categoria; o
   * que muda de uma linha para a outra é contra o que o realizado é medido, e é
   * essa distância que a aba existe para mostrar.
   *
   * A escala também é compartilhada: réguas com escalas próprias colocariam as
   * duas barras em posições parecidas mesmo com valores distantes, que é o
   * oposto do que se quer ver aqui.
   */
  const relacaoDizimos = useMemo(() => {
    const m = new Map<
      string,
      { meta: number; sobreDespesa: number; sobreDizimos: number; escala: number }
    >();
    for (const r of dataRows) {
      if (!RELACAO_DIZIMOS.has(norm(r.name))) continue;
      const sobreDizimos = dizimosOfertas > 0 ? (r.abs / dizimosOfertas) * 100 : 0;
      // O 1,15 deixa folga à direita para a barra mais longa não encostar na borda.
      const escala = Math.max(r.realizado, sobreDizimos, r.meta) * 1.15 || 1;
      m.set(norm(r.name), { meta: r.meta, sobreDespesa: r.realizado, sobreDizimos, escala });
    }
    return m;
  }, [dataRows, dizimosOfertas]);

  const metaEconomia = useMemo(() => dataRows.reduce((s, r) => s + r.meta, 0), [dataRows]);
  const realizadoTotal = useMemo(() => dataRows.reduce((s, r) => s + r.realizado, 0), [dataRows]);

  const fmtPct = (v: number) =>
    `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

  const Tip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    // Só a coluna agrupada ganha a aba de composição ao lado.
    const partes = composicaoPorGrupo.get(norm(label ?? "")) ?? null;
    // E só as de RELACAO_DIZIMOS ganham a das duas réguas. Nunca as duas abas.
    const relacao = relacaoDizimos.get(norm(label ?? "")) ?? null;
    return (
      <div className="flex items-stretch overflow-hidden rounded-lg border border-white/[.16] bg-[#161A21] text-xs shadow-lg">
        <div className="px-3 py-2">
          <p className="mb-1 font-semibold text-ink">{label}</p>
          {payload.map((p: any) => (
            <p key={p.dataKey} className="text-ink-2">
              <span
                className="mr-1.5 inline-block h-2 w-2 rounded-sm align-middle"
                style={{ background: p.color }}
              />
              {p.name}: {fmtPct(p.value)}
            </p>
          ))}
        </div>

        {partes && partes.length > 0 && (
          <div className="min-w-[250px] border-l border-white/[.16] px-3 py-2">
            <p className="mb-2 font-semibold text-ink">Composição</p>

            {/*
             * Mini gráfico: a barra do grupo repartida entre as três naturezas
             * que foram fundidas nela, cada fatia proporcional ao que aquela
             * natureza representa dentro do total do grupo.
             */}
            <div className="mb-2 flex h-2.5 overflow-hidden rounded-full bg-white/10">
              {partes.map((p) => (
                <div key={p.name} style={{ width: `${p.fatia.toFixed(2)}%`, background: p.cor }} />
              ))}
            </div>

            <div className="space-y-1">
              {partes.map((p) => (
                <div key={p.name} className="flex items-baseline gap-2">
                  <span
                    className="inline-block h-2 w-2 shrink-0 translate-y-[-1px] rounded-sm"
                    style={{ background: p.cor }}
                  />
                  <span className="truncate text-ink-2">{p.name}</span>
                  <span className="ml-auto shrink-0 font-medium tabular-nums text-ink">
                    {fmtPct(p.realizado)}
                  </span>
                  {/* Quanto essa natureza pesa dentro do próprio grupo. */}
                  <span className="w-[46px] shrink-0 text-right tabular-nums text-ink-3">
                    {fmtPct(p.fatia)}
                  </span>
                </div>
              ))}
            </div>

            <p className="mt-2 border-t border-white/[.14] pt-1.5 text-[11px] text-ink-3">
              % do débito total · % dentro do grupo
            </p>
          </div>
        )}

        {relacao && (
          <div className="min-w-[268px] border-l border-white/[.16] px-3 py-2">
            <p className="mb-2.5 font-semibold text-ink">Relação entre Dízimos e Ofertas</p>

            <div className="space-y-2.5">
              {[
                { rotulo: "sobre despesa", valor: relacao.sobreDespesa, cor: ORANGE },
                { rotulo: "sobre dízimos", valor: relacao.sobreDizimos, cor: AZUL_DIZIMOS },
              ].map((l) => (
                <div key={l.rotulo}>
                  <div className="mb-1 flex items-baseline justify-between gap-3">
                    <span className="text-ink-2">{l.rotulo}</span>
                    <span className="font-medium tabular-nums text-ink">{fmtPct(l.valor)}</span>
                  </div>

                  {/*
                   * A trilha não recorta o conteúdo: o traço da meta transborda
                   * de propósito, alguns pixels acima e abaixo da barra, para se
                   * ler como marca de régua e não como emenda do preenchimento.
                   */}
                  <div className="relative h-2.5 rounded-full bg-white/10">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{
                        width: `${Math.min(100, (l.valor / relacao.escala) * 100).toFixed(2)}%`,
                        background: l.cor,
                      }}
                    />
                    <div
                      className="absolute inset-y-[-2.5px] w-[2px] -translate-x-1/2 rounded-full"
                      style={{
                        left: `${((relacao.meta / relacao.escala) * 100).toFixed(2)}%`,
                        background: TRACO_META,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-2.5 flex items-center gap-1.5 border-t border-white/[.14] pt-1.5 text-[11px] text-ink-3">
              <span
                className="inline-block h-2.5 w-[2px] shrink-0 rounded-full"
                style={{ background: TRACO_META }}
              />
              meta {fmtPct(relacao.meta)} — a mesma nas duas réguas
            </p>
          </div>
        )}
      </div>
    );
  };

  // ====== Hover ranking panel (Realizado bars) ======
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [hoverMeta, setHoverMeta] = useState<string | null>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleHide = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setHoverMeta(null), 200);
  };
  const cancelHide = () => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };

  const [panelSize, setPanelSize] = useState<{ width: number }>({ width: 560 });
  useEffect(() => {
    if (!hoverMeta || !cardRef.current) {
      setPanelPos(null);
      return;
    }
    const update = () => {
      const r = cardRef.current!.getBoundingClientRect();
      // Anchor in the upper area of the chart (per the blue rectangle in the mock),
      // narrowing the panel as needed so it does not overlap the right-side stats
      // ("Meta de economia = ..." / "Realizado = ...").
      const STATS_RESERVE = 190; // px reserved on the right for the stats column
      const left = r.left + r.width * 0.4;
      const maxRight = r.right - STATS_RESERVE;
      const width = Math.max(360, Math.min(640, maxRight - left));
      const top = r.top + 8;
      setPanelSize({ width });
      setPanelPos({ top, left });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [hoverMeta]);

  /*
   * "Investimentos em Ativos" não existe na coluna Meta da base — é o nome que
   * demos à fusão das três naturezas. Quem for procurar as linhas dele precisa
   * procurar pelas três, senão o ranking abre vazio.
   */
  const chavesDoHover = useMemo(() => {
    if (!hoverMeta) return null;
    // Um grupo não existe na coluna Meta da base: é o nome que demos à fusão.
    // Quem procurar as linhas dele precisa procurar por todas as partes.
    const g = grupoChamado(hoverMeta);
    return new Set((g ? g.partes : [hoverMeta]).map(norm));
  }, [hoverMeta]);

  /* Nome da natureza (normalizado) -> cor, a mesma do mini gráfico do tooltip. */
  const corPorParte = useMemo(
    () =>
      new Map(
        (composicaoPorGrupo.get(norm(hoverMeta ?? "")) ?? []).map((p) => [norm(p.name), p.cor]),
      ),
    [composicaoPorGrupo, hoverMeta],
  );

  /** Quando o hover é um grupo, o painel identifica de qual natureza é a linha. */
  const mostraIdentificacao = corPorParte.size > 0;

  interface LinhaRanking {
    razao: string;
    nat4: string;
    projeto: string;
    soma: number;
    /** Natureza de origem — só interessa quando as três estão misturadas. */
    parte: string;
  }

  /*
   * Teto de linhas do painel. Eram 30, e numa coluna agrupada isso escondia a
   * natureza menor: se a maior tem trinta lançamentos grandes, ela toma a lista
   * inteira e a outra some — mesmo estando somada no total. O painel rola, então
   * o custo de um teto alto é rolagem, não confusão.
   */
  const MAX_LINHAS = 100;

  /* Linhas, total e subtotal por natureza numa varredura só: o total era um
     segundo percurso sobre a base inteira para somar exatamente as mesmas linhas. */
  const rankingBruto = useMemo(() => {
    if (!chavesDoHover)
      return { linhas: [] as LinhaRanking[], total: 0, porParte: [] as [string, number][] };
    const map = new Map<string, LinhaRanking>();
    const somaPorParte = new Map<string, { nome: string; soma: number }>();
    let total = 0;
    for (const r of filtered) {
      const chave = norm(r.meta);
      if (!chavesDoHover.has(chave)) continue;
      total += r.debito1;
      const acc = somaPorParte.get(chave);
      if (acc) acc.soma += r.debito1;
      else somaPorParte.set(chave, { nome: r.meta, soma: r.debito1 });
      const razao = r.razaoSocial || "—";
      const nat4 = r.nat4 || "—";
      const projeto = r.projeto || "<SEM PROJETO>";
      // A natureza entra na chave: as colunas do grupo estão misturadas aqui, e
      // um mesmo fornecedor pode aparecer em mais de uma.
      const k = `${razao}|||${nat4}|||${projeto}|||${chave}`;
      const cur = map.get(k);
      if (cur) cur.soma += r.debito1;
      else map.set(k, { razao, nat4, projeto, soma: r.debito1, parte: r.meta });
    }
    return {
      linhas: Array.from(map.values())
        .sort((a, b) => b.soma - a.soma)
        .slice(0, MAX_LINHAS),
      total,
      /* Quanto cada natureza do grupo pesa. Fica no cabeçalho para responder
         "isto inclui a outra coluna?" sem depender de ela caber na lista. */
      porParte: Array.from(somaPorParte.values())
        .sort((a, b) => b.soma - a.soma)
        .map((p) => [p.nome, p.soma] as [string, number]),
    };
  }, [chavesDoHover, filtered]);

  const rankingRows = rankingBruto.linhas;

  /* O total do painel sai das próprias linhas dele, sem varrer a base de novo:
     o corte de 30 é só de exibição, a soma vem antes dele. */
  const rankingTotal = rankingBruto.total;

  return (
    <>
      <motion.div
        ref={cardRef}
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.45 }}
        onMouseLeave={scheduleHide}
        onMouseEnter={cancelHide}
        className="flex min-h-0 w-full flex-1 flex-col rounded-[10px] border border-line-soft bg-panel p-5 shadow-panel transition-colors"
      >
        <div className="relative mb-3">
          <h3 className="text-lg font-semibold text-ink text-center">Acompanhamento de Metas</h3>
          <div className="absolute right-0 top-0 text-xs text-ink-2 text-right space-y-0.5">
            <p>
              <span className="font-semibold">Meta de economia =</span> {fmtPct(100 - metaEconomia)}
            </p>
            <p>
              <span className="font-semibold">Realizado =</span> {fmtPct(100 - realizadoTotal)}
            </p>
          </div>
        </div>

        <div className="min-h-0 flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={dataRows}
              margin={{ top: 28, right: 16, left: 8, bottom: 48 }}
              barGap={6}
              barCategoryGap="22%"
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(255,255,255,.085)"
                vertical={false}
              />
              <XAxis dataKey="name" tick={<MultiLineTick />} interval={0} height={64} />
              <YAxis tick={{ fontSize: 13, fill: "#9AA6B6" }} tickFormatter={(v) => `${v}%`} />
              <Tooltip
                content={<Tip />}
                cursor={{ fill: "rgba(255,255,255,.045)" }}
                wrapperStyle={{ zIndex: 40, outline: "none" }}
              />
              <Legend
                verticalAlign="top"
                align="left"
                iconType="circle"
                wrapperStyle={{ fontSize: 13, paddingBottom: 8 }}
              />
              <Bar
                dataKey="meta"
                name="Meta"
                fill={AZUL_META}
                radius={[4, 4, 0, 0]}
                barSize={38}
                isAnimationActive={animarGraficos}
              >
                <LabelList
                  dataKey="meta"
                  position="top"
                  formatter={(v: number) => fmtPct(v)}
                  style={{ fontSize: 13, fill: "#E7ECF3", fontWeight: 600 }}
                />
              </Bar>
              <Bar
                dataKey="realizado"
                name="Realizado"
                fill={ORANGE}
                radius={[4, 4, 0, 0]}
                barSize={38}
                isAnimationActive={animarGraficos}
                cursor="pointer"
                onMouseOver={(d: any) => {
                  cancelHide();
                  setHoverMeta(d?.name ?? null);
                }}
              >
                <LabelList
                  dataKey="realizado"
                  position="top"
                  formatter={(v: number) => fmtPct(v)}
                  style={{ fontSize: 13, fill: "#E7ECF3", fontWeight: 600 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {hoverMeta &&
          panelPos &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              style={{
                position: "fixed",
                top: panelPos.top,
                left: panelPos.left,
                width: panelSize.width,
                zIndex: 60,
                pointerEvents: "auto",
              }}
              onMouseEnter={cancelHide}
              onMouseLeave={scheduleHide}
              className="rounded-lg border border-line-soft bg-panel shadow-xl text-xs overflow-hidden"
            >
              <div className="flex items-center justify-between px-4 py-2.5 bg-th text-ink border-b border-line-strong">
                <p className="font-semibold truncate">Maiores despesas {hoverMeta}</p>
                <p className="text-orange-300 font-semibold whitespace-nowrap ml-3">
                  Despesa total = {fmtBRL(rankingTotal)}
                </p>
              </div>

              {/*
               * Subtotal por natureza, só nas colunas agrupadas. A lista abaixo é
               * um ranking: se uma das naturezas tem os maiores lançamentos, ela
               * ocupa as primeiras linhas e a outra pode nem aparecer na tela.
               * Esta faixa mostra o peso de cada uma independente disso.
               */}
              {mostraIdentificacao && rankingBruto.porParte.length > 1 && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line-soft bg-panel-2 px-4 py-1.5">
                  {rankingBruto.porParte.map(([nome, soma]) => (
                    <span key={nome} className="flex items-center gap-1.5 whitespace-nowrap">
                      <span
                        className="inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{ background: corPorParte.get(norm(nome)) ?? ORANGE }}
                      />
                      <span className="text-ink-2">{nome}</span>
                      <span className="font-medium tabular-nums text-ink">{fmtBRL(soma)}</span>
                    </span>
                  ))}
                </div>
              )}

              <div className="max-h-[180px] overflow-y-auto">
                <table className="w-full">
                  <thead className="sticky top-0 bg-panel z-10">
                    <tr className="text-ink-2 border-b border-line-soft">
                      {/*
                       * Só nas colunas agrupadas: aqui as linhas vêm de várias
                       * naturezas misturadas, e sem a bolinha não dá para saber
                       * de qual delas cada despesa veio. `w-px` encolhe a coluna
                       * até o mínimo — o próprio cabeçalho —, para ela não roubar
                       * largura das outras e empurrar o painel para fora da tela.
                       */}
                      {mostraIdentificacao && (
                        <th className="w-px whitespace-nowrap px-3 py-2 text-center font-semibold">
                          Identificação
                        </th>
                      )}
                      <th className="text-left font-semibold px-3 py-2">Razão Social Parceiro</th>
                      <th className="text-left font-semibold px-3 py-2">Descrição Nat. 4º Nível</th>
                      <th className="text-left font-semibold px-3 py-2">Nome Projeto</th>
                      <th className="text-right font-semibold px-3 py-2">Soma de Débito</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankingRows.map((t, i) => (
                      <tr key={i} className="border-b border-line-soft last:border-0">
                        {mostraIdentificacao && (
                          // Só a bolinha: o nome dela está no tooltip da coluna,
                          // ao lado, e no title de quem parar o mouse aqui.
                          <td className="w-px px-3 py-1.5 text-center">
                            <span
                              title={t.parte}
                              className="inline-block h-2.5 w-2.5 rounded-full align-middle"
                              style={{ background: corPorParte.get(norm(t.parte)) ?? ORANGE }}
                            />
                          </td>
                        )}
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
                        <td
                          colSpan={mostraIdentificacao ? 5 : 4}
                          className="px-3 py-3 text-center text-ink-3"
                        >
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
      </motion.div>
    </>
  );
}
