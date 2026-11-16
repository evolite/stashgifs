import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { listFiles, disallowedComments, stripComments } from '../scripts/comments.mjs';

describe('no comments', () => {
  it('source files carry only tool directives and empty-block markers', () => {
    const found = listFiles().flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return disallowedComments(file, text).map((c) => `${file}:${text.slice(0, c.start).split('\n').length}`);
    });
    assert.deepEqual(found, [], `Remove these comments (or run: node scripts/comments.mjs --fix):\n${found.join('\n')}`);
  });

  it('flags prose comments but keeps directives and empty-block markers', () => {
    const source = [
      '// prose',
      'const a = 1; // trailing',
      'const url = "http://x/*not*/";',
      'const t = `// not a comment`;',
      'try { a; } catch { /* ignored */ }',
      'run(); // NOSONAR: deliberate',
      '// fallow-ignore-next-line unused-class-member',
      '/** doc */',
      'export { a, url, t };',
      '',
    ].join('\n');
    const bad = disallowedComments('src/x.ts', source).map((c) => c.value.trim());
    assert.deepEqual(bad, ['prose', 'trailing', '* doc']);
    assert.equal(
      stripComments(source, disallowedComments('src/x.ts', source)),
      source.replace('// prose\n', '').replace(' // trailing', '').replace('/** doc */\n', ''),
    );
  });

  it('finds comments in CSS and HTML without touching strings', () => {
    assert.deepEqual(disallowedComments('a.css', 'a { content: "/* no */"; } /* yes */').map((c) => c.value), [' yes ']);
    assert.deepEqual(
      disallowedComments('scripts/a.html', '<!-- yes --><script>let x = 1; // inline</script><script src="a.js"></script>').map((c) => c.value.trim()),
      ['yes', 'inline'],
    );
  });
});
