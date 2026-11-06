declare module "danmu.js" {
  export interface DanmuCommentStyle {
    color?: string;
    fontSize?: string;
    fontFamily?: string;
    fontWeight?: string | number;
    lineHeight?: string | number;
    textShadow?: string;
    padding?: string;
    border?: string;
    borderRadius?: string;
    backgroundColor?: string;
    opacity?: number;
    [key: string]: unknown;
  }

  export interface DanmuComment {
    id: string;
    txt?: string;
    el?: HTMLElement;
    start?: number;
    duration?: number;
    moveV?: number;
    prior?: boolean;
    realTime?: boolean;
    noDiscard?: boolean;
    color?: boolean;
    mode?: "scroll" | "top" | "bottom";
    style?: DanmuCommentStyle;
    [key: string]: unknown;
  }

  export interface DanmuOptions {
    container: HTMLElement;
    containerStyle?: Partial<CSSStyleDeclaration>;
    player?: HTMLVideoElement;
    comments?: DanmuComment[];
    live?: boolean;
    direction?: "r2l" | "b2t";
    area?: { start: number; end: number };
    channelSize?: number;
    interval?: number;
    bOffset?: number;
    mouseControl?: boolean;
    mouseControlPause?: boolean;
    defaultOff?: boolean;
  }

  export class DanmuJs {
    constructor(options: DanmuOptions);
    on(event: string, callback: (data: unknown) => void): void;
    start(): void;
    stop(): void;
    pause(): void;
    play(): void;
    sendComment(comment: DanmuComment): void;
    removeComment(id: string): void;
    setOpacity(opacity: number): void;
    setFontSize(size: number, channelSize?: number): void;
    setArea(area: { start: number; end: number }): void;
    setAllDuration(mode: string, duration: number, force?: boolean): void;
    hide(mode?: string): void;
    show(mode?: string): void;
  }

  export default DanmuJs;
}
