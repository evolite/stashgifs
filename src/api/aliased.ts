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
  const out: Array<Record<string, unknown>> = [];
  for (let start = 0; start < values.length; start += chunkSize) {
    const chunk = values.slice(start, start + chunkSize);
    const variables: Record<string, unknown> = {};
    const defs: string[] = [];
    const selections: string[] = [];
    chunk.forEach((value, i) => {
      variables[`v${i}`] = value;
      defs.push(`$v${i}: ${varType}`);
      for (const [alias, selection] of Object.entries(fields)) {
        selections.push(`${alias}${i}: ${selection.replaceAll('$v', `$v${i}`)}`);
      }
    });
    const data = (await exec(`query ${opName}(${defs.join(', ')}) { ${selections.join('\n')} }`, variables)) ?? {};
    chunk.forEach((_, i) => {
      const item: Record<string, unknown> = {};
      for (const alias of Object.keys(fields)) item[alias] = data[`${alias}${i}`];
      out.push(item);
    });
  }
  return out;
}
