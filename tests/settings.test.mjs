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

it('persists short-form scope and playback switches and clears the selected tags', async () => {
  const api = fakeApi({});
  const settings = {
    shortFormTags: [{ id: '7', name: 'Short videos' }, { id: '9', name: 'Trailers' }],
    shortFormFolder: '/media/shorts',
    playMarkersToEnd: true,
    randomLongScenesOnly: true,
  };
  const manager = new PluginSettingsManager(api);
  manager.save({ settings });
  await manager.flush();
  assert.deepEqual(PluginSettingsManager.getLocalSettings().settings, settings);
  assert.deepEqual(api.saved[0].settings, settings);

  manager.save({ settings: { shortFormTags: [], shortFormFolder: '' } });
  await manager.flush();
  const reloaded = new PluginSettingsManager(fakeApi({ server: api.saved[1] }));
  assert.deepEqual((await reloaded.loadFromServer()).settings, { ...settings, shortFormTags: [], shortFormFolder: '' });
});

it('keeps the legacy short-form tag when loading local or server settings', async () => {
  const local = { id: '7', name: 'Short videos' };
  const server = { id: '9', name: 'Trailers' };
  store.set('stashgifs-settings', JSON.stringify({ shortFormTag: local }));
  assert.deepEqual(PluginSettingsManager.getLocalSettings().settings, { shortFormTags: [local] });

  const manager = new PluginSettingsManager(fakeApi({ server: { settings: { shortFormTag: server } } }));
  assert.deepEqual((await manager.loadFromServer()).settings, { shortFormTags: [server] });
  assert.deepEqual(PluginSettingsManager.getLocalSettings().settings, { shortFormTags: [server] });

  const cleared = new PluginSettingsManager(fakeApi({ server: { settings: { shortFormTag: server, shortFormTags: [] } } }));
  assert.deepEqual((await cleared.loadFromServer()).settings, { shortFormTags: [] });
});
