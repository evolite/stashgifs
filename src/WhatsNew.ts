/**
 * "What's new" dialog: shown once after the plugin updates to a newer version.
 */

import { CHANGELOG } from './changelog.js';
import { VERSION } from './version.js';

const LAST_SEEN_KEY = 'stashgifs-last-seen-version';

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

  const overlay = el('div', 'whats-new');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  const card = el('div', 'whats-new__card');
  card.appendChild(el('h2', 'whats-new__title', `What's new in v${VERSION}`));

  const body = el('div', 'whats-new__body');
  for (const entry of entries) {
    if (entries.length > 1) body.appendChild(el('h3', 'whats-new__version', `v${entry.version}`));
    for (const section of entry.sections) {
      body.appendChild(el('h4', 'whats-new__section', section.title));
      const list = el('ul', 'whats-new__list');
      for (const item of section.items) list.appendChild(el('li', '', item));
      body.appendChild(list);
    }
  }
  card.appendChild(body);

  const close = (): void => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    remember();
  };
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };

  const button = el('button', 'whats-new__close', 'Got it');
  (button as HTMLButtonElement).type = 'button';
  button.addEventListener('click', close);
  card.appendChild(button);
  overlay.appendChild(card);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
}
