import { parse } from '@babel/parser';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

export const ALLOWED = /^\s*(NOSONAR\b|fallow-ignore-)/;

const GENERATED = /^src\/((graphql|vendor)\/|version\.ts$|changelog\.ts$)/;
const CHECKED = /^(src\/.+\.ts|scripts\/.+\.(js|mjs)|tests\/.+\.mjs|scripts\/.+\.html|stashgifs\/app\/assets\/feed\.css)$/;

export function listFiles() {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((f) => CHECKED.test(f) && !GENERATED.test(f));
}

function scriptComments(text, offset, typescript) {
  const ast = parse(text, {
    sourceType: 'module',
    plugins: typescript ? ['typescript'] : [],
    allowReturnOutsideFunction: true,
  });
  return ast.comments.map((c) => ({ start: c.start + offset, end: c.end + offset, value: c.value }));
}

function cssComments(text) {
  const found = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      i++;
      while (i < text.length && text[i] !== ch) i += text[i] === '\\' ? 2 : 1;
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2) + 2;
      found.push({ start: i, end, value: text.slice(i + 2, end - 2) });
      i = end - 1;
    }
  }
  return found;
}

function htmlComments(text) {
  const found = [];
  for (const m of text.matchAll(/<!--([\s\S]*?)-->/g)) {
    found.push({ start: m.index, end: m.index + m[0].length, value: m[1] });
  }
  for (const m of text.matchAll(/(<script(?![^>]*\bsrc=)[^>]*>)([\s\S]*?)<\/script>/g)) {
    found.push(...scriptComments(m[2], m.index + m[1].length, false));
  }
  return found;
}

export function findComments(file, text) {
  if (file.endsWith('.css')) return cssComments(text);
  if (file.endsWith('.html')) return htmlComments(text);
  return scriptComments(text, 0, file.endsWith('.ts'));
}

function fillsEmptyBlock(masked, c) {
  return masked.slice(0, c.start).trimEnd().endsWith('{') && masked.slice(c.end).trimStart().startsWith('}');
}

export function disallowedComments(file, text) {
  const comments = findComments(file, text);
  let masked = text;
  for (const c of comments) masked = masked.slice(0, c.start) + ' '.repeat(c.end - c.start) + masked.slice(c.end);
  return comments.filter((c) => !ALLOWED.test(c.value) && !fillsEmptyBlock(masked, c));
}

function lineStart(text, pos) {
  return text.lastIndexOf('\n', pos - 1) + 1;
}

function lineEnd(text, pos) {
  const end = text.indexOf('\n', pos);
  return end === -1 ? text.length : end;
}

export function stripComments(text, comments) {
  let out = text;
  for (const c of [...comments].sort((a, b) => b.start - a.start)) {
    const ls = lineStart(out, c.start);
    const le = lineEnd(out, c.end);
    const before = out.slice(ls, c.start);
    const after = out.slice(c.end, le);
    if (!before.trim() && !after.trim()) {
      out = out.slice(0, ls) + out.slice(Math.min(le + 1, out.length));
    } else if (!after.trim()) {
      out = out.slice(0, c.start).replace(/[ \t]+$/, '') + out.slice(c.end);
    } else {
      out = out.slice(0, c.start) + out.slice(c.end).replace(/^[ \t]+/, before.trim() ? ' ' : '');
    }
  }
  return out;
}

function lineOf(text, pos) {
  return text.slice(0, pos).split('\n').length;
}

function main() {
  const fix = process.argv.includes('--fix');
  let total = 0;
  for (const file of listFiles()) {
    const path = `${ROOT}${file}`;
    const text = readFileSync(path, 'utf8');
    const bad = disallowedComments(file, text);
    if (bad.length === 0) continue;
    total += bad.length;
    if (fix) {
      writeFileSync(path, stripComments(text, bad));
    } else {
      for (const c of bad) console.log(`${file}:${lineOf(text, c.start)}  ${c.value.trim().split('\n')[0].slice(0, 80)}`);
    }
  }
  console.log(fix ? `Removed ${total} comment(s).` : `${total} comment(s) found.`);
  if (!fix && total > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
