import Plugin, { POSITIONS } from 'xgplayer/es/plugin/plugin.js';

import {
  DANMU_OPACITY_MAX,
  DANMU_OPACITY_MIN,
  ICONS,
  sanitizeDanmuArea,
  sanitizeDanmuOpacity,
} from './constants';
import type { DanmuUserSettings } from './constants';

export class DanmuToggleControl extends Plugin {
  static override pluginName = 'danmuToggle';
  static override defaultConfig = {
    position: POSITIONS.CONTROLS_RIGHT,
    index: 4,
    disable: false,
    getState: (() => true) as () => boolean,
    onToggle: (async (_value: boolean) => {}) as (value: boolean) => Promise<void> | void,
  };

  private handleClick: ((event: Event) => void) | null = null;
  private isActive = true;

  override afterCreate() {
    if (this.config.disable) {
      return;
    }
    this.isActive = typeof this.config.getState === 'function' ? !!this.config.getState() : true;
    this.updateState();
    this.handleClick = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      this.toggle();
    };
    this.bind(['click', 'touchend'], this.handleClick);
  }

  override destroy() {
    if (this.handleClick) {
      this.unbind(['click', 'touchend'], this.handleClick);
      this.handleClick = null;
    }
  }

  override render() {
    if (this.config.disable) {
      return '';
    }
    return `<xg-icon class="xgplayer-danmu-toggle" title="" role="button" aria-pressed="${this.isActive}">
      <span class="danmu-toggle-label">弹幕</span>
      <span class="danmu-toggle-switch">
        <span class="switch-track"></span>
        <span class="switch-thumb"></span>
      </span>
    </xg-icon>`;
  }

  private toggle() {
    this.isActive = !this.isActive;
    this.updateState();
    const callback = this.config.onToggle;
    if (typeof callback === 'function') {
      callback(this.isActive);
    }
  }

  private updateState() {
    const root = this.root as HTMLElement | null;
    if (!root) {
      return;
    }
    root.classList.toggle('is-off', !this.isActive);
    root.setAttribute('aria-pressed', this.isActive ? 'true' : 'false');
  }

  setState(isActive: boolean) {
    this.isActive = isActive;
    this.updateState();
  }
}

export class DanmuSettingsControl extends Plugin {
  static override pluginName = 'danmuSettings';
  static override defaultConfig = {
    position: POSITIONS.CONTROLS_RIGHT,
    index: 4,
    disable: false,
    getSettings: (() => ({
      color: '#ffffff',
      strokeColor: '#444444',
      fontSize: '20px',
      duration: 10000,
      area: 0.5,
      mode: 'scroll',
      opacity: 1,
    })) as () => DanmuUserSettings,
    onChange: (async (_partial: Partial<DanmuUserSettings>) => {}) as (partial: Partial<DanmuUserSettings>) => Promise<void> | void,
  };

  private panel: HTMLElement | null = null;
  private handleToggle: ((event: Event) => void) | null = null;
  private handleDocumentClick: ((event: MouseEvent) => void) | null = null;
  private handleHoverEnter: ((event: Event) => void) | null = null;
  private handleHoverLeave: ((event: Event) => void) | null = null;
  private hoverCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private isOpen = false;
  private currentSettings: DanmuUserSettings = {
    color: '#ffffff',
    strokeColor: '#444444',
    fontSize: '20px',
    duration: 10000,
    area: 0.5,
    mode: 'scroll',
    opacity: 1,
  };
  private textColorInput: HTMLInputElement | null = null;
  private strokeColorInput: HTMLInputElement | null = null;
  private fontSizeSlider: HTMLInputElement | null = null;
  private durationSlider: HTMLInputElement | null = null;
  private areaSlider: HTMLInputElement | null = null;
  private opacitySlider: HTMLInputElement | null = null;

  override afterCreate() {
    if (this.config.disable) {
      return;
    }
    this.currentSettings = typeof this.config.getSettings === 'function'
      ? this.config.getSettings()
      : this.currentSettings;
    this.currentSettings.area = sanitizeDanmuArea(this.currentSettings.area);
    this.currentSettings.opacity = sanitizeDanmuOpacity(this.currentSettings.opacity);
    if (typeof this.currentSettings.strokeColor !== 'string') {
      this.currentSettings.strokeColor = '#444444';
    }

    this.createPanel();
    this.updateInputs();

    this.handleToggle = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      this.togglePanel();
    };

