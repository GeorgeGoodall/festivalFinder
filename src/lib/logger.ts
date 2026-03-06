import fs from "fs";
import path from "path";

const LOG_DIR = path.join(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "app.log");

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function formatMessage(level: string, message: string, data?: unknown): string {
  const timestamp = new Date().toISOString();
  const base = `[${timestamp}] [${level}] ${message}`;
  if (data !== undefined) {
    const serialized =
      data instanceof Error
        ? `${data.message}\n${data.stack}`
        : typeof data === "string"
          ? data
          : JSON.stringify(data, null, 2);
    return `${base}\n${serialized}\n`;
  }
  return `${base}\n`;
}

function writeLog(level: string, message: string, data?: unknown) {
  ensureLogDir();
  const formatted = formatMessage(level, message, data);
  fs.appendFileSync(LOG_FILE, formatted);

  // Also log to console
  if (level === "ERROR") {
    console.error(formatted);
  } else {
    console.log(formatted);
  }
}

export const logger = {
  info: (message: string, data?: unknown) => writeLog("INFO", message, data),
  warn: (message: string, data?: unknown) => writeLog("WARN", message, data),
  error: (message: string, data?: unknown) => writeLog("ERROR", message, data),
};
