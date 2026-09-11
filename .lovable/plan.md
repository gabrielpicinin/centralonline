## Problema

Os arquivos `FINANCEIRO (separado).csv` e `Membresia (separado).CSV` estão salvos em **Windows-1252** (padrão do Excel BR), com separador `;`. O parser atual (`parseFile` em `src/lib/parsers.ts`) passa o `File` direto para `Papa.parse`, que decodifica como UTF-8. Resultado: caracteres acentuados nos cabeçalhos viram `�`, o `pickKey` não encontra `Descrição CR. 1º Nível` / `Crédito 2` / `Débito 2`, todas as linhas ficam vazias e o `Upload.tsx` lança `"Base financeira vazia ou inválida"`.

## Solução

Ler o arquivo como `ArrayBuffer`, tentar decodificar como UTF-8 estrito; se falhar (BOM ausente + bytes inválidos / presença de `\uFFFD`), decodificar como `windows-1252`. Em seguida passar a string já decodificada para `Papa.parse`.

### Alterações (apenas em `src/lib/parsers.ts`)

1. Nova função utilitária `decodeBytes(buf: ArrayBuffer): string`:
   - Tenta `new TextDecoder("utf-8", { fatal: true }).decode(buf)`.
   - Em caso de exceção, usa `new TextDecoder("windows-1252").decode(buf)`.
   - Remove BOM inicial se existir.
2. Reescrever `parseFile` para CSVs:
   - `const buf = await file.arrayBuffer();`
   - `const text = decodeBytes(buf);`
   - `Papa.parse<RawRow>(text, { header: true, skipEmptyLines: true, delimiter: ";", ... })` (texto, não File; delimitador explícito `;` já que ambos os arquivos usam ponto-e-vírgula).
3. Manter o caminho XLSX inalterado (`XLSX.read` já trata encoding interno).

Nenhuma outra alteração de lógica de negócio — KPIs, donut, tabela de engajamento e metas continuam exatamente como estão.

## Verificação

Após a correção, reenviar os mesmos arquivos deve:

- Popular o filtro "Unidade" com todos os valores reais de `Descrição CR. 1º Nível` (Central Alphaville, Central Luxemburgo, etc.).
- Calcular `metaMensal ≈ R$ 6.347.583,33` e `metaAnual ≈ R$ 76.171.000,00`.
- Renderizar gráficos e donut sem erro.
