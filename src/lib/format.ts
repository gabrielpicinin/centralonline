export const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const BRLcompact = (v: number) => {
  if (Math.abs(v) >= 1_000_000)
    return "R$ " + (v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "M";
  if (Math.abs(v) >= 1_000)
    return "R$ " + (v / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "k";
  return BRL.format(v);
};

export const fmtBRL = (v: number) => BRL.format(isFinite(v) ? v : 0);

export const fmtPct = (v: number, digits = 1) =>
  (isFinite(v) ? v : 0).toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }) + "%";

export const MESES = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];
