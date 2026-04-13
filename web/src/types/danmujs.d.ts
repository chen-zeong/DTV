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
  }
}
