/*
 * Entradas Dízimos e Ofertas — acumulado diário vs. meta.
 *
 * Porta para React do protótipo "Prototipo-Dizimos-Ofertas.html". O protótipo
 * rodava sobre curvas sintéticas; aqui as mesmas visualizações são alimentadas
 * pelas linhas reais da base financeira.
 *
 * Diferenças deliberadas em relação ao protótipo:
 *  - a escala do eixo Y é calculada por uma escada 1/2/2,5/5 genérica em vez da
 *    lista fixa de passos em milhões — uma unidade sozinha fica na casa dos
 *    milhares e a lista original achataria o gráfico contra o topo;
 *  - o "mês em curso" é derivado do último dia com lançamento em vez de uma
 *    data fixa no código.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Columns2 } from "lucide-react";
import { MESES } from "@/lib/format";
import {
  isDizimosOfertas,
  membershipForMonth,
  norm,
  type FinancialRow,
  type MembershipRow,
  metaAnualDaUnidade,
} from "@/lib/parsers";

const MESL = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

/* Paleta do protótipo: L* e croma em faixa estreita (contraste 6,1 a 8,7:1
   sobre o fundo do gráfico), excluindo a faixa de matiz da meta. A ordem
   maximiza a diferença entre meses vizinhos. */
const COR = [
  "#72A6FB",
  "#F7B552",
  "#64D17B",
  "#ED87A2",
  "#D0C984",
  "#C090F9",
  "#01BEC7",
  "#EEB3F2",
  "#A0AE38",
  "#66D3FE",
  "#D79870",
  "#57B699",
];
const CMETA = "#FF5C57";
const UI = {
  grid: "rgba(255,255,255,.085)",
  eixo: "#9AA6B6",
  base: "rgba(255,255,255,.22)",
  guia: "rgba(255,255,255,.45)",
  anel: "#232830",
  fundo: "#232830",
};

/*
 * Altura da área plotada. Não depende do viewport: a seção vive dentro do
 * quadro de design fixo do SectionDeck (1440x840) e é o deck quem escala tudo
 * para a tela. O valor é o que sobra do quadro depois do cabeçalho, da tabela
 * inteira (9 linhas) e do cromo do cartão. O espaço para a tabela veio de
 * compactar cabeçalho, respiros e as linhas — não de encolher o gráfico.
 */
const ALT_PLOT = 312;

const nf = (n: number, d = 0) =>
  (n || 0).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const brl = (n: number) => "R$ " + nf(n, 2);

const diasNoMes = (ano: number, m: number) => new Date(ano, m + 1, 0).getDate();

/*
 * Agregados de um recorte de linhas de dízimos e ofertas: total e curva
 * acumulada por mês. Vive fora do componente porque roda duas vezes com
 * recortes diferentes — um com o filtro de mês aplicado, que alimenta o
 * Gráfico 1 e a tabela, e outro sem ele, que alimenta a esteira do Gráfico 2.
 *
 * A curva de um mês termina no último dia com lançamento: depois disso não há
 * acumulado nenhum, e prolongar a linha reta até o fim do mês fingiria dado que
 * não existe.
 */
function agregarPorMes(rows: FinancialRow[], ano: number) {
  const porMesDia: number[][] = Array.from({ length: 12 }, () => Array(31).fill(0));
  const totalPorMes: number[] = Array(12).fill(0);
  const eventos: Array<Set<string>> = Array.from({ length: 12 }, () => new Set());

  for (const r of rows) {
    const m = r.data ? r.data.getMonth() : r.mes - 1;
    if (m < 0 || m > 11) continue;
    totalPorMes[m] += r.credito;
    if (r.nroUnico) eventos[m].add(r.nroUnico);
    const d = r.data ? r.data.getDate() : r.dia;
    if (d >= 1 && d <= 31) porMesDia[m][d - 1] += r.credito;
  }

  const ultimoDiaPorMes = porMesDia.map((arr) => {
    let last = -1;
    for (let i = 0; i < arr.length; i++) if (arr[i] > 0) last = i + 1;
    return last;
  });

  const curvas = porMesDia.map((arr, m) => {
    const nd = diasNoMes(ano, m);
    const ld = ultimoDiaPorMes[m];
    if (ld < 0) return null;
    let acc = 0;
    const out: Array<number | null> = [];
    for (let i = 0; i < 31; i++) {
      if (i >= nd) {
        out.push(null);
        continue;
      }
      acc += arr[i];
      out.push(i + 1 <= ld ? acc : null);
    }
    return out;
  });

  return {
    totalPorMes,
    eventosPorMes: eventos.map((s) => s.size),
    ultimoDiaPorMes,
    mesesComDado: totalPorMes.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0),
    curvas,
  };
}

/* Escada 1/2/2,5/5 × 10^n — funciona tanto para uma unidade isolada quanto
   para o Total Geral. */
function eixoY(max: number) {
  if (!isFinite(max) || max <= 0) return { p: 1, top: 1 };
  const alvo = max / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(alvo)));
  const cands = [1, 2, 2.5, 5, 10].map((k) => k * mag);
  const p = cands.find((c) => c >= alvo) ?? cands[cands.length - 1];
  return { p, top: Math.ceil(max / p) * p };
}

function rotuloEixo(v: number) {
  if (Math.abs(v) >= 1e6) return "R$ " + (v / 1e6).toFixed(v % 1e6 ? 1 : 0).replace(".", ",") + "M";
  if (Math.abs(v) >= 1000)
    return "R$ " + (v / 1000).toFixed(v % 1000 ? 1 : 0).replace(".", ",") + "k";
  return "R$ " + nf(v);
}

function useLargura<T extends HTMLElement>(min = 280) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(min);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(min, el.clientWidth)));
    ro.observe(el);
    setW(Math.max(min, el.clientWidth));
    return () => ro.disconnect();
  }, [min]);
  return [ref, w] as const;
}

/* ================= componente ================= */

interface Props {
  /** Base já recortada pelos filtros universais do cabeçalho. */
  financial: FinancialRow[];
  /**
   * A base crua, sem nenhum filtro do cabeçalho. Alimenta a tabela "Números do
   * período", que é um bloco de referência fixo, e a linha do ano anterior.
   */
  financialBruto: FinancialRow[];
  /**
   * A mesma base sem o recorte de MÊS. O Gráfico 2 é uma esteira para folhear
   * mês a mês; filtrar um mês no cabeçalho a deixaria com uma carta só.
   */
  financialTodosMeses: FinancialRow[];
  membership: MembershipRow[];
  metaAnualPorUnidade: Record<string, number>;
  metaAnualTotalGeral: number;
  /** Universo de unidades da base — para saber se o filtro pegou todas. */
  unidades: string[];
  unidadesSel: string[]; // vazio = todas
  mesesSel: number[]; // vazio = todos
  ano: number;
}

interface Foco {
  tipo: "mes" | "meta";
  m?: number;
}

