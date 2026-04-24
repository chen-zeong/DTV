declare module 'danmu.js' {
  export default class DanmuJs {
    constructor(options: any);
    start(): void;
    pause(): void;
    play(): void;
    stop(): void;
    sendComment(comment: any): void;
    updateComments?(comments: any[]): void;
    setAllDuration?(mode: string, duration: number): void;
    setPlayRate?(mode: string, rate: number): void;
    hide?(mode?: string): void;
    show?(mode?: string): void;
    setArea?(area: { start: number; end: number; lines?: number }): void;
    setOpacity?(opacity: number): void;
    setFontSize?(size: number | string, channelSize?: number): void;
    readonly status?: 'idle' | 'paused' | 'playing' | 'closed' | string;
    readonly state?: {
      status?: string;
      comments?: any[];
      bullets?: any[];
      displayArea?: { width: number; height: number };
    };
  }
}
