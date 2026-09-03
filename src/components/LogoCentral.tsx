/*
 * Marca da Central: um anel repartido — o "C" azul cobre a esquerda e dois
 * segmentos claros fecham a direita, com folga no topo, na base e às três horas.
 *
 * Proporções medidas no PNG original (823x882, centro ~(441,441), raio ~441):
 *  - a borda reta do azul, no topo, cai em x~388: um corte radial a 97 graus,
 *    e o mesmo espelhado embaixo, a -97;
 *  - o segmento claro de cima começa em x~500, ou seja, a 82 graus;
 *  - o miolo vazado tem raio ~266, 0,603 do externo — anel fino, não grosso.
 *
 * Os cantos são arredondados por um contorno da mesma cor com junção redonda,
 * em vez de ponta reta: é o que dá o aspecto macio do original. Como o contorno
 * engorda a forma em metade da espessura, os raios e os ângulos do caminho já
 * vêm descontados desse tanto — o resultado visual é exatamente 47 / 28,3.
 */

const AZUL = "#93C6E6";
const CLARO = "#EFEEEC";
const TRACO = 4;

const SEGMENTOS: { d: string; cor: string }[] = [
  // metade esquerda: o "C"
  {
    d: "M42.54 5.62A45 45 0 0 0 42.54 94.38L44.97 79.88A30.3 30.3 0 0 1 44.97 20.12Z",
    cor: AZUL,
  },
  // quadrante superior direito
  {
    d: "M89.53 28.50A45 45 0 0 0 58.24 5.76L55.55 20.21A30.3 30.3 0 0 1 76.62 35.52Z",
    cor: CLARO,
  },
  // quadrante inferior direito
  {
    d: "M58.24 94.24A45 45 0 0 0 89.53 71.50L76.62 64.48A30.3 30.3 0 0 1 55.55 79.79Z",
    cor: CLARO,
  },
];

export function LogoCentral({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label="Central"
      xmlns="http://www.w3.org/2000/svg"
    >
      {SEGMENTOS.map((s) => (
        <path
          key={s.d}
          d={s.d}
          fill={s.cor}
          stroke={s.cor}
          strokeWidth={TRACO}
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