export function EntradasDiarias({
  financial,
  financialBruto,
  financialTodosMeses,
  membership,
  metaAnualPorUnidade,
  metaAnualTotalGeral,
  unidades,
  unidadesSel,
  mesesSel,
  ano,
}: Props) {
  const [split, setSplit] = useState(false);
  const [pin, setPin] = useState<Foco | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const alt = ALT_PLOT;

  /*
   * Os filtros são universais e vivem no cabeçalho. Aqui só traduzimos o que
   * eles significam para esta seção: lista vazia quer dizer "tudo".
   */
  const anosNum = useMemo(() => [ano], [ano]);
  const unis = useMemo(
    () => (unidadesSel.length ? unidadesSel : unidades),
    [unidadesSel.join("|"), unidades.join("|")],
  );
  const mesesNum = useMemo(
    () => (mesesSel.length ? mesesSel.map((m) => m - 1) : Array.from({ length: 12 }, (_, i) => i)),
    [mesesSel.join(",")],
  );
  const unisNorm = useMemo(() => new Set(unis.map(norm)), [unis.join("|")]);

  /* --- escopo: só as linhas de dízimos e ofertas do recorte --- */
  const escopo = useMemo(() => financial.filter((r) => isDizimosOfertas(r.nat2)), [financial]);

  /* --- agregados mensais: alimentam o Gráfico 1 e a tabela --- */
  const { totalPorMes, eventosPorMes, ultimoDiaPorMes, mesesComDado, curvas } = useMemo(
    () => agregarPorMes(escopo, ano),
    [escopo, ano],
  );

  /*
   * O Gráfico 2 é uma esteira de meses para folhear, não um recorte: filtrar um
   * mês no cabeçalho deixava a esteira com uma carta só. Ele lê da base sem o
   * filtro de mês — todos os outros (ano, unidade, natureza, projeto, meta)
   * continuam valendo — para que os demais meses sigam à mão.
   */
  const agregadoTodosMeses = useMemo(
    () =>
      agregarPorMes(
        financialTodosMeses.filter((r) => isDizimosOfertas(r.nat2)),
        ano,
      ),
    [financialTodosMeses, ano],
  );

  const mesesAtivos = useMemo(
    () => mesesNum.filter((m) => mesesComDado.includes(m)).sort((a, b) => a - b),
    [mesesNum.join(","), mesesComDado.join(",")],
  );

  /* Mês em curso: o último com dado, desde que não tenha fechado o mês. */
  const mesEmCurso = useCallback(
    (comDado: number[], ultimoDia: number[]) => {
      if (!comDado.length) return { mesParcial: -1, diaCorte: 0 };
      const ultimoMes = comDado[comDado.length - 1];
      const nd = diasNoMes(ano, ultimoMes);
      const ld = ultimoDia[ultimoMes];
      return ld > 0 && ld < nd
        ? { mesParcial: ultimoMes, diaCorte: ld }
        : { mesParcial: -1, diaCorte: 0 };
    },
    [ano],
  );

  const { mesParcial, diaCorte } = useMemo(
    () => mesEmCurso(mesesComDado, ultimoDiaPorMes),
    [mesEmCurso, mesesComDado.join(","), ultimoDiaPorMes.join(",")],
  );

  /** Tudo marcado equivale a nenhum filtro de unidade. */
  const todasUnidades = unis.length === unidades.length && unidades.length > 0;

  /*
   * Meta ANUAL do recorte de unidades. Com todas, é a coluna "Meta Anual Total
   * Geral"; com uma seleção, a soma das colunas "Meta Anual <Unidade>". O
   * consolidado é lido à parte, nunca somado com as unidades: ele já é a soma
   * delas, e juntar os dois contaria tudo duas vezes.
   *
   * Fica isolado num memo porque os gráficos e a tabela "Números do período"
   * dependem do mesmo número — antes cada um tinha a sua cópia da regra.
   */
  const metaAnualDoRecorte = useMemo(
    () =>
      todasUnidades
        ? metaAnualTotalGeral
        : unis.reduce((s, u) => s + metaAnualDaUnidade(metaAnualPorUnidade, u), 0),
    [metaAnualPorUnidade, metaAnualTotalGeral, unis.join("|"), todasUnidades],
  );

  /* Multiplica pelos anos porque os totais também somam quando mais de um ano
     é selecionado. */
  const metaMensal = useMemo(
    () => (metaAnualDoRecorte / 12) * Math.max(1, anosNum.length),
    [metaAnualDoRecorte, anosNum.length],
  );

  /* ================= tabela "Números do período" =================
   * Bloco de referência: lê da base crua, e não do recorte que alimenta os
   * gráficos, para que os doze meses do ano fiquem sempre à vista. Filtrar um
   * mês, uma natureza, um projeto ou uma meta no cabeçalho não encolhe nada
   * daqui — é justamente contra este bloco fixo que se compara o que o gráfico
   * ao lado, esse sim recortado, está mostrando.
   *
   * Duas exceções, e só duas. O ANO, porque sem ele a tabela não teria período
   * nenhum para exibir. E a UNIDADE, porque uma referência que ignora a igreja
   * escolhida deixa de ser referência: a tabela somaria a rede inteira enquanto
   * o gráfico ao lado mostra uma unidade só, e os dois números lado a lado não
   * teriam nenhuma relação entre si.
   */
  const dizimosDoAno = useMemo(
    () =>
      financialBruto.filter(
        (r) => r.ano === ano && isDizimosOfertas(r.nat2) && unisNorm.has(norm(r.unidade)),
      ),
    [financialBruto, ano, unisNorm],
  );
  const tabela = useMemo(() => agregarPorMes(dizimosDoAno, ano), [dizimosDoAno, ano]);

  /* Meta e membresia seguem o mesmo recorte de unidade das linhas acima: se o
     numerador encolhe para uma unidade, o denominador tem de encolher junto,
     senão o dízimo per capita e o % da meta ficam sem sentido. */
  const metaMensalTabela = metaAnualDoRecorte / 12;

  const membPorMes = useMemo(() => {
    /*
     * Com tudo marcado, lê a linha "Total Geral" da planilha em vez de somar as
     * unidades — é o número que a própria base declara, e ele nem sempre bate
     * com a soma: uma unidade ausente da planilha de membresia sumiria da conta.
     */
    const alvos = todasUnidades ? ["Total Geral"] : unis;
    return Array.from({ length: 12 }, (_, m) =>
      alvos.reduce((s, u) => s + membershipForMonth(membership, u, ano, m + 1), 0),
    );
  }, [membership, ano, todasUnidades, unis.join("|")]);

  const anoAntPorMes = useMemo(() => {
    const arr = Array(12).fill(0);
    for (const r of financialBruto) {
      if (r.ano !== ano - 1 || !isDizimosOfertas(r.nat2)) continue;
      if (!unisNorm.has(norm(r.unidade))) continue;
      const m = r.data ? r.data.getMonth() : r.mes - 1;
      if (m >= 0 && m <= 11) arr[m] += r.credito;
    }
    return arr;
  }, [financialBruto, ano, unisNorm]);

  const { mesParcial: mesParcialTabela, diaCorte: diaCorteTabela } = useMemo(
    () => mesEmCurso(tabela.mesesComDado, tabela.ultimoDiaPorMes),
    [mesEmCurso, tabela],
  );

  /* --- pin inválido quando o mês sai do filtro --- */
  useEffect(() => {
    if (pin?.tipo === "mes" && pin.m != null && !mesesAtivos.includes(pin.m)) setPin(null);
  }, [mesesAtivos.join(","), pin]);

  const foco: Foco | null = pin ?? (hover != null ? { tipo: "mes", m: hover } : null);
  const mesAtual = mesesComDado.length ? mesesComDado[mesesComDado.length - 1] : -1;

  const uniTexto =
    unis.length === unidades.length
      ? "Total Geral"
      : unis.length === 0
        ? "Nenhuma unidade"
        : unis.length === 1
          ? unis[0]
          : `${unis.length} unidades`;

  const anoTexto = String(ano);

  return (
    <div className="flex h-full w-full flex-col gap-2 p-5">
      <div className="flex items-end justify-between gap-6">
        <div>
          <h1 className="text-[22px] font-semibold leading-none tracking-tight text-ink">
            Entradas Dízimos e Ofertas — {anoTexto}
          </h1>
          <p className="mt-1 text-[13px] text-ink-2">
            Acumulado diário vs. meta mensal · {uniTexto}
          </p>
        </div>

        {/*
         * Modo de exibição, na mesma linha do título. Ficava numa coluna de
         * 236px à direita dos gráficos, que roubava largura do Gráfico 1 o tempo
         * todo para hospedar um único botão. O texto explicativo saiu junto: o
         * rótulo do botão já diz o que ele faz.
         */}
        <button
          type="button"
          onClick={() => setSplit((v) => !v)}
          disabled={!agregadoTodosMeses.mesesComDado.length}
          title="Divide a área em dois. O da esquerda mostra um mês por vez, navegável pelo arraste ou pelas setas."
          className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold shadow-panel transition disabled:cursor-not-allowed disabled:opacity-40 ${
            split
              ? "border border-line-strong bg-panel-2 text-ink"
              : "bg-acc text-background hover:brightness-110"
          }`}
        >
          <Columns2 className="h-[15px] w-[15px]" />
          {split ? "Fechar comparação" : "Comparar com mês anterior"}
        </button>
      </div>

      <div className="min-w-0">
        {/* gráficos */}
        <div className={`flex min-w-0 flex-row gap-4 ${split ? "items-stretch" : "items-start"}`}>
          {split && (
            /*
             * Todos os meses com dado, o último inclusive, e sem o recorte de
             * mês do cabeçalho. A ideia de "comparar com o anterior" está no
             * slide em que a esteira abre, não em amputar a lista.
             */
            <CarrosselMeses
              meses={agregadoTodosMeses.mesesComDado}
              curvas={agregadoTodosMeses.curvas}
              totalPorMes={agregadoTodosMeses.totalPorMes}
              metaMensal={metaMensal}
              anoTexto={anoTexto}
              alt={alt}
            />
          )}
          <GraficoAcumulado
            meses={mesesAtivos}
            curvas={curvas}
            metaMensal={metaMensal}
            mesAtual={mesAtual}
            mesParcial={mesParcial}
            foco={foco}
            pin={pin}
            onPin={setPin}
            onHover={setHover}
            alt={alt}
          />
        </div>
      </div>

      <TabelaPeriodo
        totalPorMes={tabela.totalPorMes}
        metaMensal={metaMensalTabela}
        anoAntPorMes={anoAntPorMes}
        membPorMes={membPorMes}
        eventosPorMes={tabela.eventosPorMes}
        mesesComDado={tabela.mesesComDado}
        mesParcial={mesParcialTabela}
        diaCorte={diaCorteTabela}
        anoTexto={anoTexto}
        anos={anosNum}
      />
    </div>
  );
}

/* ================= Gráfico 1 — acumulado por mês ================= */

function GraficoAcumulado({
  meses,
  curvas,
  metaMensal,
  mesAtual,
  mesParcial,
  foco,
  pin,
  onPin,
  onHover,
  alt,
}: {
  meses: number[];
  curvas: Array<Array<number | null> | null>;
  metaMensal: number;
  mesAtual: number;
  mesParcial: number;
  foco: Foco | null;
  pin: Foco | null;
  onPin: (f: Foco | null) => void;
  onHover: (m: number | null) => void;
  alt: number;
}) {
  const [hostRef, W] = useLargura<HTMLDivElement>(360);
  const [cursor, setCursor] = useState<{ d: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const H = alt;
  const L = 64;
  const R = W - (W > 420 ? 44 : 16);
  const T = 16;
  const B = H - 34;

  const top = useMemo(() => {
    let max = metaMensal;
    for (const m of meses) {
      const c = curvas[m];
      if (!c) continue;
      for (const v of c) if (v != null && v > max) max = v;
    }
    return eixoY(max * 1.04);
  }, [meses.join(","), curvas, metaMensal]);

  const X = useCallback((d: number) => L + (d - 1) * ((R - L) / 30), [R]);
  const Y = useCallback((v: number) => B - (v / top.top) * (B - T), [B, top.top]);

  const gridVals = useMemo(() => {
    const out: number[] = [];
    for (let g = 0; g <= top.top + 1; g += top.p) out.push(g);
    return out;
  }, [top.p, top.top]);

  /* Ordem de pintura: o mês corrente por último, para ficar por cima. */
  const ordem = useMemo(
    () => meses.slice().sort((a, b) => (a === mesAtual ? 1 : 0) - (b === mesAtual ? 1 : 0)),
    [meses.join(","), mesAtual],
  );

  const pontos = useMemo(() => {
    const out: Record<number, { d: string; fim: { d: number; v: number } | null }> = {};
    for (const m of meses) {
      const c = curvas[m];
      if (!c) continue;
      let p = "";
      let fim: { d: number; v: number } | null = null;
      for (let i = 0; i < c.length; i++) {
        const v = c[i];
        if (v != null) {
          p += `${X(i + 1).toFixed(1)},${Y(v).toFixed(1)} `;
          fim = { d: i + 1, v };
        }
      }
      if (p) out[m] = { d: p.trim(), fim };
    }
    return out;
  }, [meses.join(","), curvas, X, Y]);

  /* Rótulos na ponta da linha, afastados para não se sobreporem. */
  const rotulos = useMemo(() => {
    if (R - L <= 300) return [];
    const arr = meses
      .filter((m) => pontos[m]?.fim)
      .map((m) => ({ m, y: Y(pontos[m]!.fim!.v), x: X(pontos[m]!.fim!.d) }))
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < arr.length; i++) {
      if (arr[i].y - arr[i - 1].y < 12) arr[i].y = arr[i - 1].y + 12;
    }
    return arr;
  }, [meses.join(","), pontos, R, Y, X]);

  const metaPontos = useMemo(() => {
    let p = "";
    for (let d = 1; d <= 31; d++) p += `${X(d).toFixed(1)},${Y((metaMensal * d) / 31).toFixed(1)} `;
    return p.trim();
  }, [X, Y, metaMensal]);

  const destaque = (m: number) => {
    if (!foco) return { lw: m === mesAtual ? 4 : 2, op: 1, halo: 0.92 };
    const on = foco.tipo === "mes" && foco.m === m;
    const base = m === mesAtual ? 4 : 2;
    return { lw: on ? base + 1.6 : base, op: on ? 1 : 0.3, halo: on ? 0.92 : 0.55 };
  };

  const mover = (ev: React.MouseEvent<SVGRectElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const bb = svg.getBoundingClientRect();
    const d = Math.max(
      1,
      Math.min(31, Math.round((ev.clientX - bb.left - L) / ((R - L) / 30)) + 1),
    );
    const my = ev.clientY - bb.top;
    setCursor({ d, y: my });
    if (!pin) {
      let perto: number | null = null;
      let dist = 1e9;
      for (const m of meses) {
        const v = curvas[m]?.[d - 1];
        if (v == null) continue;
        const dy = Math.abs(Y(v) - my);
        if (dy < dist) {
          dist = dy;
          perto = m;
        }
      }
      onHover(dist < 13 ? perto : null);
    }
  };

  const sair = () => {
    setCursor(null);
    if (!pin) onHover(null);
  };

  /*
   * Só os meses. A meta ficava no meio da lista, ordenada pelo valor, como se
   * fosse mais um mês em comparação — e não é: é a régua contra a qual todos
   * são medidos. Ela continua no gráfico (a linha tracejada) e no rodapé, como
   * a "Diferença" logo abaixo.
   */
  const linhasTip = useMemo(() => {
    if (!cursor) return [];
    const out: Array<{ cor: string; k: string; v: number; m?: number }> = [];
    for (const m of meses) {
      const v = curvas[m]?.[cursor.d - 1];
      if (v == null) continue;
      out.push({ cor: COR[m], k: MESES[m], v, m });
    }
    return out.sort((a, b) => b.v - a.v);
  }, [cursor, meses.join(","), curvas]);

  /*
   * Diferença realizado − meta, como no Gráfico 2. Lá havia uma única linha;
   * aqui há várias, então a diferença é a do mês em foco (o mais próximo do
   * cursor, ou o fixado na legenda) e cai no mês corrente quando não há foco.
   * O rótulo carrega o nome do mês para não deixar dúvida de qual linha é.
   */
  const diffTip = useMemo(() => {
    if (!cursor) return undefined;
    const alvo = foco?.tipo === "mes" && foco.m != null ? foco.m : mesAtual;
    if (alvo == null || alvo < 0 || !meses.includes(alvo)) return undefined;
    const v = curvas[alvo]?.[cursor.d - 1];
    if (v == null) return undefined;
    return { k: `Diferença (${MESES[alvo]})`, v: v - (metaMensal * cursor.d) / 31 };
  }, [cursor, foco, mesAtual, meses.join(","), curvas, metaMensal]);

  const opMeta = foco && foco.tipo !== "meta" ? 0.25 : 1;
  const subtitulo =
    meses.length === 0
      ? "Nenhum mês selecionado"
      : `${meses.length === 1 ? MESL[meses[0]] : `${meses.length} meses`} · comparação diária`;

  return (
    <div className="flex-1 min-w-0 bg-plot border border-[#161A21] rounded-[10px] shadow-plot px-[18px] pt-[18px] pb-[14px] order-2">
      <div className="mb-1.5">
        <div className="text-[15px] font-semibold text-[#F6F8FB]">
          Gráfico 1 — Acumulado por mês
        </div>
        <div className="text-[12.5px] text-ink-2 mt-0.5">{subtitulo}</div>
      </div>

      <div ref={hostRef} className="relative w-full">
        <svg ref={svgRef} width={W} height={H} className="block w-full">
          {gridVals.map((g) => (
            <g key={g}>
              <line x1={L} x2={R} y1={Y(g)} y2={Y(g)} stroke={UI.grid} strokeWidth={1} />
              <text x={L - 9} y={Y(g) + 4} textAnchor="end" fill={UI.eixo} fontSize={11}>
                {rotuloEixo(g)}
              </text>
            </g>
          ))}
          {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
            <text key={d} x={X(d)} y={B + 18} textAnchor="middle" fill={UI.eixo} fontSize={10}>
              {d}
            </text>
          ))}
          <line x1={L} x2={R} y1={B} y2={B} stroke={UI.base} strokeWidth={1} />

          <polyline
            points={metaPontos}
            fill="none"
            stroke={CMETA}
            strokeWidth={2}
            strokeDasharray="6 5"
            opacity={opMeta}
          />

          {/* Cada linha é desenhada duas vezes: um contorno na cor do fundo abre
              um vão nos cruzamentos, de modo que a de cima leia como passando
              por cima — sem isso elas se fundem. */}
          {ordem.map((m) => {
            const p = pontos[m];
            if (!p) return null;
            const { lw, op, halo } = destaque(m);
            return (
              <g key={m}>
                <polyline
                  points={p.d}
                  fill="none"
                  stroke={UI.fundo}
                  strokeWidth={lw + 3.6}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  opacity={halo}
                />
                <polyline
                  points={p.d}
                  fill="none"
                  stroke={COR[m]}
                  strokeWidth={lw}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  opacity={op}
                />
              </g>
            );
          })}

          {rotulos.map((r) => {
            const on = !foco || (foco.tipo === "mes" && foco.m === r.m);
            return (
              <text
                key={r.m}
                x={Math.min(R + 7, W - 30)}
                y={r.y + 3.5}
                fill={COR[r.m]}
                fontSize={r.m === mesAtual ? 11 : 10}
                fontWeight={foco?.m === r.m || r.m === mesAtual ? 700 : 500}
                opacity={on ? (r.m === mesAtual || foco?.m === r.m ? 1 : 0.78) : 0.3}
              >
                {MESES[r.m]}
              </text>
            );
          })}

          {cursor && (
            <>
              <line
                x1={X(cursor.d)}
                x2={X(cursor.d)}
                y1={T}
                y2={B}
                stroke={UI.guia}
                strokeWidth={1}
                opacity={0.6}
              />
              {meses.map((m) => {
                const v = curvas[m]?.[cursor.d - 1];
                if (v == null) return null;
                return (
                  <circle
                    key={m}
                    cx={X(cursor.d)}
                    cy={Y(v)}
                    r={3.6}
                    fill={COR[m]}
                    stroke={UI.anel}
                    strokeWidth={1.6}
                  />
                );
              })}
              <circle
                cx={X(cursor.d)}
                cy={Y((metaMensal * cursor.d) / 31)}
                r={3.6}
                fill={CMETA}
                stroke={UI.anel}
                strokeWidth={1.6}
              />
            </>
          )}

          <rect
            x={L}
            y={T}
            width={Math.max(1, R - L)}
            height={B - T}
            fill="transparent"
            onMouseMove={mover}
            onMouseLeave={sair}
          />
        </svg>

        {cursor && (
          <Tooltip
            x={X(cursor.d)}
            y={cursor.y}
            W={W}
            H={H}
            titulo={`Dia ${cursor.d}`}
            linhas={linhasTip}
            rodape={diffTip}
            realce={foco?.tipo === "mes" ? foco.m : undefined}
          />
        )}
      </div>

      {/* legenda */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2.5 justify-center">
        {meses.map((m) => {
          const eAtual = m === mesAtual;
          const marcado = pin?.tipo === "mes" && pin.m === m;
          return (
            <button
              key={m}
              type="button"
              onMouseEnter={() => !pin && onHover(m)}
              onMouseLeave={() => !pin && onHover(null)}
              onClick={() => onPin(marcado ? null : { tipo: "mes", m })}
              className={`inline-flex items-center gap-[5px] px-[5px] py-[3px] rounded-[5px] text-[11.5px] transition ${
                marcado
                  ? "bg-acc/20 text-[#9DBCFF] font-semibold"
                  : pin
                    ? "opacity-40 text-ink-2 hover:bg-white/10"
                    : "text-ink-2 hover:bg-white/[.13] hover:text-[#F6F8FB]"
              } ${eAtual ? "font-bold" : ""}`}
            >
              <i
                className="inline-block w-[14px] rounded-[2px]"
                style={{ background: COR[m], height: eAtual ? 4 : 2.5 }}
              />
              {MESES[m]}
              {m === mesParcial && <span className="text-[9.5px] opacity-75">&nbsp;parcial</span>}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => onPin(pin?.tipo === "meta" ? null : { tipo: "meta" })}
          className={`inline-flex items-center gap-[5px] px-[5px] py-[3px] rounded-[5px] text-[11.5px] transition ${
            pin?.tipo === "meta"
              ? "bg-acc/20 text-[#9DBCFF] font-semibold"
              : pin
                ? "opacity-40 text-ink-2 hover:bg-white/10"
                : "text-ink-2 hover:bg-white/[.13] hover:text-[#F6F8FB]"
          }`}
        >
          <i
            className="inline-block w-[14px] h-[2.5px] rounded-[2px]"
            style={{
              background: `repeating-linear-gradient(90deg, ${CMETA} 0 4px, transparent 4px 7px)`,
            }}
          />
          Meta
        </button>
      </div>
    </div>
  );
}

/* ================= tooltip compartilhada ================= */

function Tooltip({
  x,
  y,
  W,
  H,
  titulo,
  linhas,
  rodape,
  realce,
}: {
  x: number;
  y: number;
  W: number;
  H: number;
  titulo: string;
  linhas: Array<{ cor: string; k: string; v: number; m?: number }>;
  rodape?: { k: string; v: number };
  realce?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [dim, setDim] = useState({ w: 170, h: 90 });
  useLayoutEffect(() => {
    if (ref.current) setDim({ w: ref.current.offsetWidth, h: ref.current.offsetHeight });
  }, [linhas.length, titulo]);

  let left = x + 14;
  if (left + dim.w > W - 4) left = x - dim.w - 14;
  const topo = Math.max(4, Math.min(H - dim.h - 4, y - dim.h / 2));

  return (
    <div
      ref={ref}
      className="absolute pointer-events-none z-[5] rounded-lg border border-white/[.16] bg-[#161A21] px-[11px] py-[9px] text-xs min-w-[150px] text-[#E7ECF3]"
      style={{ left: Math.max(4, left), top: topo, boxShadow: "0 8px 26px rgba(0,0,0,.45)" }}
    >
      <div className="font-semibold text-xs mb-1.5 text-[#F6F8FB]">{titulo}</div>
      {linhas.map((l, i) => {
        const forte = l.m != null && l.m === realce;
        return (
          <div
            key={i}
            className={`flex items-center gap-[7px] py-[1.5px] whitespace-nowrap ${
              forte ? "bg-white/[.09] -mx-[5px] px-[5px] rounded" : ""
            }`}
          >
            <i className="h-2 w-2 shrink-0 rounded-full" style={{ background: l.cor }} />
            <span className={`min-w-[30px] ${forte ? "text-[#F2F5F8]" : "text-ink-2"}`}>{l.k}</span>
            <span className="ml-auto font-medium tabular-nums">{brl(l.v)}</span>
          </div>
        );
      })}
      {rodape && (
        <div className="flex items-center gap-[7px] mt-[5px] pt-[5px] border-t border-white/[.14] whitespace-nowrap">
          <span className="text-ink-2">{rodape.k}</span>
          <span
            className="ml-auto font-medium tabular-nums"
            style={{ color: rodape.v >= 0 ? "#4FCF95" : "#FF7A70" }}
          >
            {rodape.v >= 0 ? "+" : ""}
            {brl(rodape.v)}
          </span>
        </div>
      )}
    </div>
  );
}

/* ================= Gráfico 2 — carrossel em cubo =================
   Ordem da esteira: mais antigo à esquerda, mais recente à direita. Para ver um
   mês mais antigo, arrasta-se da esquerda para a direita. */

function CarrosselMeses({
  meses,
  curvas,
  totalPorMes,
  metaMensal,
  anoTexto,
  alt,
}: {
  meses: number[];
  curvas: Array<Array<number | null> | null>;
  totalPorMes: number[];
  metaMensal: number;
  anoTexto: string;
  alt: number;
}) {
  const [viewRef, W] = useLargura<HTMLDivElement>(280);
  const cuboRef = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(Math.max(0, meses.length - 1));
  const [animando, setAnimando] = useState(false);
  const drag = useRef({ ativo: false, x0: 0, mov: 0, t0: 0, raf: 0 });

  /*
   * Abre no penúltimo mês da esteira: o anterior ao que tem os últimos dados.
   * É o mês com que faz sentido comparar. O último continua a um passo de
   * distância, à direita, e com um mês só na lista cai no próprio.
   */
  useEffect(() => {
    setIdx(Math.max(0, meses.length - 2));
  }, [meses.join(",")]);

  const clamp = (i: number) => Math.max(0, Math.min(meses.length - 1, i));

  const gira = useCallback(
    (ang: number, anim: boolean) => {
      const c = cuboRef.current;
      if (!c) return;
      c.style.transition = anim ? "transform .5s cubic-bezier(.25,.85,.32,1)" : "none";
      c.style.transform = `translateZ(-${W / 2}px) rotateY(${ang.toFixed(3)}deg)`;
      // Uma face está iluminada quando seu ângulo no mundo é zero.
      const faces = c.children;
      for (let i = 0; i < faces.length; i++) {
        const d = i - idx;
        if (Math.abs(d) > 1) continue;
        const mundo = ang + (d === 0 ? 0 : d === -1 ? -90 : 90);
        const dim = Math.min(1, Math.abs(mundo) / 90) * 0.46;
        (faces[i] as HTMLElement).style.setProperty("--dim", dim.toFixed(3));
      }
    },
    [W, idx],
  );

  useLayoutEffect(() => {
    gira(0, false);
  }, [gira, idx, W]);

  const vaiPara = useCallback(
    (delta: number) => {
      if (animando) return;
      const novo = clamp(idx + delta);
      if (novo === idx) return;
      const dir = novo < idx ? 1 : -1; // recuar no índice => girar +90
      if (Math.abs(novo - idx) === 1) {
        setAnimando(true);
        gira(dir * 90, true);
        window.setTimeout(() => {
          setIdx(novo);
          setAnimando(false);
        }, 500);
      } else {
        setIdx(novo);
      }
    },
    [idx, animando, gira],
  );

  /* arraste: gira o cubo em tempo real */
  const inicio = (e: React.PointerEvent) => {
    if (animando || e.button !== 0 || !meses.length) return;
    drag.current = { ativo: true, x0: e.clientX, mov: 0, t0: performance.now(), raf: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const mover = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d.ativo) return;
    let dx = e.clientX - d.x0;
    // resistência nas pontas
    if ((idx === meses.length - 1 && dx < 0) || (idx === 0 && dx > 0)) dx *= 0.28;
    d.mov = dx;
    if (!d.raf) {
      d.raf = requestAnimationFrame(() => {
        d.raf = 0;
        gira(Math.max(-90, Math.min(90, (d.mov / W) * 90)), false);
      });
    }
  };
  const fim = () => {
    const d = drag.current;
    if (!d.ativo) return;
    d.ativo = false;
    if (d.raf) {
      cancelAnimationFrame(d.raf);
      d.raf = 0;
    }
    const frac = d.mov / W;
    const vel = d.mov / Math.max(1, performance.now() - d.t0);
    const passa = Math.abs(frac) > 0.26 || Math.abs(vel) > 0.42;
    const dir = d.mov > 0 ? 1 : -1;
    const novo = idx - dir;
    if (passa && novo >= 0 && novo < meses.length) {
      setAnimando(true);
      gira(dir * 90, true);
      window.setTimeout(() => {
        setIdx(novo);
        setAnimando(false);
      }, 500);
    } else {
      gira(0, true);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        vaiPara(-1);
        e.preventDefault();
      }
      if (e.key === "ArrowRight") {
        vaiPara(1);
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [vaiPara]);

  const m = meses[idx];
  const total = m != null ? totalPorMes[m] : null;
  const pct = total != null && metaMensal > 0 ? (total / metaMensal - 1) * 100 : null;

  return (
    /*
     * 40% da linha, contra os 60% que sobram para o Gráfico 1 ao lado. Os 8px
     * descontados são metade do gap-4 entre os dois: sem isso a soma das bases
     * passaria de 100% e o flex encolheria os dois. O Gráfico 1 não declara
     * base — é `flex-1` e fica com todo o resto —, então mudar só este número
     * move a divisória, e a borda esquerda dele vem junto.
     */
    <div className="flex-[0_0_calc(40%-8px)] min-w-0 bg-plot border border-[#161A21] rounded-[10px] shadow-plot px-[18px] pt-[18px] pb-[14px] order-1">
      <div className="mb-1.5">
        <div className="text-[15px] font-semibold text-[#F6F8FB]">
          {m != null ? `Gráfico 2 — ${MESL[m]} / ${anoTexto}` : "Gráfico 2"}
        </div>
        <div className="text-[12.5px] text-ink-2 mt-0.5">
          {total != null && pct != null ? (
            <>
              Fechamento {brl(total)} ·{" "}
              <span className="font-semibold" style={{ color: pct >= 0 ? "#4FCF95" : "#FF7A70" }}>
                {pct >= 0 ? "+" : ""}
                {nf(pct, 1)}% vs meta
              </span>
            </>
          ) : (
            "Sem meses anteriores no período"
          )}
        </div>
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={() => vaiPara(-1)}
          disabled={idx <= 0}
          aria-label="Mês anterior"
          className="absolute top-1/2 -translate-y-1/2 -left-[13px] z-[6] h-8 w-8 rounded-full grid place-content-center bg-white/[.15] border border-white/[.28] backdrop-blur-[6px] text-[#DCE3EC] transition hover:enabled:bg-acc hover:enabled:border-acc hover:enabled:text-background disabled:opacity-[.22] disabled:cursor-default"
        >
          <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2.5} />
        </button>
        <button
          type="button"
          onClick={() => vaiPara(1)}
          disabled={idx >= meses.length - 1}
          aria-label="Mês seguinte"
          className="absolute top-1/2 -translate-y-1/2 -right-[13px] z-[6] h-8 w-8 rounded-full grid place-content-center bg-white/[.15] border border-white/[.28] backdrop-blur-[6px] text-[#DCE3EC] transition hover:enabled:bg-acc hover:enabled:border-acc hover:enabled:text-background disabled:opacity-[.22] disabled:cursor-default"
        >
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.5} />
        </button>

        <div
          ref={viewRef}
          onPointerDown={inicio}
          onPointerMove={mover}
          onPointerUp={fim}
          onPointerCancel={fim}
          onDragStart={(e) => e.preventDefault()}
          className="relative overflow-hidden select-none cursor-grab active:cursor-grabbing"
          style={{
            height: alt + 16,
            perspective: "1500px",
            perspectiveOrigin: "50% 50%",
            touchAction: "pan-y",
          }}
        >
          <div
            ref={cuboRef}
            className="absolute inset-0"
            style={{ transformStyle: "preserve-3d", willChange: "transform" }}
          >
            {meses.map((mm, i) => {
              const d = i - idx;
              const z = W / 2;
              const oculta = Math.abs(d) > 1;
              const rot = d === 0 ? 0 : d === -1 ? -90 : 90;
              return (
                <div
                  key={mm}
                  className="absolute inset-0 rounded-md bg-plot"
                  style={
                    {
                      backfaceVisibility: "hidden",
                      transformStyle: "preserve-3d",
                      contain: "layout paint",
                      visibility: oculta ? "hidden" : "visible",
                      pointerEvents: oculta ? "none" : undefined,
                      transform: oculta
                        ? `rotateY(0deg) translateZ(-${z}px)`
                        : `rotateY(${rot}deg) translateZ(${z}px)`,
                      "--dim": d === 0 ? "0" : "0.46",
                    } as React.CSSProperties
                  }
                >
                  {!oculta && (
                    <SlideMes
                      m={mm}
                      curva={curvas[mm]}
                      metaMensal={metaMensal}
                      W={W}
                      anoTexto={anoTexto}
                      alt={alt}
                      interativo={d === 0 && !drag.current.ativo}
                    />
                  )}
                  <span
                    className="absolute inset-0 rounded-md pointer-events-none bg-[#0E1013] transition-opacity duration-500"
                    style={{ opacity: "var(--dim, 0)" }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap justify-center gap-[5px]">
        {meses.map((mm, i) => (
          <button
            key={mm}
            type="button"
            title={MESL[mm]}
            onClick={() => vaiPara(i - idx)}
            className={`h-[7px] rounded-full transition-all ${
              i === idx ? "w-5 rounded bg-acc" : "w-[7px] bg-white/[.32] hover:bg-white/[.55]"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function SlideMes({
  m,
  curva,
  metaMensal,
  W,
  anoTexto,
  alt,
  interativo,
}: {
  m: number;
  curva: Array<number | null> | null;
  metaMensal: number;
  W: number;
  anoTexto: string;
  alt: number;
  interativo: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [cursor, setCursor] = useState<{ d: number; y: number } | null>(null);

  const H = alt;
  const L = 64;
  const R = W - 16;
  const T = 16;
  const B = H - 34;

  const top = useMemo(() => {
    let max = metaMensal;
    if (curva) for (const v of curva) if (v != null && v > max) max = v;
    return eixoY(max * 1.04);
  }, [curva, metaMensal]);

  const X = (d: number) => L + (d - 1) * ((R - L) / 30);
  const Y = (v: number) => B - (v / top.top) * (B - T);

  const gridVals = useMemo(() => {
    const out: number[] = [];
    for (let g = 0; g <= top.top + 1; g += top.p) out.push(g);
    return out;
  }, [top.p, top.top]);

  const { pts, area } = useMemo(() => {
    if (!curva) return { pts: "", area: "" };
    let p = "";
    const arr: string[] = [];
    for (let i = 0; i < curva.length; i++) {
      const v = curva[i];
      if (v != null) {
        const s = `${X(i + 1).toFixed(1)},${Y(v).toFixed(1)}`;
        p += s + " ";
        arr.push(s);
      }
    }
    if (!arr.length) return { pts: "", area: "" };
    return {
      pts: p.trim(),
      area: `M${L},${B} L${arr.join(" L")} L${arr[arr.length - 1].split(",")[0]},${B} Z`,
    };
  }, [curva, W, top.top]);

  let metaP = "";
  for (let d = 1; d <= 31; d++)
    metaP += `${X(d).toFixed(1)},${Y((metaMensal * d) / 31).toFixed(1)} `;

  const mover = (ev: React.MouseEvent<SVGRectElement>) => {
    if (!interativo) return;
    const svg = svgRef.current;
    if (!svg) return;
    const bb = svg.getBoundingClientRect();
    const d = Math.max(
      1,
      Math.min(31, Math.round((ev.clientX - bb.left - L) / ((R - L) / 30)) + 1),
    );
    setCursor({ d, y: ev.clientY - bb.top });
  };

  const vAtual = cursor && curva ? curva[cursor.d - 1] : null;
  const vMeta = cursor ? (metaMensal * cursor.d) / 31 : 0;

  return (
    <>
      <div className="relative w-full">
        <svg ref={svgRef} width={W} height={H} className="block w-full">
          {gridVals.map((g) => (
            <g key={g}>
              <line x1={L} x2={R} y1={Y(g)} y2={Y(g)} stroke={UI.grid} strokeWidth={1} />
              <text x={L - 9} y={Y(g) + 4} textAnchor="end" fill={UI.eixo} fontSize={11}>
                {rotuloEixo(g)}
              </text>
            </g>
          ))}
          {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
            <text key={d} x={X(d)} y={B + 18} textAnchor="middle" fill={UI.eixo} fontSize={10}>
              {W < 430 ? (d % 5 === 0 || d === 1 ? d : "") : d}
            </text>
          ))}
          <line x1={L} x2={R} y1={B} y2={B} stroke={UI.base} strokeWidth={1} />
          <polyline
            points={metaP.trim()}
            fill="none"
            stroke={CMETA}
            strokeWidth={2}
            strokeDasharray="6 5"
          />
          {pts && (
            <>
              <path d={area} fill={COR[m]} opacity={0.2} />
              <polyline
                points={pts}
                fill="none"
                stroke={UI.fundo}
                strokeWidth={6.6}
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={0.92}
              />
              <polyline
                points={pts}
                fill="none"
                stroke={COR[m]}
                strokeWidth={3}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </>
          )}
          {cursor && (
            <>
              <line
                x1={X(cursor.d)}
                x2={X(cursor.d)}
                y1={T}
                y2={B}
                stroke={UI.guia}
                strokeWidth={1}
                opacity={0.6}
              />
              {vAtual != null && (
                <circle
                  cx={X(cursor.d)}
                  cy={Y(vAtual)}
                  r={4}
                  fill={COR[m]}
                  stroke={UI.anel}
                  strokeWidth={1.8}
                />
              )}
              <circle
                cx={X(cursor.d)}
                cy={Y(vMeta)}
                r={4}
                fill={CMETA}
                stroke={UI.anel}
                strokeWidth={1.8}
              />
            </>
          )}
          <rect
            x={L}
            y={T}
            width={Math.max(1, R - L)}
            height={B - T}
            fill="transparent"
            style={{ pointerEvents: interativo ? "auto" : "none" }}
            onMouseMove={mover}
            onMouseLeave={() => setCursor(null)}
          />
        </svg>

        {cursor && (
          <Tooltip
            x={X(cursor.d)}
            y={cursor.y}
            W={W}
            H={H}
            titulo={`${MESL[m]} · dia ${cursor.d}`}
            linhas={[
              ...(vAtual != null ? [{ cor: COR[m], k: MESES[m], v: vAtual }] : []),
              { cor: CMETA, k: "Meta", v: vMeta },
            ]}
            rodape={vAtual != null ? { k: "Diferença", v: vAtual - vMeta } : undefined}
          />
        )}
      </div>
      <div className="text-center text-[11.5px] text-ink-2 mt-2 font-medium">
        {MESL[m]} / {anoTexto}
      </div>
    </>
  );
}

/* ================= tabela — 12 meses fixos =================
   Não depende do filtro de Mês. Ano e Unidade continuam definindo o escopo. */

function TabelaPeriodo({
  totalPorMes,
  metaMensal,
  anoAntPorMes,
  membPorMes,
  eventosPorMes,
  mesesComDado,
  mesParcial,
  diaCorte,
  anoTexto,
  anos,
}: {
  totalPorMes: number[];
  metaMensal: number;
  anoAntPorMes: number[];
  membPorMes: number[];
  eventosPorMes: number[];
  mesesComDado: number[];
  mesParcial: number;
  diaCorte: number;
  anoTexto: string;
  anos: number[];
}) {
  const TODOS = Array.from({ length: 12 }, (_, i) => i);
  const vazio = (m: number) => !mesesComDado.includes(m);
  /*
   * O mês em curso não tinge as células: o destaque dele vive no cabeçalho da
   * coluna e no asterisco da linha Meta, e só. Uma coluna inteira em laranja
   * competiria com os próprios números.
   */
  const cls = (m: number) => (vazio(m) ? "bg-void text-[#4E596A]" : "");
  const sufixo = anos.length === 1 ? "/" + String(anos[0]).slice(2) : "";

  /*
   * Meta do mês em curso, proporcional aos dias que a base já cobre.
   *
   * Um mês com lançamentos só até o dia 25 comparado contra a meta cheia de 31
   * dias aparece como um fracasso que não aconteceu: falta arrecadação porque
   * faltam seis dias de lançamento, não porque a igreja ficou para trás. A meta
   * ainda não venceu por inteiro, então a linha mostra a parte dela que venceu.
   *
   * Vale só para a célula do mês. O "Acumulado" continua sendo a meta ANUAL
   * cheia — é o compromisso do ano, e ele não encolhe porque agosto ainda não
   * acabou.
   */
  const anoBase = anos[0] ?? new Date().getFullYear();
  const metaDoMes = (m: number) =>
    m === mesParcial ? (metaMensal / diasNoMes(anoBase, m)) * diaCorte : metaMensal;
  const anoAnt = anos
    .map((a) => a - 1)
    .sort((a, b) => a - b)
    .join(", ");

  const somaVal = TODOS.reduce((s, m) => s + (vazio(m) ? 0 : totalPorMes[m]), 0);
  const somaAnt = anoAntPorMes.reduce((s, v) => s + v, 0);
  const membCom = TODOS.filter((m) => membPorMes[m] > 0);
  const membMedia = membCom.length
    ? membCom.reduce((s, m) => s + membPorMes[m], 0) / membCom.length
    : 0;
  const evtCom = TODOS.filter((m) => !vazio(m) && eventosPorMes[m] > 0);
  const evtMedia = evtCom.length
    ? evtCom.reduce((s, m) => s + eventosPorMes[m], 0) / evtCom.length
    : 0;
  const vmCom = TODOS.filter((m) => !vazio(m) && membPorMes[m] > 0);
  const vmMedia = vmCom.length
    ? vmCom.reduce((s, m) => s + totalPorMes[m] / membPorMes[m], 0) / vmCom.length
    : 0;
  /*
   * Meta acumulada dos meses com dado, com o mês em curso entrando só pela
   * parte que venceu — a mesma regra das células da linha acima.
   *
   * Antes o denominador era `metaMensal * nCom`, que cobrava o mês parcial
   * como se estivesse fechado e derrubava o acumulado por causa do calendário,
   * não do desempenho. É o mesmo defeito que a célula do mês já corrigiu; se
   * ficasse só nela, o acumulado contradiria a própria linha.
   */
  const metaAcum = TODOS.reduce((s, m) => (vazio(m) ? s : s + metaDoMes(m)), 0);
  const pctAcum = metaAcum > 0 ? (somaVal / metaAcum - 1) * 100 : 0;

  const Td = ({ m, children }: { m: number; children?: React.ReactNode }) => (
    <td
      className={`px-2.5 py-[3px] text-center whitespace-nowrap tabular-nums border-b border-[#242B37] text-ink transition-colors group-hover:bg-row-hover ${cls(m)}`}
    >
      {children}
    </td>
  );

  const Pill = ({ v, digits = 0 }: { v: number; digits?: number }) => (
    <span
      // Texto sempre em branco, como nas demais linhas; só a caixa muda de cor.
      className={`inline-block rounded px-1.5 py-px text-[11.5px] font-semibold text-ink ${
        v >= 0 ? "bg-pos/20" : "bg-neg/25"
      }`}
    >
      {v >= 0 ? "+" : ""}
      {nf(v, digits)}%
    </span>
  );

  return (
    // shrink-0: sem isso o flex comprime o card no modo de comparação e a
    // última linha da tabela some por baixo da borda.
    <div className="shrink-0 overflow-hidden rounded-[10px] border border-line-soft bg-panel shadow-panel">
      <div className="flex flex-wrap items-center justify-between gap-3.5 border-b border-line-strong px-[18px] py-1.5">
        <h3 className="text-[14.5px] font-semibold text-ink">Números do período — {anoTexto}</h3>
        <div className="text-xs text-ink-3">
          Ano inteiro · valores em milhares de reais
          {mesParcial >= 0 && (
            <span className="text-[#B0803A]">
              {" · "}* mês em curso, dados parciais até o dia {diaCorte}
            </span>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="border-collapse w-full min-w-[900px] text-[12.5px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-[2] bg-th text-left px-2.5 py-1.5 text-[11px] font-semibold text-ink-3 uppercase tracking-[0.04em] border-b border-line-strong min-w-[186px]">
                Milhares de reais
              </th>
              {TODOS.map((m) => (
                <th
                  key={m}
                  className={`px-2.5 py-1.5 text-center text-[11.5px] font-semibold border-b border-line-strong capitalize whitespace-nowrap ${
                    vazio(m)
                      ? "bg-void text-[#5A6577]"
                      : m === mesParcial
                        ? "bg-th text-[#B0803A]"
                        : "bg-th text-ink-2"
                  }`}
                >
                  {MESES[m].toLowerCase()}
                  {sufixo}
                  {m === mesParcial ? " *" : ""}
                </th>
              ))}
              <th className="px-2.5 py-1.5 text-center text-[11.5px] font-semibold text-ink bg-[#1D232E] border-b border-line-strong border-l border-line-strong">
                Acumulado
              </th>
            </tr>
          </thead>
          <tbody>
            <Linha titulo="Valor mensal Entradas">
              {TODOS.map((m) => (
                <Td key={m} m={m}>
                  {vazio(m) ? "" : nf(totalPorMes[m] / 1000)}
                </Td>
              ))}
              <TdTotal>{nf(somaVal / 1000)}</TdTotal>
            </Linha>

            <Linha titulo="Meta">
              {TODOS.map((m) => (
                <Td key={m} m={m}>
                  {/* Só o asterisco é laranja — o número fica na cor de sempre.
                      A cor vai num <span> próprio, e não numa classe do <td>:
                      no <td> ela disputaria com o `text-ink` de lá, e como as
                      duas classes têm a mesma especificidade quem venceria
                      seria a que sai por último no CSS gerado, não a ordem na
                      string. Em outro elemento não há disputa: o span apenas
                      sobrepõe a cor herdada. */}
                  {nf(metaDoMes(m) / 1000)}
                  {m === mesParcial ? <span className="text-[#B0803A]">&nbsp;*</span> : ""}
                </Td>
              ))}
              <TdTotal>{nf((metaMensal * 12) / 1000)}</TdTotal>
            </Linha>

            <Linha titulo="% Real / Meta">
              {TODOS.map((m) => (
                <Td key={m} m={m}>
                  {/* Compara contra a meta que já venceu, não contra a do mês
                      cheio: no mês em curso faltam dias de lançamento, e medir
                      o realizado parcial contra a meta inteira mostraria uma
                      queda que é do calendário, não do desempenho. */}
                  {vazio(m) || metaDoMes(m) <= 0 ? (
                    ""
                  ) : (
                    <Pill v={(totalPorMes[m] / metaDoMes(m) - 1) * 100} />
                  )}
                </Td>
              ))}
              <TdTotal>
                <Pill v={pctAcum} digits={1} />
              </TdTotal>
            </Linha>

            <Linha titulo={`Dízimos e Ofertas ${anoAnt}`}>
              {TODOS.map((m) => (
                <Td key={m} m={m}>
                  {anoAntPorMes[m] ? nf(anoAntPorMes[m] / 1000) : ""}
                </Td>
              ))}
              <TdTotal>{somaAnt ? nf(somaAnt / 1000) : ""}</TdTotal>
            </Linha>

            <tr>
              <td className="sticky left-0 z-[2] bg-[#1C222D] px-2.5 py-1 text-[11.5px] font-semibold text-ink-2 uppercase tracking-[0.04em]">
                Receita Per Capta
              </td>
              {TODOS.map((m) => (
                <td key={m} className="bg-[#1C222D]" />
              ))}
              <td className="bg-[#1C222D] px-2.5 py-1 text-center text-[11.5px] font-semibold text-ink-2 uppercase tracking-[0.04em] border-l border-line-strong">
                Média
              </td>
            </tr>

            <Linha titulo="Membresia">
              {TODOS.map((m) => (
                <Td key={m} m={m}>
                  {membPorMes[m] ? nf(membPorMes[m]) : ""}
                </Td>
              ))}
              <TdTotal>{membMedia ? nf(membMedia) : ""}</TdTotal>
            </Linha>

            <Linha titulo="Valor Médio Mensal">
              {TODOS.map((m) => (
                <Td key={m} m={m}>
                  {vazio(m) || !membPorMes[m] ? "" : nf(totalPorMes[m] / membPorMes[m], 2)}
                </Td>
              ))}
              <TdTotal>{vmMedia ? nf(vmMedia) : ""}</TdTotal>
            </Linha>

            <Linha titulo="Eventos de Depósitos">
              {TODOS.map((m) => (
                <Td key={m} m={m}>
                  {vazio(m) ? "" : nf(eventosPorMes[m])}
                </Td>
              ))}
              <TdTotal>{evtMedia ? nf(evtMedia) : ""}</TdTotal>
            </Linha>

            <Linha titulo="Depositantes / Membresia">
              {TODOS.map((m) => (
                <Td key={m} m={m}>
                  {vazio(m) || !membPorMes[m]
                    ? ""
                    : nf((eventosPorMes[m] / membPorMes[m]) * 100) + "%"}
                </Td>
              ))}
              <TdTotal>
                {evtMedia && membMedia ? nf((evtMedia / membMedia) * 100) + "%" : ""}
              </TdTotal>
            </Linha>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Linha({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <tr className="group">
      <td className="sticky left-0 z-[2] px-2.5 py-[3px] text-left font-medium text-ink-2 border-b border-[#242B37] min-w-[186px] whitespace-nowrap bg-panel group-hover:bg-row-hover transition-colors">
        {titulo}
      </td>
      {children}
    </tr>
  );
}

function TdTotal({ children }: { children?: React.ReactNode }) {
  return (
    <td className="px-2.5 py-[3px] text-center whitespace-nowrap tabular-nums font-semibold text-ink bg-[#1D232E] border-l border-line-strong border-b border-[#242B37] transition-colors group-hover:bg-row-hover">
      {children}
    </td>
  );
}
