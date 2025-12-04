import type Player from 'xgplayer';

export const arrangeControlClusters = (player: Player | null) => {
  if (!player || !player.root) {
    return;
  }
  const root = player.root as HTMLElement;
  const run = () => {
    try {
      groupPrimaryControls(root);
      groupDanmuControls(root);
    } catch (error) {
      console.warn('[Player] Failed to arrange player controls:', error);
    }
  };
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(run);
  } else {
    run();
  }
};

export const groupPrimaryControls = (root: HTMLElement) => {
  const leftControls = root.querySelector('.xgplayer-controls-left');
  if (!leftControls) {
    return;
  }
  const playEl = leftControls.querySelector('.xgplayer-play');
  const refreshEl = leftControls.querySelector('.xgplayer-refresh-control');
  const volumeEl = leftControls.querySelector('.xgplayer-volume-control');
  if (!playEl && !refreshEl && !volumeEl) {
    return;
  }
  let cluster = leftControls.querySelector<HTMLElement>('.xgplayer-left-cluster');
  if (!cluster) {
    cluster = document.createElement('div');
    cluster.className = 'xgplayer-left-cluster';
    leftControls.insertBefore(cluster, leftControls.firstChild);
  }
  [playEl, refreshEl, volumeEl].forEach((element) => {
    if (element instanceof HTMLElement && element.parentElement !== cluster) {
      cluster?.appendChild(element);
    }
  });
};

export const groupDanmuControls = (root: HTMLElement) => {
  const rightControls = root.querySelector('.xgplayer-controls-right');
  if (!rightControls) {
    return;
  }
  const toggleEl = rightControls.querySelector('.xgplayer-danmu-toggle');
  const settingsEl = rightControls.querySelector('.xgplayer-danmu-settings');
  if (!(toggleEl instanceof HTMLElement) || !(settingsEl instanceof HTMLElement)) {
    return;
  }
  let cluster = rightControls.querySelector<HTMLElement>('.danmu-control-group');
  if (!cluster) {
    cluster = document.createElement('div');
    cluster.className = 'danmu-control-group';
    rightControls.insertBefore(cluster, toggleEl);
  }
  if (toggleEl.parentElement !== cluster) {
    cluster.appendChild(toggleEl);
  }
  if (settingsEl.parentElement !== cluster) {
    cluster.appendChild(settingsEl);
  }
};
