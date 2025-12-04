import Plugin, { POSITIONS } from "xgplayer/es/plugin/plugin.js";

import { DANMU_OPACITY_MAX, DANMU_OPACITY_MIN, ICONS, sanitizeDanmuArea, sanitizeDanmuOpacity, type DanmuUserSettings } from "./constants";

export class DanmuToggleControl extends Plugin {
  static override pluginName = "danmuToggle";
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
    if (this.config.disable) return;
    this.isActive = typeof this.config.getState === "function" ? !!this.config.getState() : true;
    this.updateState();
    this.handleClick = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      this.toggle();
    };
    this.bind(["click", "touchend"], this.handleClick);
  }

  override destroy() {
    if (this.handleClick) {
      this.unbind(["click", "touchend"], this.handleClick);
      this.handleClick = null;
    }
  }

  override render() {
    if (this.config.disable) return "";
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
    if (typeof callback === "function") {
      callback(this.isActive);
    }
  }

  private updateState() {
    const root = this.root as HTMLElement | null;
    if (!root) return;
    root.classList.toggle("is-off", !this.isActive);
    root.setAttribute("aria-pressed", this.isActive ? "true" : "false");
  }

  setState(isActive: boolean) {
    this.isActive = isActive;
    this.updateState();
  }
}

export class DanmuSettingsControl extends Plugin {
  static override pluginName = "danmuSettings";
  static override defaultConfig = {
    position: POSITIONS.CONTROLS_RIGHT,
    index: 4,
    disable: false,
    getSettings: (() => ({
      color: "#ffffff",
      strokeColor: "#444444",
      fontSize: "20px",
      duration: 10000,
      area: 0.5,
      mode: "scroll" as const,
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
    color: "#ffffff",
    strokeColor: "#444444",
    fontSize: "20px",
    duration: 10000,
    area: 0.5,
    mode: "scroll",
    opacity: 1,
  };
  private textColorInput: HTMLInputElement | null = null;
  private strokeColorInput: HTMLInputElement | null = null;
  private fontSizeSlider: HTMLInputElement | null = null;
  private durationSlider: HTMLInputElement | null = null;
  private areaSlider: HTMLInputElement | null = null;
  private opacitySlider: HTMLInputElement | null = null;

  override afterCreate() {
    if (this.config.disable) return;
    this.currentSettings = typeof this.config.getSettings === "function" ? this.config.getSettings() : this.currentSettings;
    this.currentSettings.area = sanitizeDanmuArea(this.currentSettings.area);
    this.currentSettings.opacity = sanitizeDanmuOpacity(this.currentSettings.opacity);
    if (typeof this.currentSettings.strokeColor !== "string") {
      this.currentSettings.strokeColor = "#444444";
    }

    this.createPanel();
    this.updateInputs();

    this.handleToggle = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      this.togglePanel();
    };

    this.bind(["click", "touchend"], this.handleToggle);

    if (typeof document !== "undefined") {
      this.handleDocumentClick = (event: MouseEvent) => {
        if (!this.root.contains(event.target as Node)) {
          this.closePanel();
        }
      };
      document.addEventListener("click", this.handleDocumentClick);
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
    this.bind("mouseenter", this.handleHoverEnter);
    this.bind("mouseleave", this.handleHoverLeave);
  }

  override destroy() {
    if (this.handleToggle) {
      this.unbind(["click", "touchend"], this.handleToggle);
      this.handleToggle = null;
    }
    if (this.handleDocumentClick) {
      document.removeEventListener("click", this.handleDocumentClick);
      this.handleDocumentClick = null;
    }
    if (this.handleHoverEnter) {
      this.unbind("mouseenter", this.handleHoverEnter);
      this.handleHoverEnter = null;
    }
    if (this.handleHoverLeave) {
      this.unbind("mouseleave", this.handleHoverLeave);
      this.handleHoverLeave = null;
    }
    if (this.hoverCloseTimer) {
      clearTimeout(this.hoverCloseTimer);
      this.hoverCloseTimer = null;
    }
    (this.root as HTMLElement | null)?.classList.remove("menu-open");
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
    if (this.config.disable) return "";
    return `<xg-icon class="xgplayer-danmu-settings" title="">
      ${ICONS.cog}
    </xg-icon>`;
  }

  private createPanel() {
    this.panel = document.createElement("div");
    this.panel.className = "xgplayer-danmu-settings-panel";
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

    this.panel.addEventListener("click", (event) => event.stopPropagation());
    this.panel.addEventListener("pointerdown", (event) => event.stopPropagation());
    this.panel.addEventListener("mousedown", (event) => event.stopPropagation());

    this.textColorInput = this.panel.querySelector(".danmu-setting-color") as HTMLInputElement | null;
    this.strokeColorInput = this.panel.querySelector(".danmu-setting-stroke-color") as HTMLInputElement | null;
    this.fontSizeSlider = this.panel.querySelector(".danmu-setting-font-range") as HTMLInputElement | null;
    this.durationSlider = this.panel.querySelector(".danmu-setting-duration-range") as HTMLInputElement | null;
    this.areaSlider = this.panel.querySelector(".danmu-setting-area-range") as HTMLInputElement | null;
    this.opacitySlider = this.panel.querySelector(".danmu-setting-opacity-range") as HTMLInputElement | null;

    this.textColorInput?.addEventListener("input", () => {
      if (!this.textColorInput) return;
      this.currentSettings.color = this.textColorInput.value;
      this.emitChange({ color: this.currentSettings.color });
    });

    this.strokeColorInput?.addEventListener("input", () => {
      if (!this.strokeColorInput) return;
      this.currentSettings.strokeColor = this.strokeColorInput.value;
      this.emitChange({ strokeColor: this.currentSettings.strokeColor });
    });

    this.fontSizeSlider?.addEventListener("input", () => {
      if (!this.fontSizeSlider) return;
      const value = Number(this.fontSizeSlider.value);
      this.currentSettings.fontSize = `${value}px`;
      this.updateInputs();
      this.emitChange({ fontSize: this.currentSettings.fontSize });
    });

    this.durationSlider?.addEventListener("input", () => {
      if (!this.durationSlider) return;
      const value = Number(this.durationSlider.value);
      this.currentSettings.duration = value;
      this.updateInputs();
      this.emitChange({ duration: this.currentSettings.duration });
    });

    this.areaSlider?.addEventListener("input", () => {
      if (!this.areaSlider) return;
      const value = sanitizeDanmuArea(Number(this.areaSlider.value));
      this.currentSettings.area = value;
      this.updateInputs();
      this.emitChange({ area: this.currentSettings.area });
    });

    this.opacitySlider?.addEventListener("input", () => {
      if (!this.opacitySlider) return;
      const value = sanitizeDanmuOpacity(Number(this.opacitySlider.value));
      this.currentSettings.opacity = value;
      this.updateInputs();
      this.emitChange({ opacity: this.currentSettings.opacity });
    });
  }

  private togglePanel() {
    this.isOpen = !this.isOpen;
    this.syncPanelState();
  }

  private openPanel() {
    this.isOpen = true;
    this.syncPanelState();
  }

  private closePanel() {
    this.isOpen = false;
    this.syncPanelState();
  }

  private syncPanelState() {
    const root = this.root as HTMLElement | null;
    if (!root) return;
    root.classList.toggle("menu-open", this.isOpen);
    this.panel?.classList.toggle("show", this.isOpen);
  }

  private updateInputs() {
    this.textColorInput?.setAttribute("value", this.currentSettings.color);
    this.strokeColorInput?.setAttribute("value", this.currentSettings.strokeColor);
    const fontValueEl = this.panel?.querySelector(".font-size-value");
    if (fontValueEl) fontValueEl.textContent = this.currentSettings.fontSize;
    if (this.fontSizeSlider) this.fontSizeSlider.value = `${parseInt(this.currentSettings.fontSize, 10)}`;
    const speedValueEl = this.panel?.querySelector(".speed-value");
    if (speedValueEl) speedValueEl.textContent = this.formatDurationLabel(this.currentSettings.duration);
    if (this.durationSlider) this.durationSlider.value = `${this.currentSettings.duration}`;
    const areaValueEl = this.panel?.querySelector(".area-value");
    if (areaValueEl) areaValueEl.textContent = this.formatAreaLabel(this.currentSettings.area);
    if (this.areaSlider) this.areaSlider.value = `${this.currentSettings.area}`;
    const opacityValueEl = this.panel?.querySelector(".opacity-value");
    if (opacityValueEl) opacityValueEl.textContent = this.formatOpacityLabel(this.currentSettings.opacity);
    if (this.opacitySlider) this.opacitySlider.value = `${this.currentSettings.opacity}`;
  }

  private formatDurationLabel(duration: number) {
    return `${Math.round(duration / 1000)}s`;
  }

  private formatAreaLabel(area: number) {
    return `${Math.round(area * 100)}%`;
  }

  private formatOpacityLabel(opacity: number) {
    return `${Math.round(opacity * 100)}%`;
  }

  private emitChange(partial: Partial<DanmuUserSettings>) {
    const callback = this.config.onChange;
    if (typeof callback === "function") {
      callback(partial);
    }
  }
}
