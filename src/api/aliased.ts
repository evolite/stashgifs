/**
 * Run the same GraphQL selection for many values in one request by aliasing it per value:
 *
 *   query Op($v0: ID!, $v1: ID!) { self0: findTags(ids: [$v0]) {...} self1: findTags(ids: [$v1]) {...} }
 *
 * `fields` maps an alias to a selection that references the value as `$v`; it is rewritten to
 * `$v<i>` per value. Returns one `{ alias: data }` object per input value, in input order.
 * Large inputs are split into chunks so a single query stays a reasonable size.
 */

export type AliasedExec = (query: string, variables: Record<string, unknown>) => Promise<Record<string, unknown> | undefined>;

export async function runAliased(
  exec: AliasedExec,
  opName: string,
  varType: string,
  values: readonly unknown[],
  fields: Record<string, string>,
  chunkSize = 50
): Promise<Array<Record<string, unknown>>> {
  const chunks: Array<readonly unknown[]> = [];
  for (let start = 0; start < values.length; start += chunkSize) chunks.push(values.slice(start, start + chunkSize));
  // Chunks are independent requests: run them together, keep input order.
  const rows = await Promise.all(chunks.map((chunk) => runChunk(exec, opName, varType, chunk, fields)));
  return rows.flat();
}

async function runChunk(
  exec: AliasedExec,
  opName: string,
  varType: string,
  chunk: readonly unknown[],
  fields: Record<string, string>
): Promise<Array<Record<string, unknown>>> {
  const variables: Record<string, unknown> = {};
  const defs: string[] = [];
  const selections: string[] = [];
  chunk.forEach((value, i) => {
    const name = `$v${i}`;
    variables[`v${i}`] = value;
    defs.push(`${name}: ${varType}`);
    for (const [alias, selection] of Object.entries(fields)) {
      selections.push(`${alias}${i}: ${selection.replaceAll('$v', name)}`);
    }
  });
  const query = `query ${opName}(${defs.join(', ')}) { ${selections.join('\n')} }`;
  const data = (await exec(query, variables)) ?? {};
  return chunk.map((_, i) => {
    const item: Record<string, unknown> = {};
    for (const alias of Object.keys(fields)) item[alias] = data[`${alias}${i}`];
    return item;
  });
}
