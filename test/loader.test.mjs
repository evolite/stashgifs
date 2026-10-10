// Runnable check for stashgifs/stashgifs.mjs — no framework, run: node --test
// Guards the CodeQL js/xss-through-dom fix: the pluginPath (derived from a DOM
// script src) must reach the link via the href property, never via innerHTML.
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('nav button sets URL via href property, not innerHTML', async () => {
  const BASE = 'https://stash.example/stash';
  const SCRIPT_SRC = `${BASE}/plugin/stashgifs/assets/stashgifs.mjs`;

  const makeEl = () => ({
    id: '', className: '', target: '', href: '', innerHTML: '',
    dataset: {}, children: [],
    appendChild(c) { this.children.push(c); },
  });

  const navLink = makeEl();
  const container = makeEl();
  navLink.parentElement = container;

  let onDomReady;
  globalThis.window = {};
  globalThis.location = { origin: 'https://stash.example' };
  globalThis.MutationObserver = class { observe() {} };
  globalThis.document = {
    readyState: 'loading',
    body: makeEl(),
    addEventListener: (_evt, fn) => { onDomReady = fn; },
    getElementById: () => null,
    createElement: () => makeEl(),
    querySelectorAll: (sel) =>
      sel === 'script[src]' ? [{ src: SCRIPT_SRC }] :
      sel === '.nav-link' ? [navLink] : [],
  };

  await import('../stashgifs/stashgifs.mjs');
  onDomReady();

  const button = container.children[0];
  assert.ok(button, 'button appended to nav container');
  const link = button.children[0];
  assert.ok(link, 'link appended to button');
  assert.equal(link.href, `${BASE}/plugin/stashgifs/assets/app/`);
  assert.ok(!link.innerHTML.includes('stash.example'), 'innerHTML must not contain the URL');
  assert.ok(link.innerHTML.includes('GIFs'));
});
