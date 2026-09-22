/*
 * De onde veio a requisição — para efeito do freio de força bruta do login.
 *
 * Fica num arquivo separado, e puro, para que o teste consiga alcançá-lo: em
 * gate.functions.ts esta lógica estaria presa atrás de `createServerFn` e do
 * acesso à requisição, e só daria para exercitá-la subindo um servidor. Aqui é
 * texto entra, texto sai.
 *
 * ======================================================================
 * O DEFEITO QUE ISTO CORRIGE
 * ======================================================================
 *
 * A versão anterior era assim:
 *
 *     req.headers.get("cf-connecting-ip")
 *       ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim()
 *       ?? "desconhecido"
 *
 * Os dois valores eram escolhidos pelo cliente, e o freio não existia.
 *
 * `cf-connecting-ip` é um cabeçalho da Cloudflare. Não há Cloudflare nesta
 * implantação — então ninguém o define a não ser quem envia a requisição, e ele
 * tinha PRECEDÊNCIA sobre todo o resto. Bastava inventar um valor novo a cada
 * tentativa para nunca cair no mesmo balde.
 *
 * O `x-forwarded-for` tinha o mesmo problema por outro caminho. A documentação
 * do mod_proxy do Apache diz que os cabeçalhos "will contain more than one
 * (comma-separated) value if the original request already contained one of
 * these headers" — ou seja, o Apache ACRESCENTA, não substitui. Um cliente que
 * mande `X-Forwarded-For: 9.9.9.9` faz o servidor receber
 * `9.9.9.9, <ip real>`, e o `[0]` pegava justamente a parte inventada.
 *
 * ======================================================================
 * POR QUE O ÚLTIMO ELEMENTO
 * ======================================================================
 *
 * Porque é o único que o cliente não consegue escolher. O Apache acrescenta a
 * SUA observação no fim da lista, sempre depois do que veio de fora. Por mais
 * valores que alguém empilhe na frente, o último continua sendo o que o proxy
 * viu — o endereço real de quem abriu a conexão com ele.
 *
 * Isto vale para a topologia desta implantação: UM proxy, o Apache, entre a
 * rede e a aplicação. Se um dia entrar outro intermediário entre os dois, o
 * último elemento passa a ser o endereço desse intermediário, e todo mundo cai
 * no mesmo balde — o freio fica mais rígido do que deveria, mas não deixa de
 * existir. Se isso acontecer, o ajuste é contar quantos saltos confiáveis há e
 * pegar o n-ésimo de trás para frente.
 *
 * Não se usa o endereço de quem abriu a conexão TCP porque a aplicação só
 * escuta em 127.0.0.1: para ela, todo mundo é o Apache.
 *
 * ======================================================================
 * "desconhecido" CONTINUA SENDO A SAÍDA
 * ======================================================================
 *
 * Quando não há cabeçalho nenhum — acesso direto à porta, ou proxy sem
 * `ProxyAddHeaders` —, todas as tentativas compartilham um balde só. É pior do
 * que distinguir origens, e é deliberado: o atraso é progressivo e para em 5
 * segundos, então o pior caso é todo mundo esperando um pouco, nunca alguém
 * trancado para fora. Ver o comentário do freio em gate.functions.ts.
 */

/**
 * Deriva o balde do freio a partir do `x-forwarded-for` recebido.
 *
 * Recebe o valor bruto do cabeçalho — quem chama não precisa saber de nada
 * disso.
 */
export function origemDaRequisicao(xForwardedFor: string | null | undefined): string {
  if (!xForwardedFor) return "desconhecido";

  const partes = xForwardedFor
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  // O que o Apache acrescentou. Ver a explicação acima.
  const ultimo = partes[partes.length - 1];
  return ultimo || "desconhecido";
}
