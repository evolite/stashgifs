/**
 * "What's new" dialog: shown once after the plugin updates to a newer version.
 */

import { CHANGELOG, type ChangelogEntry } from './changelog.js';
import { VERSION } from './version.js';

const LAST_SEEN_KEY = 'stashgifs-last-seen-version';
const EARLIER_COUNT = 5;

const SECTION_LABELS: Record<string, string> = {
  Features: 'New',
  'Bug Fixes': 'Improved',
  Performance: 'Faster',
  Refactoring: 'Under the hood',
  Documentation: 'Docs',
};

function parseVersion(v: string): number[] {
  return v.split('.').map((n) => Number.parseInt(n, 10) || 0);
}

function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

function remember(): void {
  try { localStorage.setItem(LAST_SEEN_KEY, VERSION); } catch { /* ignore storage errors */ }
}

export function maybeShowWhatsNew(): void {
  let lastSeen: string | null = null;
  try { lastSeen = localStorage.getItem(LAST_SEEN_KEY); } catch { /* ignore storage errors */ }

  // Fresh install: nothing to announce, just start tracking.
  if (!lastSeen || compareVersions(lastSeen, VERSION) >= 0) {
    if (!lastSeen) remember();
    return;
  }

  const entries = CHANGELOG.filter(
    (e) => compareVersions(e.version, lastSeen) > 0 && compareVersions(e.version, VERSION) <= 0
  );
  if (entries.length === 0) {
    remember();
    return;
  }

  const card = el('div', 'whats-new');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', "What's new");

  const header = el('div', 'whats-new__header');
  const heading = el('div', 'whats-new__heading');
  heading.appendChild(el('div', 'whats-new__title', "What's new"));
  heading.appendChild(el('span', 'whats-new__badge', `v${VERSION}`));
  header.appendChild(heading);
  const x = el('button', 'whats-new__x', '\u00D7');
  (x as HTMLButtonElement).type = 'button';
  x.setAttribute('aria-label', 'Close');
  header.appendChild(x);
  card.appendChild(header);

  const body = el('div', 'whats-new__body');
  const renderEntry = (entry: ChangelogEntry, isEarlier = false): void => {
    const block = el('section', isEarlier ? 'whats-new__entry whats-new__entry--earlier' : 'whats-new__entry');
    const head = el('div', 'whats-new__entry-head');
    head.appendChild(el('span', 'whats-new__version', `v${entry.version}`));
    if (entry.date) head.appendChild(el('span', 'whats-new__date', entry.date));
    block.appendChild(head);
    for (const section of entry.sections) {
      block.appendChild(el('div', 'whats-new__section', SECTION_LABELS[section.title] ?? section.title));
      const list = el('ul', 'whats-new__list');
      for (const item of section.items) list.appendChild(el('li', '', item));
      block.appendChild(list);
    }
    body.appendChild(block);
  };
  for (const entry of entries) renderEntry(entry);

  // Context for what came before: the last few releases the user already had (CHANGELOG is newest first).
  const earlier = CHANGELOG.filter((e) => compareVersions(e.version, lastSeen) <= 0).slice(0, EARLIER_COUNT);
  if (earlier.length > 0) {
    body.appendChild(el('div', 'whats-new__divider', 'Earlier releases'));
    for (const entry of earlier) renderEntry(entry, true);
  }
  card.appendChild(body);

  const close = (): void => {
    document.removeEventListener('keydown', onKey);
    card.remove();
    remember();
  };
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };

  const button = el('button', 'whats-new__close', 'Got it');
  (button as HTMLButtonElement).type = 'button';
  button.addEventListener('click', close);
  x.addEventListener('click', close);
  card.appendChild(button);
  document.addEventListener('keydown', onKey);
  document.body.appendChild(card);
}
