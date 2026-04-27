import { EventEmitter } from "events";
import { LogEvent, LogLevel } from "./types";

const MAX_LOGS = 300;

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function redactSecrets(value: unknown): unknown {
  if (typeof value === "string") {
    // Do not leak private keys, long API secrets, or auth headers into the dashboard.
    return value
      .replace(/0x[a-fA-F0-9]{64}/g, "0x[REDACTED_PRIVATE_KEY]")
      .replace(/[A-Za-z0-9_-]{32,}/g, "[REDACTED_SECRET]");
  }

  if (Array.isArray(value)) return value.map(redactSecrets);

  if (value && typeof value === "object") {
    const clean: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (/private|secret|passphrase|token|api[_-]?key/i.test(key)) {
        clean[key] = "[REDACTED]";
      } else {
        clean[key] = redactSecrets(item);
      }
    }
    return clean;
  }

  return value;
}

export class MemoryLogger extends EventEmitter {
  private logs: LogEvent[] = [];

  getLogs(): LogEvent[] {
    return [...this.logs];
  }

  debug(message: string, meta?: unknown): void {
    this.write("debug", message, meta);
  }

  info(message: string, meta?: unknown): void {
    this.write("info", message, meta);
  }

  warn(message: string, meta?: unknown): void {
    this.write("warn", message, meta);
  }

  error(message: string, meta?: unknown): void {
    this.write("error", message, meta);
  }

  private write(level: LogLevel, message: string, meta?: unknown): void {
    const event: LogEvent = {
      id: makeId(),
      level,
      message,
      timestamp: new Date().toISOString(),
      meta: meta === undefined ? undefined : redactSecrets(meta)
    };

    this.logs.unshift(event);
    this.logs = this.logs.slice(0, MAX_LOGS);
    this.emit("log", event);

    const line = `[${event.timestamp}] ${level.toUpperCase()} ${message}`;
    if (level === "error") {
      console.error(line, event.meta ?? "");
    } else if (level === "warn") {
      console.warn(line, event.meta ?? "");
    } else {
      console.log(line, event.meta ?? "");
    }
  }
}

export const logger = new MemoryLogger();
