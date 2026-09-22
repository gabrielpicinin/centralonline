/*
 * Copiar texto para a área de transferência, e saber se deu certo.
 *
 * Existe por causa de um defeito silencioso que só aparece fora de HTTPS.
 *
 * `navigator.clipboard` só é definido em "contexto seguro" — HTTPS, ou
 * localhost. Em `http://fin.central.online` o objeto simplesmente não existe.
 * O código anterior era assim:
 *
 *     void navigator.clipboard?.writeText(senha);
 *     setCopiada(true);
 *
 * O `?.` engolia a ausência sem erro e o `setCopiada(true)` rodava do mesmo
 * jeito. O botão virava "Copiada ✓" com a área de transferência intacta. E o
 * texto logo acima do botão avisa que a senha não aparece de novo — então a
 * pessoa fechava o aviso confiando na marca verde, colava outra coisa no
 * WhatsApp, e a senha se perdia de vez.
 *
 * Duas regras saem disso, e a segunda importa mais que a primeira:
 *
 * 1. Tentar por um caminho que funcione em HTTP. `document.execCommand("copy")`
 *    é obsoleto e ainda é o único que roda fora de contexto seguro.
 *
 * 2. NUNCA confirmar o que não aconteceu. Toda função aqui devolve se a cópia
 *    de fato ocorreu, e quem chama é obrigado a olhar. Interface que mente
 *    sobre sucesso é pior que interface que falha: a falha a pessoa contorna,
 *    a mentira ela só descobre quando o dado já se perdeu.
 */

/** Caminho moderno. Só existe em HTTPS ou localhost. */
async function tentarApiModerna(texto: string): Promise<boolean> {
  if (!navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    // Pode falhar por permissão negada ou por a aba não estar em foco.
    return false;
  }
}

/*
 * Caminho antigo, para HTTP.
 *
 * `execCommand` copia o que estiver SELECIONADO na página, então é preciso um
 * elemento de verdade, visível ao navegador, com o texto dentro e selecionado.
 * Os ajustes de estilo abaixo existem para que ele não pisque na tela nem
 * empurre o layout durante os poucos milissegundos em que existe:
 * `position: fixed` o tira do fluxo, e a opacidade zero o esconde. Não se pode
 * usar `display: none` nem `visibility: hidden` — elemento assim não é
 * selecionável, e a cópia falharia.
 */
function tentarRecursoAntigo(texto: string): boolean {
  if (typeof document === "undefined") return false;

  const area = document.createElement("textarea");
  area.value = texto;
  area.setAttribute("readonly", "");
  area.setAttribute("aria-hidden", "true");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "0";
  area.style.opacity = "0";
  area.style.pointerEvents = "none";

  document.body.appendChild(area);
  try {
    area.select();
    area.setSelectionRange(0, texto.length);
    // Devolve false quando o navegador recusa — e há navegadores que devolvem
    // true sem copiar, por isso este é o caminho de último recurso e não o
    // primeiro.
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(area);
  }
}

/**
 * Tenta copiar. Devolve `true` só quando a cópia realmente aconteceu.
 *
 * Quem chama PRECISA tratar o `false` — é o caso do servidor em HTTP com um
 * navegador que também recusa o recurso antigo. A saída, aí, é pedir que a
 * pessoa selecione o texto na tela, que continua visível para isso.
 */
export async function copiarTexto(texto: string): Promise<boolean> {
  if (await tentarApiModerna(texto)) return true;
  return tentarRecursoAntigo(texto);
}
