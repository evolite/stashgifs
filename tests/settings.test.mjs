import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs, installBrowserStubs } from './helpers.mjs';

let store;
beforeEach(() => { store = installBrowserStubs(); });

const { PluginSettingsManager } = await loadTs('src/PluginSettingsManager.ts');

function fakeApi({ server }) {
  return {
    saved: [],
    getPluginSettings: async () => { if (server instanceof Error) throw server; return server; },
    savePluginSettings: async function (_id, input) { this.saved.push(input); return true; },
  };
}

describe('PluginSettingsManager.loadFromServer', () => {
  it('keeps local settings and writes nothing when the server request fails', async () => {
    store.set('stashgifs-settings', JSON.stringify({ cardMaxWidth: 640 }));
    const api = fakeApi({ server: new Error('down') });
    const manager = new PluginSettingsManager(api);

    const data = await manager.loadFromServer();

    assert.equal(data.settings.cardMaxWidth, 640);
    assert.equal(api.saved.length, 0, 'a failed read must never overwrite the server copy');
  });

  it('pushes local settings to a server that has none yet', async () => {
    store.set('stashgifs-settings', JSON.stringify({ cardMaxWidth: 640 }));
    const api = fakeApi({ server: null });
    await new PluginSettingsManager(api).loadFromServer();
    assert.equal(api.saved.length, 1);
  });
});
