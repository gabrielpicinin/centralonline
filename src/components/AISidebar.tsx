import { useState, useRef, useEffect } from "react";
import { Bot, Send, X, Sparkles, Key } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion, AnimatePresence } from "framer-motion";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

export function AISidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [apiKey, setApiKey] = useState<string>("");
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      role: "assistant",
      content:
        "Olá! Sou seu Assistente Financeiro IA. Posso ajudar com análises de dízimos, ofertas, metas e engajamento da membresia. Para ativar as respostas reais, insira sua chave da OpenAI no campo abaixo.",
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  const send = async () => {
    if (!input.trim()) return;
    const userMsg: Msg = { role: "user", content: input.trim() };
    setMsgs((m) => [...m, userMsg]);
    setInput("");
    setSending(true);

    // Mock response — real integration would call OpenAI with apiKey
    setTimeout(() => {
      const reply: Msg = {
        role: "assistant",
        content: apiKey
          ? `Análise sobre "${userMsg.content}": (integração com OpenAI seria executada aqui com sua chave). Recomendo cruzar a evolução acumulada com a meta proporcional ao dia atual do mês para entender o ritmo de arrecadação.`
          : `Recebi sua pergunta: "${userMsg.content}". Para gerar insights reais com IA, insira sua chave da OpenAI acima. Por enquanto, observe os KPIs de Ticket Médio e Taxa de Engajamento — eles indicam saúde financeira e participação ativa da membresia.`,
      };
      setMsgs((m) => [...m, reply]);
      setSending(false);
    }, 700);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ x: 400, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 400, opacity: 0 }}
          transition={{ type: "spring", damping: 26, stiffness: 220 }}
          className="fixed right-0 top-0 h-full w-full sm:w-[400px] bg-panel border-l border-line-soft shadow-panel-lg flex flex-col z-40"
        >
          <header className="flex items-center justify-between px-5 py-4 border-b border-line-soft bg-gradient-to-r from-[#151A23] to-[#1E2430] text-ink">
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-lg bg-acc/15 border border-acc/30 text-acc grid place-content-center">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold leading-tight">Assistente Financeiro IA</p>
                <p className="text-xs text-ink-3">Insights em tempo real</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="h-8 w-8 grid place-content-center rounded-md text-ink-2 hover:bg-white/10 hover:text-ink transition"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="px-4 py-3 border-b border-line-soft bg-panel-2/60">
            <div className="relative">
              <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-3" />
              <Input
                type="password"
                placeholder="OpenAI API Key (opcional)"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="h-9 pl-8 text-xs bg-panel-2 border-line-strong text-ink placeholder:text-ink-3 focus-visible:border-acc"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {msgs.map((m, i) => (
              <div key={i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : ""}`}>
                {m.role === "assistant" && (
                  <div className="h-7 w-7 rounded-full bg-acc/15 border border-acc/30 text-acc grid place-content-center shrink-0">
                    <Bot className="h-3.5 w-3.5" />
                  </div>
                )}
                <div
                  className={`rounded-2xl px-4 py-2.5 text-sm max-w-[80%] ${
                    m.role === "user"
                      ? "bg-acc text-background rounded-br-sm"
                      : "bg-panel-2 text-ink rounded-bl-sm"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex gap-2">
                <div className="h-7 w-7 rounded-full bg-acc/15 border border-acc/30 text-acc grid place-content-center shrink-0">
                  <Bot className="h-3.5 w-3.5" />
                </div>
                <div className="bg-panel-2 rounded-2xl px-4 py-3 text-sm text-ink-2">
                  <span className="inline-flex gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-ink-3 animate-bounce" />
                    <span className="h-1.5 w-1.5 rounded-full bg-ink-3 animate-bounce [animation-delay:0.15s]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-ink-3 animate-bounce [animation-delay:0.3s]" />
                  </span>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="p-4 border-t border-line-soft bg-panel flex gap-2"
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Pergunte sobre os dados..."
              className="h-11 bg-panel-2 border-line-strong text-ink placeholder:text-ink-3 focus-visible:border-acc"
              disabled={sending}
            />
            <Button
              type="submit"
              disabled={sending || !input.trim()}
              className="h-11 px-4 bg-acc text-background hover:brightness-110"
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
