type LogFields = Record<string, unknown>;

function emit(level: "info" | "warn" | "error", message: string, fields?: LogFields) {
  const line = {
    level,
    time: new Date().toISOString(),
    message,
    ...fields,
  };
  const out = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  out(JSON.stringify(line));
}

export const logger = {
  info: (message: string, fields?: LogFields) => emit("info", message, fields),
  warn: (message: string, fields?: LogFields) => emit("warn", message, fields),
  error: (message: string, fields?: LogFields) => emit("error", message, fields),
};
