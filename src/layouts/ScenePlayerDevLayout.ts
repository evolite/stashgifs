import { THEME } from '../utils.js';
import { createScenePlayerDevControls } from './ScenePlayerDevControls.js';

type ScenePlayerPluginApi = {
  React?: {
    createElement: (...args: any[]) => unknown;
    Fragment?: unknown;
  };
  patch?: {
    after: (name: string, callback: (...args: any[]) => unknown) => void;
  };
  utils?: {
    InteractiveUtils?: {
      getPlayer?: () => any;
    };
  };
};

type ScenePlayerDevWindow = Window & {
  PluginApi?: ScenePlayerPluginApi;
  stash?: ScenePlayerPluginApi;
  __stashgifsScenePlayerDevPatched?: boolean;
};

export class ScenePlayerDevLayout {
  private readonly container: HTMLElement;
  private readonly pluginApi?: ScenePlayerPluginApi;
  private layoutRoot?: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    const windowWithPluginApi = globalThis.window as ScenePlayerDevWindow;
    this.pluginApi = windowWithPluginApi.PluginApi || windowWithPluginApi.stash;
  }

  init(): void {
    this.container.innerHTML = '';
    this.layoutRoot = document.createElement('div');
    this.layoutRoot.style.maxWidth = '860px';
    this.layoutRoot.style.margin = '32px auto';
    this.layoutRoot.style.padding = '0 24px 80px';
    this.layoutRoot.style.display = 'flex';
    this.layoutRoot.style.flexDirection = 'column';
    this.layoutRoot.style.gap = '18px';

    const title = document.createElement('h2');
    title.textContent = 'ScenePlayer Dev Layout';
    title.style.margin = '0';
    title.style.fontSize = '24px';
    title.style.color = THEME.colors.textPrimary;
    title.style.fontWeight = THEME.typography.weightTitle;

    const description = document.createElement('p');
    description.textContent =
      'This layout patches Stash\'s ScenePlayer and injects a small control bar below the native player.';
    description.style.margin = '0';
    description.style.color = THEME.colors.textSecondary;
    description.style.fontSize = THEME.typography.sizeBody;
    description.style.lineHeight = THEME.typography.lineHeight;

    const statusCard = document.createElement('div');
    statusCard.style.border = `1px solid ${THEME.colors.border}`;
    statusCard.style.background = THEME.colors.surface;
    statusCard.style.borderRadius = THEME.radius.card;
    statusCard.style.padding = '16px';
    statusCard.style.display = 'flex';
    statusCard.style.flexDirection = 'column';
    statusCard.style.gap = '8px';

    const statusTitle = document.createElement('div');
    statusTitle.textContent = 'Status';
    statusTitle.style.fontWeight = THEME.typography.weightBodyStrong;
    statusTitle.style.color = THEME.colors.textPrimary;
    statusTitle.style.fontSize = THEME.typography.sizeBody;

    const statusBody = document.createElement('div');
    statusBody.style.color = THEME.colors.textSecondary;
    statusBody.style.fontSize = THEME.typography.sizeMeta;
    statusBody.textContent = this.pluginApi?.patch
      ? 'ScenePlayer patch installed. Open any scene to see the injected controls.'
      : 'PluginApi.patch not available. This layout requires the Stash UI plugin environment.';

    statusCard.appendChild(statusTitle);
    statusCard.appendChild(statusBody);

    const hint = document.createElement('div');
    hint.textContent =
      'Tip: open a Scene page in another tab to see the injected control bar under the player.';
    hint.style.color = THEME.colors.textMuted;
    hint.style.fontSize = THEME.typography.sizeMeta;

    this.layoutRoot.appendChild(title);
    this.layoutRoot.appendChild(description);
    this.layoutRoot.appendChild(statusCard);
    this.layoutRoot.appendChild(hint);
    this.container.appendChild(this.layoutRoot);

    this.patchScenePlayer();
  }

  private patchScenePlayer(): void {
    const windowWithPluginApi = globalThis.window as ScenePlayerDevWindow;
    if (!this.pluginApi?.patch?.after || !this.pluginApi.React) {
      return;
    }
    if (windowWithPluginApi.__stashgifsScenePlayerDevPatched) {
      return;
    }

    windowWithPluginApi.__stashgifsScenePlayerDevPatched = true;
    this.pluginApi.patch.after('ScenePlayer', (_props: unknown, rendered: unknown) => {
      const React = this.pluginApi?.React;
      if (!React) {
        return rendered;
      }

      const controls = createScenePlayerDevControls(this.pluginApi);
      return React.createElement(
        React.Fragment,
        null,
        rendered,
        React.createElement(
          'div',
          {
            style: {
              borderTop: '1px solid rgba(255, 255, 255, 0.12)',
              padding: '4px 12px 0',
              background: 'rgba(9, 12, 16, 0.65)',
            }
          },
          controls
        )
      );
    });
  }
}
