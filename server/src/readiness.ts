export type ReadinessChecks = Readonly<{
  verifySchema: () => Promise<void>;
  ping: () => Promise<void>;
  timeoutMs: number;
}>;

export class ReadinessController {
  private startupComplete = false;
  private schemaCompatible = false;
  private draining = false;

  constructor(private readonly checks: ReadinessChecks) {
    if (!Number.isFinite(checks.timeoutMs) || checks.timeoutMs <= 0) {
      throw new Error("Readiness timeout must be positive.");
    }
  }

  async initialize(): Promise<void> {
    if (this.draining) {
      throw new Error("SERVER_DRAINING");
    }
    await withTimeout(this.checks.verifySchema, this.checks.timeoutMs);
    this.schemaCompatible = true;
    await withTimeout(this.checks.ping, this.checks.timeoutMs);
    this.startupComplete = true;
  }

  beginShutdown(): void {
    this.draining = true;
  }

  async isReady(): Promise<boolean> {
    if (!this.startupComplete || !this.schemaCompatible || this.draining) {
      return false;
    }
    try {
      await withTimeout(this.checks.ping, this.checks.timeoutMs);
      return true;
    } catch {
      return false;
    }
  }
}

async function withTimeout(operation: () => Promise<void>, timeoutMs: number): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(operation),
      new Promise<void>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("READINESS_CHECK_TIMEOUT")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
