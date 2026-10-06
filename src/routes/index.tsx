import { lazy, Suspense } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AppProvider, useApp } from "@/lib/appState";
import { Login } from "@/components/Login";
import { Upload } from "@/components/Upload";
import { EscolhaDeBase } from "@/components/EscolhaDeBase";

/*
 * O Dashboard entra sob demanda. Estático, ele arrastava o Recharts (~607 KB)
 * para o pacote inicial, baixado por quem ainda estava na tela de senha e nem
 * tinha uma base carregada. Login e Upload continuam diretos: são o caminho
 * obrigatório e leves.
 *
 * O download começa cedo — o Upload dispara o precarregar() assim que aparece —,
 * então quando o usuário termina de escolher os arquivos o código já chegou e o
 * fallback abaixo quase nunca é visto.
 */
const Dashboard = lazy(() =>
  import("@/components/Dashboard").then((m) => ({ default: m.Dashboard })),
);

export const Route = createFileRoute("/")({
  component: Index,
});

function Screen() {
  const { step, base } = useApp();
  if (step === "login") return <Login />;
  if (step === "escolha") return <EscolhaDeBase />;
  if (step === "upload") return <Upload />;
  return (
    <Suspense fallback={<TelaCarregando />}>
      {/*
       * Um dashboard por base, montado do zero na troca. Os filtros de uma base
       * não fazem sentido na outra — as unidades são outras, os anos podem ser
       * outros —, e a seção aberta no deck pode nem existir lá (Angola sem
       * meta não tem a Seção 4). Remontar é o jeito de nada sobrar da anterior.
       */}
      <Dashboard key={base ?? "nenhuma"} />
    </Suspense>
  );
}

/* Mesmo fundo do dashboard, para a troca não piscar branco. */
function TelaCarregando() {
  return (
    <div className="grid h-screen place-content-center bg-background">
      <p className="text-sm text-ink-2">Montando o dashboard…</p>
    </div>
  );
}

function Index() {
  return (
    <AppProvider>
      <Screen />
    </AppProvider>
  );
}
