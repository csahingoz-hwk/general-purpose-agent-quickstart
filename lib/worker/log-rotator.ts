import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";

export type LogLevel = "info" | "warn" | "error";

export type RotatingLoggerOptions = {
  filePath: string;
  maxBytes?: number;
  maxBackups?: number;
  alsoConsole?: boolean;
};

const DEFAULT_MAX_LOG_BYTES = 2 * 1024 * 1024; // 2 MB per file
const DEFAULT_MAX_BACKUPS = 3; // Max ~8 MB total on disk

const SECRET_VALUE_PATTERN =
  /\b(?:sk-[a-zA-Z0-9_-]{12,}|ya29\.[a-zA-Z0-9._-]+|postgres(?:ql)?:\/\/[^\s"']+|Bearer\s+[a-zA-Z0-9._~+/-]+=*)/gi;

export function redactSensitiveLogText(input: string): string {
  return input.replace(SECRET_VALUE_PATTERN, "[REDACTED]");
}

export class RotatingFileLogger {
  private readonly filePath: string;
  private readonly maxBytes: number;
  private readonly maxBackups: number;
  private readonly alsoConsole: boolean;

  constructor(opts: RotatingLoggerOptions) {
    this.filePath = opts.filePath;
    this.maxBytes = Math.max(1024, opts.maxBytes ?? DEFAULT_MAX_LOG_BYTES);
    this.maxBackups = Math.max(1, opts.maxBackups ?? DEFAULT_MAX_BACKUPS);
    this.alsoConsole = opts.alsoConsole ?? false;

    mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  private rotateIfNeeded(incomingBytes: number): void {
    if (!existsSync(this.filePath)) {
      return;
    }
    let currentSize = 0;
    try {
      currentSize = statSync(this.filePath).size;
    } catch {
      return;
    }
    if (currentSize + incomingBytes <= this.maxBytes) {
      return;
    }

    const oldest = `${this.filePath}.${this.maxBackups}`;
    if (existsSync(oldest)) {
      rmSync(oldest, { force: true });
    }

    for (let idx = this.maxBackups - 1; idx >= 1; idx--) {
      const src = `${this.filePath}.${idx}`;
      const dst = `${this.filePath}.${idx + 1}`;
      if (existsSync(src)) {
        renameSync(src, dst);
      }
    }

    renameSync(this.filePath, `${this.filePath}.1`);
  }

  log(
    level: LogLevel,
    event: string,
    meta?: Record<string, string | number | boolean | null>
  ): void {
    const safeMeta: Record<string, string | number | boolean | null> = {};
    if (meta) {
      for (const [key, val] of Object.entries(meta)) {
        safeMeta[key] =
          typeof val === "string" ? redactSensitiveLogText(val) : val;
      }
    }
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      event: redactSensitiveLogText(event),
      ...safeMeta,
    });
    const line = `${entry}\n`;
    const byteLength = Buffer.byteLength(line, "utf8");

    this.rotateIfNeeded(byteLength);
    appendFileSync(this.filePath, line, { encoding: "utf8", mode: 0o600 });

    if (this.alsoConsole) {
      process.stdout.write(line);
    }
  }
}
