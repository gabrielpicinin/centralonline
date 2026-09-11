import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown, Search } from "lucide-react";
import { ReactNode, useMemo, useState } from "react";
import { norm } from "@/lib/parsers";

interface MultiSelectProps {
  label?: string;
  icon?: ReactNode;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  allLabel?: string;
  /**
   * Rótulo para "nada selecionado", quando isso significa algo diferente de
   * "tudo".
   *
   * No cabeçalho do dashboard os dois casos são a mesma coisa — marcar todas as
   * unidades ou nenhuma quer dizer "sem filtro" —, e por isso o padrão é
   * mostrar allLabel nos dois. Na tela de permissões não: lá, nenhuma unidade
   * marcada quer dizer que o pastor não vê nada, e exibir o mesmo texto de
   * "todas" seria afirmar exatamente o contrário.
   */
  noneLabel?: string;
  triggerClassName?: string;
  popoverWidthClass?: string;
  formatItem?: (v: string) => string;
}

export function MultiSelect({
  label,
  icon,
  options,
  selected,
  onChange,
  allLabel = "Todos",
  noneLabel,
  triggerClassName = "",
  popoverWidthClass = "w-64",
  formatItem,
}: MultiSelectProps) {
  const [busca, setBusca] = useState("");

  const rotulo = (v: string) => (formatItem ? formatItem(v) : v);

  /*
   * A busca é sobre o texto exibido e ignora acento e caixa — quem procura
   * "gazofilacio" ou "PICOS" tem de achar do mesmo jeito.
   */
  const visiveis = useMemo(() => {
    const q = norm(busca);
    if (!q) return options;
    return options.filter((o) => norm(rotulo(o)).includes(q));
  }, [options, busca, formatItem]);

  const todosVisiveis = visiveis.length > 0 && visiveis.every((v) => selected.includes(v));

  /*
   * "Selecionar Tudo" age sobre o que está à vista: com uma busca ativa, marca
   * ou desmarca só o resultado dela, sem mexer no que ficou de fora.
   */
  const toggleAll = () => {
    if (todosVisiveis) {
      const fora = new Set(visiveis);
      onChange(selected.filter((s) => !fora.has(s)));
    } else {
      onChange(Array.from(new Set([...selected, ...visiveis])).sort());
    }
  };

  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v].sort());

  const triggerLabel =
    selected.length === 0 && noneLabel
      ? noneLabel
      : selected.length === 0 || selected.length === options.length
        ? allLabel
        : selected.length <= 2
          ? selected.map(rotulo).join(", ")
          : `${selected.length} selecionados`;

  return (
    <div className={triggerClassName}>
      {label && <label className="text-xs text-ink-3 mb-1 block">{label}</label>}
      <Popover onOpenChange={(aberto) => !aberto && setBusca("")}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="w-full inline-flex items-center justify-between gap-2 rounded-md border border-line-strong bg-panel-2 text-ink h-10 px-3 text-sm shadow-panel hover:border-acc transition"
          >
            <span className="flex items-center gap-2 truncate">
              {icon}
              <span className="truncate">{triggerLabel}</span>
            </span>
            <ChevronDown className="h-4 w-4 text-ink-3 shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className={`${popoverWidthClass} p-2 bg-panel-2 border-line-strong text-ink`}
        >
          {/* Busca por nome, acima do "Selecionar Tudo". */}
          <div className="relative mb-1.5">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar…"
              autoFocus
              className="w-full rounded-md border border-line-strong bg-panel py-1.5 pl-7 pr-2 text-sm text-ink placeholder:text-ink-3 focus:border-acc focus:outline-none"
            />
          </div>

          <label className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5 cursor-pointer text-sm border-b border-line-strong mb-1">
            <Checkbox checked={todosVisiveis} onCheckedChange={toggleAll} />
            <span className="font-medium">Selecionar Tudo</span>
          </label>
          <div className="max-h-64 overflow-y-auto">
            {visiveis.map((o) => {
              const checked = selected.includes(o);
              return (
                <label
                  key={o}
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5 cursor-pointer text-sm"
                >
                  <Checkbox checked={checked} onCheckedChange={() => toggle(o)} />
                  <span className="truncate">{rotulo(o)}</span>
                </label>
              );
            })}
            {visiveis.length === 0 && (
              <p className="px-2 py-3 text-center text-sm text-ink-3">Nada encontrado</p>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
