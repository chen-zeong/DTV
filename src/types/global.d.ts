export {};

declare global {
  interface Window {
    requestIdleCallback: (
      callback: (deadline: IdleDeadline) => void,
      options?: IdleRequestOptions
    ) => number;
    cancelIdleCallback: (handle: number) => void;
  }

  interface IdleDeadline {
    readonly didTimeout: boolean;
    timeRemaining: () => number;
  }

  interface IdleRequestOptions {
    timeout?: number;
  }
}
