// Bundle a TypeScript entry with esbuild and import it, so offline checks run against src/
// without depending on the browser build output.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

export async function loadTs(entry) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(`../${entry}`, import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}