    this.bind(['click', 'touchend'], this.handleToggle);

    if (typeof document !== 'undefined') {
      this.handleDocumentClick = (event: MouseEvent) => {
        if (!this.root.contains(event.target as Node)) {
          this.closePanel();
        }
      };
      document.addEventListener('click', this.handleDocumentClick);
    }

    this.handleHoverEnter = () => {
      if (this.hoverCloseTimer) {
        clearTimeout(this.hoverCloseTimer);
        this.hoverCloseTimer = null;
      }
      this.openPanel();
    };
    this.handleHoverLeave = () => {
      if (this.hoverCloseTimer) {
        clearTimeout(this.hoverCloseTimer);
      }
      this.hoverCloseTimer = setTimeout(() => {
        this.hoverCloseTimer = null;
        this.closePanel();
      }, 220);
    };
    this.bind('mouseenter', this.handleHoverEnter);
    this.bind('mouseleave', this.handleHoverLeave);
  }

  override destroy() {
    if (this.handleToggle) {
      this.unbind(['click', 'touchend'], this.handleToggle);
      this.handleToggle = null;
    }
    if (this.handleDocumentClick) {
      document.removeEventListener('click', this.handleDocumentClick);
      this.handleDocumentClick = null;
    }
    if (this.handleHoverEnter) {
      this.unbind('mouseenter', this.handleHoverEnter);
      this.handleHoverEnter = null;
    }
    if (this.handleHoverLeave) {
      this.unbind('mouseleave', this.handleHoverLeave);
      this.handleHoverLeave = null;
    }
    if (this.hoverCloseTimer) {
      clearTimeout(this.hoverCloseTimer);
      this.hoverCloseTimer = null;
    }
    (this.root as HTMLElement | null)?.classList.remove('menu-open');
    this.panel?.remove();
    this.panel = null;
    this.textColorInput = null;
    this.strokeColorInput = null;
    this.fontSizeSlider = null;
    this.durationSlider = null;
    this.areaSlider = null;
    this.opacitySlider = null;
  }

  override render() {
    if (this.config.disable) {
      return '';
    }
    return `<xg-icon class="xgplayer-danmu-settings" title="">
      ${ICONS.cog}
    </xg-icon>`;
  }

  private createPanel() {
    this.panel = document.createElement('div');
    this.panel.className = 'xgplayer-danmu-settings-panel';
    this.panel.innerHTML = `
      <div class="settings-shell">
        <div class="settings-body">
          <div class="settings-row settings-row-color">
            <span class="settings-label">颜色</span>
            <input class="danmu-setting-color" type="color" value="${this.currentSettings.color}">
          </div>
          <div class="settings-row settings-row-color">
            <span class="settings-label">描边</span>
            <input class="danmu-setting-stroke-color" type="color" value="${this.currentSettings.strokeColor}">
          </div>
          <div class="settings-row">
            <label>字体 <span class="settings-value font-size-value">${this.currentSettings.fontSize}</span></label>
            <input class="danmu-setting-font-range" type="range" min="14" max="30" step="2" value="${parseInt(this.currentSettings.fontSize, 10)}">
          </div>
          <div class="settings-row">
            <label>速度 <span class="settings-value speed-value">${this.formatDurationLabel(this.currentSettings.duration)}</span></label>
            <input class="danmu-setting-duration-range" type="range" min="3000" max="20000" step="500" value="${this.currentSettings.duration}">
          </div>
          <div class="settings-row">
            <label>显示区域 <span class="settings-value area-value">${this.formatAreaLabel(this.currentSettings.area)}</span></label>
            <input class="danmu-setting-area-range" type="range" min="0.25" max="0.75" step="0.25" value="${this.currentSettings.area}">
          </div>
          <div class="settings-row">
            <label>透明度 <span class="settings-value opacity-value">${this.formatOpacityLabel(this.currentSettings.opacity)}</span></label>
            <input class="danmu-setting-opacity-range" type="range" min="${DANMU_OPACITY_MIN}" max="${DANMU_OPACITY_MAX}" step="0.05" value="${this.currentSettings.opacity}">
          </div>
        </div>
      </div>
    `;
    this.root.appendChild(this.panel);

    this.panel.addEventListener('click', (event) => {
      event.stopPropagation();
    });
    this.panel.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
    });
    this.panel.addEventListener('mousedown', (event) => {
      event.stopPropagation();
    });

    this.textColorInput = this.panel.querySelector<HTMLInputElement>('.danmu-setting-color');
    this.strokeColorInput = this.panel.querySelector<HTMLInputElement>('.danmu-setting-stroke-color');
    this.fontSizeSlider = this.panel.querySelector<HTMLInputElement>('.danmu-setting-font-range');
    this.durationSlider = this.panel.querySelector<HTMLInputElement>('.danmu-setting-duration-range');
    this.areaSlider = this.panel.querySelector<HTMLInputElement>('.danmu-setting-area-range');
    this.opacitySlider = this.panel.querySelector<HTMLInputElement>('.danmu-setting-opacity-range');

    this.textColorInput?.addEventListener('input', (event) => {
      const value = (event.target as HTMLInputElement).value;
      this.currentSettings.color = value;
      this.emitChange({ color: value });
    });
    this.strokeColorInput?.addEventListener('input', (event) => {
      const value = (event.target as HTMLInputElement).value;
      this.currentSettings.strokeColor = value;
      this.emitChange({ strokeColor: value });
    });

    const handleRange = (
      el: HTMLInputElement | null,
      key: keyof DanmuUserSettings,
      transform: (value: string) => unknown,
      displaySelector: string,
      formatter: (value: number) => string,
    ) => {
      const updateDisplay = (value: number) => {
        const label = this.panel?.querySelector<HTMLSpanElement>(displaySelector);
        if (label) {
          label.textContent = formatter(value);
        }
      };
      el?.addEventListener('input', (event) => {
        const rawValue = (event.target as HTMLInputElement).value;
        const numericValue = Number(rawValue);
        updateDisplay(numericValue);
        const nextValue = transform(rawValue);
        (this.currentSettings as Record<string, unknown>)[key as string] = nextValue;
        this.emitChange({ [key]: nextValue } as Partial<DanmuUserSettings>);
        this.updateSliderVisual(el);
      });
      if (el) {
        updateDisplay(Number(el.value));
        this.updateSliderVisual(el);
      }
    };

    handleRange(
      this.fontSizeSlider,
      'fontSize',
      (value) => `${Math.min(30, Math.max(14, Number(value)))}px`,
      '.font-size-value',
      (value) => `${Math.min(30, Math.max(14, value))}px`,
    );

    handleRange(
      this.durationSlider,
      'duration',
      (value) => {
        const numeric = Number(value);
        const clamped = Number.isFinite(numeric) ? Math.min(20000, Math.max(3000, numeric)) : 10000;
        return clamped;
      },
      '.speed-value',
      (value) => this.formatDurationLabel(value),
    );

    handleRange(
      this.areaSlider,
      'area',
      (value) => {
        const numeric = Number(value);
        return sanitizeDanmuArea(numeric);
      },
      '.area-value',
      (value) => this.formatAreaLabel(value),
    );

    handleRange(
      this.opacitySlider,
      'opacity',
      (value) => sanitizeDanmuOpacity(Number(value)),
      '.opacity-value',
      (value) => this.formatOpacityLabel(value),
    );
  }

  private updateSliderVisual(el: HTMLInputElement | null) {
    if (!el) {
      return;
    }
    const min = Number(el.min) || 0;
    const max = Number(el.max) || 100;
    const value = Number(el.value);
    const clamped = Math.min(max, Math.max(min, value));
    const percent = max === min ? 0 : ((clamped - min) / (max - min)) * 100;
    el.style.background = `linear-gradient(90deg, var(--player-accent) ${percent}%, rgba(255, 255, 255, 0.15) ${percent}%)`;
  }

  private togglePanel() {
    if (this.isOpen) {
      this.closePanel();
    } else {
      this.openPanel();
    }
  }

  private openPanel() {
    if (!this.panel || this.isOpen) {
      return;
    }
    if (this.hoverCloseTimer) {
      clearTimeout(this.hoverCloseTimer);
      this.hoverCloseTimer = null;
    }
    this.isOpen = true;
    this.panel.classList.add('show');
    this.root.classList.add('menu-open');
    this.updateInputs();
  }

  private closePanel() {
    if (!this.panel) {
      return;
    }
    if (this.hoverCloseTimer) {
      clearTimeout(this.hoverCloseTimer);
      this.hoverCloseTimer = null;
    }
    this.isOpen = false;
    this.panel.classList.remove('show');
    this.root.classList.remove('menu-open');
  }

  private updateInputs() {
    if (!this.panel) {
      return;
    }
    if (this.textColorInput) {
      this.textColorInput.value = this.currentSettings.color;
    }
    if (this.strokeColorInput) {
      this.strokeColorInput.value = this.currentSettings.strokeColor;
    }
    if (this.fontSizeSlider) {
      const numericFont = parseInt(this.currentSettings.fontSize, 10);
      this.fontSizeSlider.value = String(Math.min(30, Math.max(14, numericFont)));
      const fontLabel = this.panel.querySelector<HTMLSpanElement>('.font-size-value');
      if (fontLabel) {
        fontLabel.textContent = `${Math.min(30, Math.max(14, numericFont))}px`;
      }
      this.updateSliderVisual(this.fontSizeSlider);
    }
    if (this.durationSlider) {
      const durationValue = Math.min(20000, Math.max(3000, this.currentSettings.duration));
      this.durationSlider.value = String(durationValue);
      const speedLabel = this.panel.querySelector<HTMLSpanElement>('.speed-value');
      if (speedLabel) {
        speedLabel.textContent = this.formatDurationLabel(durationValue);
      }
      this.updateSliderVisual(this.durationSlider);
    }
    if (this.areaSlider) {
      const areaValue = sanitizeDanmuArea(this.currentSettings.area);
      this.areaSlider.value = String(areaValue);
      const areaLabel = this.panel.querySelector<HTMLSpanElement>('.area-value');
      if (areaLabel) {
        areaLabel.textContent = this.formatAreaLabel(areaValue);
      }
      this.updateSliderVisual(this.areaSlider);
    }
    if (this.opacitySlider) {
      const opacityValue = sanitizeDanmuOpacity(this.currentSettings.opacity);
      this.opacitySlider.value = String(opacityValue);
      const opacityLabel = this.panel.querySelector<HTMLSpanElement>('.opacity-value');
      if (opacityLabel) {
        opacityLabel.textContent = this.formatOpacityLabel(opacityValue);
      }
      this.updateSliderVisual(this.opacitySlider);
    }
  }

  private formatDurationLabel(value: number): string {
    const clamped = Math.min(20000, Math.max(3000, value));
    if (clamped <= 4500) {
      return '极快';
    }
    if (clamped <= 7500) {
      return '很快';
    }
    if (clamped <= 10000) {
      return '标准';
    }
    if (clamped <= 14000) {
      return '稍慢';
    }
    return '慢速';
  }

  private formatAreaLabel(value: number): string {
    const clamped = sanitizeDanmuArea(value);
    if (clamped <= 0.25) {
      return '上 1/4';
    }
    if (clamped <= 0.5) {
      return '上 1/2';
    }
    return '上 3/4';
  }

  private formatOpacityLabel(value: number): string {
    const normalized = sanitizeDanmuOpacity(value);
    return `${Math.round(normalized * 100)}%`;
  }

  private emitChange(partial: Partial<DanmuUserSettings>) {
    const callback = this.config.onChange;
    if (typeof callback === 'function') {
      callback(partial);
    }
  }

  setSettings(settings: Partial<DanmuUserSettings>) {
    const normalized: Partial<DanmuUserSettings> = { ...settings };
    if (typeof normalized.area === 'number') {
      normalized.area = sanitizeDanmuArea(normalized.area);
    }
    if (typeof normalized.opacity === 'number') {
      normalized.opacity = sanitizeDanmuOpacity(normalized.opacity);
    }
    if (typeof normalized.strokeColor !== 'undefined' && typeof normalized.strokeColor !== 'string') {
      delete (normalized as any).strokeColor;
    }
    this.currentSettings = {
      ...this.currentSettings,
      ...normalized,
    };
    if (typeof this.currentSettings.strokeColor !== 'string') {
      this.currentSettings.strokeColor = '#444444';
    }
    this.updateInputs();
  }
}
