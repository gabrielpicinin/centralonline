/*
 * Confere o ambiente ANTES do servidor começar a aceitar conexões.
 *
 * Por que isto existe como plugin do Nitro, e não junto do resto do código:
 * tudo o mais neste projeto é carregado por demanda. A entrada de SSR entra por
 * `defineLazyEventHandler`, e `banco.server.ts` só é importado quando alguém
 * chama uma função de servidor. O efeito é que uma variável faltando não
 * derruba a subida — ela derruba a primeira pessoa que usar o sistema.
 *
 * Medido no build de produção, com DADOS_DIR ausente: o serviço subiu, anunciou
 * "Listening on", respondeu 200 a um `curl` — e só quebrou quando um navegador
 * de verdade chamou a primeira função. Pior: o que aparecia na tela era o
 * LOGIN, não um erro. Ou seja, exatamente o sinal que o OPERACAO.md manda
 * investigar como "alguém chegou antes e criou a conta".
 *
 * Um serviço mal configurado precisa se recusar a subir. O PM2 mostra o
 * processo caindo, o TI vê na hora, e ninguém confunde configuração errada com
 * invasão.
 *
 * Plugins do Nitro rodam dentro de `useNitroApp()`, que o arquivo gerado chama
 * no escopo do módulo, antes de `serve()`. Lançar daqui impede a porta de
 * abrir.
 */

/*
 * Só em produção. Em desenvolvimento os padrões existem justamente para não
 * atrapalhar, e durante o `npm run build` o Nitro não executa plugins — eles
 * são código de runtime, empacotados para rodar no servidor.
 */
if (process.env.NODE_ENV === "production") {
  const faltando: string[] = [];

  if (!process.env.DADOS_DIR) {
    faltando.push(
      "DADOS_DIR — caminho absoluto da pasta do banco. Sem ela, o caminho sairia " +
        "do diretório de trabalho do serviço, que no PM2 não é a pasta do projeto: " +
        "foi assim que o servidor passou a usar um central.db que ninguém sabia qual era.",
    );
  }

  if (!process.env.SESSION_SECRET) {
    faltando.push(
      "SESSION_SECRET — chave que cifra o cookie de sessão, com 32 caracteres ou mais.",
    );
  } else if (process.env.SESSION_SECRET.length < 32) {
    faltando.push(
      `SESSION_SECRET — tem ${process.env.SESSION_SECRET.length} caracteres; o mínimo é 32.`,
    );
  }

  /*
   * HOST não entra como obrigatória, e é decisão consciente: sem ela o Nitro
   * escuta em todas as interfaces, o que é inseguro atrás de um proxy mas não é
   * inválido — há instalações em que é o que se quer. Avisar alto é melhor do
   * que recusar subir e deixar alguém sem saber por quê.
   */
  if (!process.env.HOST && !process.env.NITRO_HOST) {
    console.warn(
      "[ambiente] HOST não está definida: o servidor vai escutar em TODAS as " +
        "interfaces de rede. Atrás de um proxy reverso, isso deixa a aplicação " +
        "alcançável por fora dele, sem HTTPS. Defina HOST=127.0.0.1 no serviço.",
    );
  }

  if (faltando.length) {
    console.error(
      "\n[ambiente] O serviço não pode subir. Variáveis faltando ou inválidas:\n\n" +
        faltando.map((m) => `  • ${m}`).join("\n\n") +
        "\n\nDefina-as na configuração do serviço (PM2, systemd) e suba de novo." +
        "\nVer OPERACAO.md, seção de variáveis de ambiente.\n",
    );
    throw new Error("Configuração de ambiente incompleta");
  }
}

export default function conferirAmbiente() {
  // O trabalho é feito no escopo do módulo, acima, para falhar o mais cedo
  // possível — antes mesmo de o Nitro registrar este plugin.
}
