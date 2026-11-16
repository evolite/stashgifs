import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs, installBrowserStubs } from './helpers.mjs';

function keyEvent(key, extra = {}) {
  return {
    key,
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    defaultPrevented: false,
    target: null,
    prevented: false,
    preventDefault() { this.prevented = true; },
    ...extra,
  };
}

function recorder(result = true) {
  const calls = [];
  const record = (name) => (...args) => { calls.push([name, ...args]); return result; };
  const actions = {
    step: record('step'),
    seek: record('seek'),
    togglePlay: record('togglePlay'),
    toggleMute: record('toggleMute'),
    press: record('press'),
    rate: record('rate'),
    toggleHelp: record('toggleHelp'),
  };
  return { actions, calls };
}

describe('hotkeys', () => {
  let handleHotkey;
  let HOTKEYS;

  before(async () => {
    installBrowserStubs();
    globalThis.HTMLElement ??= class {};
    ({ handleHotkey, HOTKEYS } = await loadTs('src/Hotkeys.ts'));
  });

  it('routes each key to its action and suppresses the browser default when it acts', () => {
    const cases = [
      ['ArrowDown', ['step', 1]],
      [' ', ['step', 1]],
      ['ArrowUp', ['step', -1]],
      ['ArrowRight', ['seek', 1]],
      ['ArrowLeft', ['seek', -1]],
      ['k', ['togglePlay']],
      ['M', ['toggleMute']],
      ['f', ['press', 'favorite']],
      ['o', ['press', 'ocount']],
      ['b', ['press', 'bookmark']],
      ['0', ['rate', 0]],
      ['7', ['rate', 7]],
      ['Backspace', ['rate', 'clear']],
      ['?', ['toggleHelp']],
    ];
    for (const [key, expected] of cases) {
      const { actions, calls } = recorder();
      const event = keyEvent(key);
      handleHotkey(event, actions);
      assert.deepEqual(calls, [expected], key);
      assert.equal(event.prevented, true, `${key} prevents default`);
    }
  });

  it('leaves the browser default alone when the action declines', () => {
    const { actions } = recorder(false);
    const event = keyEvent('ArrowDown');
    handleHotkey(event, actions);
    assert.equal(event.prevented, false);
  });

  it('ignores modified keys, handled events, typing targets and unbound keys', () => {
    globalThis.HTMLElement = class { constructor(tagName) { this.tagName = tagName; this.isContentEditable = false; } };
    const ignored = [
      keyEvent('f', { ctrlKey: true }),
      keyEvent('f', { metaKey: true }),
      keyEvent('f', { altKey: true }),
      keyEvent('f', { defaultPrevented: true }),
      keyEvent('f', { target: new globalThis.HTMLElement('INPUT') }),
      keyEvent('z'),
    ];
    for (const event of ignored) {
      const { actions, calls } = recorder();
      handleHotkey(event, actions);
      assert.deepEqual(calls, [], JSON.stringify({ key: event.key, ctrl: event.ctrlKey }));
    }
  });

  it('repeats seeking and stepping while held, but not one-shot actions', () => {
    const held = recorder();
    handleHotkey(keyEvent('ArrowRight', { repeat: true }), held.actions);
    handleHotkey(keyEvent('ArrowDown', { repeat: true }), held.actions);
    handleHotkey(keyEvent('f', { repeat: true }), held.actions);
    handleHotkey(keyEvent('3', { repeat: true }), held.actions);
    assert.deepEqual(held.calls, [['seek', 1], ['step', 1]]);
  });

  it('binds every key at most once', () => {
    const keys = HOTKEYS.flatMap((h) => h.keys);
    assert.equal(new Set(keys).size, keys.length);
  });
});
