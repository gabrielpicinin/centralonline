/*
 * O teste da moeda de cada base.
 *
 * Duas promessas. Para o real, nada muda — nem um espaço: o formatador novo
 * tem de produzir exatamente o que os antigos produziam, e eles estão copiados
 * aqui, como eram no git, para servir de régua. Para o kwanza, o mesmo desenho
 * do real com "Kz" no lugar de "R$" — e nunca "R$", nem "AOA".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { moedaDe } from "../src/lib/format.ts";

/* ---- os formatadores antigos, copiados de src/lib/format.ts (48d2d94) ---- */
const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const BRLcompactAntigo = (v: number) => {
  if (Math.abs(v) >= 1_000_000)
    return "R$ " + (v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "M";
  if (Math.abs(v) >= 1_000)
    return "R$ " + (v / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "k";
  return BRL.format(v);
};
const fmtBRLAntigo = (v: number) => BRL.format(isFinite(v) ? v : 0);
/* -------------------------------------------------------------------------- */

const VALORES = [
  0,
  -0,
  0.5,
  1,
  9.99,
  999.994,
  999.995,
  1000,
  1234.56,
  -1234.5,
  99_999.9,
  1_000_000,
  1_234_567.891,
  -48_828_247.08,
  76_171_000,
  0.001,
  NaN,
  Infinity,
  -Infinity,
];

test("o real sai exatamente como antes, caractere por caractere", () => {
  const brasil = moedaDe("brasil");
  for (const v of VALORES) {
    assert.equal(brasil.formatar(v), fmtBRLAntigo(v), `formatar(${v})`);
    if (isFinite(v)) assert.equal(brasil.compacto(v), BRLcompactAntigo(v), `compacto(${v})`);
  }
  assert.equal(brasil.simbolo, "R$");
  assert.equal(brasil.nomePlural, "reais");
});

test("o kwanza tem o desenho do real, com Kz — nunca R$ nem AOA", () => {
  const angola = moedaDe("angola");
  assert.equal(angola.formatar(1_234_567.891), "Kz 1.234.567,89");
  assert.equal(angola.formatar(-1234.5), "-Kz 1.234,50");
  assert.equal(angola.compacto(1_500_000), "Kz 1,5M");
  assert.equal(angola.compacto(900_000), "Kz 900k");
  assert.equal(angola.simbolo, "Kz");
  assert.equal(angola.nomePlural, "kwanzas");
  for (const v of VALORES) {
    const texto = angola.formatar(v) + " " + (isFinite(v) ? angola.compacto(v) : "");
    assert.ok(!texto.includes("R$") && !texto.includes("AOA"), `${v} saiu como "${texto}"`);
  }
});
