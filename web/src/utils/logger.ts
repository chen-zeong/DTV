type LogArgs = unknown[];

const isProd = process.env.NODE_ENV === "production";

function safeConsole(method: "debug" | "info" | "warn" | "error", ...args: LogArgs) {
  // Some WebView environments may not have full console support.
  // Also keep logging overhead minimal in production.
  try {
    const c = console as any;
    const fn = c?.[method] as ((...a: LogArgs) => void) | undefined;
    if (typeof fn === "function") fn(...args);
  } catch {
    // ignore
  }
}

export const logger = {
  debug: (...args: LogArgs) => {
    if (isProd) return;
    safeConsole("debug", ...args);
  },
  info: (...args: LogArgs) => safeConsole("info", ...args),
  warn: (...args: LogArgs) => safeConsole("warn", ...args),
  error: (...args: LogArgs) => safeConsole("error", ...args)
};

