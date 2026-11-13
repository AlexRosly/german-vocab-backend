import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export interface OperationsSnapshot {
  version: 1;
  instanceId: string;
  pid: number;
  updatedAt: string;
  startedAt: string;
  starts: string[];
  serverErrorCount: number;
  lastServerErrorAt: string | null;
  lastServerErrorStatus: number | null;
}

@Injectable()
export class OperationsStatusService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("Operations");
  private readonly directory = process.env.WORTKARTEN_OPERATIONS_DIR ||
    (process.env.NODE_ENV === "production" ? join(homedir(), ".local/state/wortkarten-operations") : undefined);
  private readonly file = this.directory ? join(this.directory, "status.json") : undefined;
  private timer?: ReturnType<typeof setInterval>;
  private storageFault = false;
  private warned = false;
  private readonly state: OperationsSnapshot = {
    version: 1, instanceId: randomUUID(), pid: process.pid,
    startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    starts: [], serverErrorCount: 0, lastServerErrorAt: null, lastServerErrorStatus: null,
  };

  onModuleInit() {
    this.state.starts = [this.state.startedAt];
    if (this.directory && this.file) {
      try {
        if (!isAbsolute(this.directory)) throw new Error("invalid state path");
        mkdirSync(this.directory, { recursive: true, mode: 0o700 });
        this.assertPrivate(this.directory, true);
        if (existsSync(this.file)) {
          this.assertPrivate(this.file, false);
          const previous: unknown = JSON.parse(readFileSync(this.file, "utf8"));
          if (!this.validPrevious(previous)) throw new Error("invalid previous state");
          this.state.serverErrorCount = previous.serverErrorCount;
          this.state.lastServerErrorAt = previous.lastServerErrorAt;
          this.state.lastServerErrorStatus = previous.lastServerErrorStatus;
          const threshold = Date.now() - 15 * 60_000;
          this.state.starts = [...previous.starts.filter(value => Date.parse(value) >= threshold), this.state.startedAt].slice(-32);
        }
      } catch { this.storageFault = true; this.warn(); }
      this.persist();
      this.timer = setInterval(() => this.persist(), 60_000);
      this.timer.unref();
    }
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  snapshot(): OperationsSnapshot { return structuredClone(this.state); }

  recordServerError(status: number) {
    if (!Number.isInteger(status) || status < 500 || status > 599) return;
    this.state.serverErrorCount++;
    this.state.lastServerErrorAt = new Date().toISOString();
    this.state.lastServerErrorStatus = status;
    this.persist();
  }

  private warn() {
    if (!this.warned) this.logger.error("operations_state_unavailable: inspect the private state directory; API continues running");
    this.warned = true;
  }

  private assertPrivate(path: string, directory: boolean) {
    const info = lstatSync(path);
    if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile()) || (!directory && info.size > 65536)) throw new Error("unsafe state path");
    if (process.platform !== "win32" && ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.())) throw new Error("unsafe state permissions");
  }

  private validPrevious(value: unknown): value is OperationsSnapshot {
    if (!value || typeof value !== "object") return false;
    const data = value as Partial<OperationsSnapshot>;
    const date = (item: unknown): item is string => typeof item === "string" && Number.isFinite(Date.parse(item)) && Date.parse(item) <= Date.now() + 300_000;
    return data.version === 1 && typeof data.instanceId === "string" && /^[a-f0-9-]{36}$/.test(data.instanceId) &&
      Number.isSafeInteger(data.serverErrorCount) && data.serverErrorCount! >= 0 &&
      Array.isArray(data.starts) && data.starts.length <= 32 && data.starts.every(date) &&
      (data.lastServerErrorAt === null || date(data.lastServerErrorAt)) &&
      (data.lastServerErrorStatus === null || (Number.isInteger(data.lastServerErrorStatus) && data.lastServerErrorStatus! >= 500 && data.lastServerErrorStatus! <= 599));
  }

  private persist() {
    if (!this.directory || !this.file || this.storageFault) return;
    this.state.updatedAt = new Date().toISOString();
    try {
      this.assertPrivate(this.directory, true);
      if (existsSync(this.file)) this.assertPrivate(this.file, false);
      const temporary = join(this.directory, `.status-${process.pid}-${randomUUID()}.tmp`);
      writeFileSync(temporary, JSON.stringify(this.state) + "\n", { flag: "wx", mode: 0o600 });
      renameSync(temporary, this.file);
      this.warned = false;
    } catch { this.warn(); }
  }
}
