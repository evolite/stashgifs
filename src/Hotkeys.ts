import { isTypingTarget } from './utils.js';

export type PostButton = 'favorite' | 'ocount' | 'bookmark';

export interface HotkeyActions {
  step(direction: 1 | -1): boolean;
  seek(direction: 1 | -1): boolean;
  togglePlay(): boolean;
  toggleMute(): boolean;
  press(button: PostButton): boolean;
  rate(key: number | 'clear'): boolean;
  toggleHelp(): boolean;
}

export interface Hotkey {
  keys: readonly string[];
  display: string;
  label: string;
  repeat?: boolean;
  run(actions: HotkeyActions, key: string): boolean;
}

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

export const HOTKEYS: readonly Hotkey[] = [
  { keys: ['ArrowDown', 'PageDown', ' '], display: '↓ / Space', label: 'Next post', repeat: true, run: (a) => a.step(1) },
  { keys: ['ArrowUp', 'PageUp'], display: '↑', label: 'Previous post', repeat: true, run: (a) => a.step(-1) },
  { keys: ['ArrowRight'], display: '→', label: 'Seek forward', repeat: true, run: (a) => a.seek(1) },
  { keys: ['ArrowLeft'], display: '←', label: 'Seek back', repeat: true, run: (a) => a.seek(-1) },
  { keys: ['k'], display: 'K', label: 'Play / pause', run: (a) => a.togglePlay() },
  { keys: ['m'], display: 'M', label: 'Mute / unmute', run: (a) => a.toggleMute() },
  { keys: ['f'], display: 'F', label: 'Favorite', run: (a) => a.press('favorite') },
  { keys: ['o'], display: 'O', label: 'Add to o-count', run: (a) => a.press('ocount') },
  { keys: ['b'], display: 'B', label: 'Bookmark marker', run: (a) => a.press('bookmark') },
  { keys: DIGITS, display: '1-9, 0', label: 'Rate (0 = 10)', run: (a, key) => a.rate(Number(key)) },
  { keys: ['Backspace', 'Delete'], display: 'Backspace', label: 'Clear rating', run: (a) => a.rate('clear') },
  { keys: ['?'], display: '?', label: 'Show shortcuts', run: (a) => a.toggleHelp() },
];

function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

export function handleHotkey(event: KeyboardEvent, actions: HotkeyActions, table: readonly Hotkey[] = HOTKEYS): void {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
  if (isTypingTarget(event.target)) return;
  const key = normalizeKey(event.key);
  const hotkey = table.find((h) => h.keys.includes(key));
  if (!hotkey || (event.repeat && !hotkey.repeat)) return;
  if (hotkey.run(actions, key)) event.preventDefault();
}

let closeHelp: (() => void) | null = null;

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function toggleHotkeyHelp(table: readonly Hotkey[] = HOTKEYS): void {
  if (closeHelp) {
    closeHelp();
    return;
  }

  const card = el('div', 'whats-new hotkey-help');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'false');
  card.setAttribute('aria-label', 'Keyboard shortcuts');

  const header = el('div', 'whats-new__header');
  header.appendChild(el('div', 'whats-new__title', 'Keyboard shortcuts'));
  const x = el('button', 'whats-new__x', '×') as HTMLButtonElement;
  x.type = 'button';
  x.setAttribute('aria-label', 'Close');
  x.title = 'Close';
  header.appendChild(x);
  card.appendChild(header);

  const list = el('dl', 'whats-new__body hotkey-help__list');
  for (const hotkey of table) {
    const row = el('div', 'hotkey-help__row');
    const keys = el('dt', 'hotkey-help__keys');
    keys.appendChild(el('kbd', 'hotkey-help__kbd', hotkey.display));
    row.appendChild(keys);
    row.appendChild(el('dd', 'hotkey-help__label', hotkey.label));
    list.appendChild(row);
  }
  card.appendChild(list);

  const close = (): void => {
    document.removeEventListener('keydown', onKey);
    card.remove();
    closeHelp = null;
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  x.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.appendChild(card);
  closeHelp = close;
}
