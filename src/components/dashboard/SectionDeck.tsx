/*
 * Deck de seções — trilho de miniaturas à esquerda, palco à direita.
 *
 * A ideia central que faz a transição ser fluida: cada seção é montada UMA vez,
 * num tamanho de design fixo (DESIGN_W × DESIGN_H), e nunca muda de pai nem de
 * tamanho no layout. O que muda é só `x`, `y` e `scale`.
 *
 * Isso importa porque a alternativa óbvia — mover o nó do trilho para o palco —
 * desmontaria e remontaria os gráficos a cada clique, e o Recharts recalcularia
 * tudo no meio da animação. Aqui não há reflow nenhum durante o movimento: o
 * navegador só compõe transformações, que rodam na GPU.
 *
 * Consequência prática: as seções ficam sempre "prontas". A miniatura é a seção
 * de verdade, viva e atualizada com os filtros, só que reduzida.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { ProvedorSecaoAtiva, SecaoOciosa } from "./secaoAtiva";

export const DESIGN_W = 1440;
export const DESIGN_H = 840;

/*
 * A transição é feita com transform + transition do CSS, não com o `animate` do
 * framer. Dois motivos: é o mesmo caminho composto na GPU, e tira uma camada de
 * comportamento de biblioteca de cima do que é só interpolar três números.
 *
 * A curva é uma easeOutQuint: arranca rápido e assenta longo, sem repique. É o
 * que dá a sensação de peso controlado, em vez do quique de uma mola.
 */
const CURVA = "cubic-bezier(0.22, 1, 0.36, 1)";
const DUR_MOV = 620;
const DUR_VEU = 420;

export interface SecaoDef {
  id: string;
  numero: number;
  titulo: string;
  conteudo: ReactNode;
}

interface Caixa {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Geo {
  palco: Caixa;
  vagas: Caixa[];
}

const VAZIA: Caixa = { x: 0, y: 0, w: 0, h: 0 };

export function SectionDeck({ secoes }: { secoes: SecaoDef[] }) {
  const [ativo, setAtivo] = useState(secoes[0]?.id ?? "");
  // Miniatura sob o cursor: cresce um pouco e clareia, para o alvo do clique dar
  // resposta antes do clique acontecer.
  const [pairado, setPairado] = useState<string | null>(null);
  const [montadas, setMontadas] = useState<Set<string>>(() => new Set([secoes[0]?.id ?? ""]));

  const containerRef = useRef<HTMLDivElement>(null);
  const palcoRef = useRef<HTMLDivElement>(null);
  const vagasRef = useRef<Array<HTMLDivElement | null>>([]);
  const [geo, setGeo] = useState<Geo | null>(null);

  /*
   * As seções fora do palco entram depois do primeiro quadro. Montar as quatro
   * de uma vez com a base inteira travaria a tela no clique de "Gerar
   * Dashboard"; assim o palco aparece na hora e as miniaturas preenchem em
   * seguida, uma a cada quadro ocioso.
   */
  const idsRef = useRef(secoes.map((s) => s.id).join("|"));
  idsRef.current = secoes.map((s) => s.id).join("|");

  useEffect(() => {
    /*
     * Uma cadeia de timers disparada uma única vez, guardada por ref. A versão
     * anterior reagendava dentro de um efeito que dependia de `montadas`, e o
     * cleanup cancelava o agendamento antes de ele chegar a rodar — as
     * miniaturas nunca entravam.
     */
    const ids = idsRef.current.split("|");
    let vivo = true;
    let t: number | undefined;
    const proxima = (k: number) => {
      if (!vivo || k >= ids.length) return;
      setMontadas((m) => (m.has(ids[k]) ? m : new Set([...m, ids[k]])));
      t = window.setTimeout(() => proxima(k + 1), 90);
    };
    t = window.setTimeout(() => proxima(0), 120);
    return () => {
      vivo = false;
      if (t) window.clearTimeout(t);
    };
  }, []);

  // Clicar numa miniatura precisa garantir que ela já esteja montada.
  const selecionar = (id: string) => {
    setMontadas((m) => (m.has(id) ? m : new Set([...m, id])));
    setAtivo(id);
  };

  const medir = useCallback(() => {
    const c = containerRef.current;
    const p = palcoRef.current;
    if (!c || !p) return;
    const base = c.getBoundingClientRect();
    const rel = (el: HTMLElement): Caixa => {
      const r = el.getBoundingClientRect();
      return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
    };
    setGeo({
      palco: rel(p),
      vagas: vagasRef.current.map((el) => (el ? rel(el) : VAZIA)),
    });
  }, []);

  useLayoutEffect(() => {
    medir();
    const c = containerRef.current;
    if (!c) return;
    const ro = new ResizeObserver(medir);
    ro.observe(c);
    window.addEventListener("resize", medir);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", medir);
    };
  }, [medir, secoes.length]);

