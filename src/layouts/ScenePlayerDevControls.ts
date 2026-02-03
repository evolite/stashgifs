type ScenePlayerPluginApi = {
  React?: {
    createElement: (...args: any[]) => unknown;
    Fragment?: unknown;
  };
  utils?: {
    InteractiveUtils?: {
      getPlayer?: () => any;
    };
  };
};

export function createScenePlayerDevControls(pluginApi: ScenePlayerPluginApi): unknown {
  const React = pluginApi.React;
  if (!React) {
    return null;
  }

  const controlsStyle = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '10px',
    padding: '12px 0',
    alignItems: 'center',
  } as const;

  const buttonStyle = {
    padding: '8px 14px',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    background: 'rgba(10, 12, 16, 0.7)',
    color: '#F2F6FA',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 600,
    letterSpacing: '0.02em',
    textTransform: 'uppercase',
  } as const;

  const labelStyle = {
    color: '#B4C0C9',
    fontSize: '12px',
    fontWeight: 500,
  } as const;

  const getPlayer = () => pluginApi.utils?.InteractiveUtils?.getPlayer?.();

  const handleTogglePlay = () => {
    const player = getPlayer();
    if (!player) return;
    if (player.paused?.()) {
      player.play?.();
      return;
    }
    player.pause?.();
  };

  const handleRestart = () => {
    const player = getPlayer();
    player?.currentTime?.(0);
  };

  const handleLogTime = () => {
    const player = getPlayer();
    const time = player?.currentTime?.();
    console.log('[ScenePlayer Dev] currentTime', time);
  };

  const handleMuteToggle = () => {
    const player = getPlayer();
    if (!player) return;
    const muted = player.muted?.();
    player.muted?.(!muted);
  };

  return React.createElement(
    'div',
    { style: controlsStyle },
    React.createElement('span', { style: labelStyle }, 'ScenePlayer Dev Controls'),
    React.createElement('button', { style: buttonStyle, onClick: handleTogglePlay }, 'Play/Pause'),
    React.createElement('button', { style: buttonStyle, onClick: handleRestart }, 'Restart'),
    React.createElement('button', { style: buttonStyle, onClick: handleMuteToggle }, 'Mute'),
    React.createElement('button', { style: buttonStyle, onClick: handleLogTime }, 'Log Time')
  );
}