  /* Encaixa a seção (sempre DESIGN_W × DESIGN_H) dentro da caixa de destino,
     preservando a proporção e centralizando o que sobrar. */
  const destino = (caixa: Caixa) => {
    if (!caixa.w || !caixa.h) return { x: 0, y: 0, escala: 0.1 };
    const escala = Math.min(caixa.w / DESIGN_W, caixa.h / DESIGN_H);
    return {
      x: caixa.x + (caixa.w - DESIGN_W * escala) / 2,
      y: caixa.y + (caixa.h - DESIGN_H * escala) / 2,
      escala,
    };
  };

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {/* ---- camada de layout: só reserva o espaço, não desenha conteúdo ---- */}
      <div className="flex h-full w-full gap-6 p-6">
        <nav
          aria-label="Seções do dashboard"
          className="flex w-[264px] shrink-0 flex-col justify-between gap-4"
        >
          {secoes.map((s, i) => {
            const eAtivo = s.id === ativo;
            return (
              <motion.button
                key={s.id}
                type="button"
                onClick={() => selecionar(s.id)}
                onMouseEnter={() => setPairado(s.id)}
                onMouseLeave={() => setPairado((p) => (p === s.id ? null : p))}
                onFocus={() => setPairado(s.id)}
                onBlur={() => setPairado((p) => (p === s.id ? null : p))}
                aria-current={eAtivo ? "true" : undefined}
                whileTap={{ scale: 0.965 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                className="group flex min-h-0 flex-1 flex-col text-left focus:outline-none"
              >
                {/*
                 * Número e título em duas linhas. Numa linha só, a 264px, os
                 * títulos longos ("Análise de Despesas") empurravam o rótulo e
                 * a separação dependia de uma margem lateral — frágil e apertado.
                 */}
                <span className="mb-2 block leading-tight">
                  <span
                    className={`block text-[13px] font-semibold tracking-tight transition-colors ${
                      eAtivo ? "text-acc" : "text-ink-2 group-hover:text-ink"
                    }`}
                  >
                    Seção {s.numero}
                  </span>
                  <span
                    className={`block truncate text-[11.5px] transition-colors ${
                      eAtivo ? "text-ink-2" : "text-ink-3"
                    }`}
                  >
                    {s.titulo}
                  </span>
                </span>
                <div
                  ref={(el) => {
                    vagasRef.current[i] = el;
                  }}
                  className={`relative min-h-0 w-full flex-1 rounded-xl border transition-all duration-300 ${
                    eAtivo
                      ? "border-acc/60 bg-acc/[0.06]"
                      : "border-line-soft bg-panel/40 group-hover:border-line-strong"
                  }`}
                >
                  {/* Barra lateral de seleção — cresce a partir do centro. */}
                  <span
                    className={`absolute -left-[9px] top-1/2 w-[3px] -translate-y-1/2 rounded-full bg-acc transition-all duration-300 ${
                      eAtivo ? "h-8 opacity-100" : "h-0 opacity-0"
                    }`}
                  />
                </div>
              </motion.button>
            );
          })}
        </nav>

        <div ref={palcoRef} className="min-w-0 flex-1" />
      </div>

      {/*
        ---- camada das seções: absoluta, só transform ----
        Nada entra antes da medição. Montar com uma posição provisória obrigaria
        a animar a partir de um estado falso, e é exatamente o tipo de transição
        que pode nascer travada.
      */}
      <div className="pointer-events-none absolute inset-0">
        {geo &&
          secoes.map((s, i) => {
            const eAtivo = s.id === ativo;
            const alvo = destino(eAtivo ? geo.palco : (geo.vagas[i] ?? VAZIA));
            const realce = !eAtivo && pairado === s.id;
            if (!montadas.has(s.id)) return null;
            return (
              <div
                key={s.id}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: DESIGN_W,
                  height: DESIGN_H,
                  transformOrigin: "top left",
                  zIndex: eAtivo ? 20 : 10,
                  opacity: 1,
                  /*
                   * O realce do hover entra no mesmo transform do posicionamento,
                   * e não num wrapper à parte — uma transformação só evita duas
                   * animações disputando o mesmo elemento.
                   */
                  transform: `translate3d(${alvo.x}px, ${alvo.y}px, 0) scale(${
                    alvo.escala * (realce ? 1.045 : 1)
                  })`,
                  transition: `transform ${realce ? 260 : DUR_MOV}ms ${CURVA}, opacity ${DUR_VEU}ms ease-out`,
                  willChange: "transform",
                  // Só o palco recebe eventos; a miniatura repassa o clique ao botão.
                  pointerEvents: eAtivo ? "auto" : "none",
                }}
              >
                <div className="relative h-full w-full">
                  <ProvedorSecaoAtiva value={eAtivo}>
                    <SecaoOciosa ativo={eAtivo}>{s.conteudo}</SecaoOciosa>
                  </ProvedorSecaoAtiva>

                  {/*
                   * Véu das miniaturas: um overlay com opacidade animada, em vez de
                   * um filter CSS. Filter numa árvore desse tamanho força repintura
                   * a cada quadro e derruba a suavidade da transição.
                   */}
                  <div
                    className="pointer-events-none absolute inset-0 rounded-xl bg-background"
                    style={{
                      opacity: eAtivo ? 0 : realce ? 0.2 : 0.45,
                      transition: `opacity ${DUR_VEU}ms ease-out`,
                    }}
                  />
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
