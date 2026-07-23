export type LifecycleApplication = {
  listen(options: { host: string; port: number }): Promise<unknown>;
  close(): Promise<void>;
};

export type LifecycleReadiness = {
  initialize(): Promise<void>;
  beginShutdown(): void;
};

export type LifecycleLogger = {
  info(fields: Record<string, unknown>, message?: string): void;
  error(fields: Record<string, unknown>, message?: string): void;
};

export type ShutdownResult = Readonly<{
  exitCode: 0 | 1;
  timedOut: boolean;
}>;

type SignalSource = {
  on(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  removeListener(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
};

type ServerLifecycleOptions = {
  app: LifecycleApplication;
  readiness: LifecycleReadiness;
  listen: { host: string; port: number };
  disconnect: () => Promise<void>;
  shutdownDeadlineMs: number;
  logger?: LifecycleLogger;
};

const silentLogger: LifecycleLogger = {
  info() {},
  error() {},
};

export function createServerLifecycle(options: ServerLifecycleOptions) {
  if (!Number.isFinite(options.shutdownDeadlineMs) || options.shutdownDeadlineMs <= 0) {
    throw new Error("Shutdown deadline must be positive.");
  }
  const logger = options.logger ?? silentLogger;
  let startPromise: Promise<void> | undefined;
  let closePromise: Promise<void> | undefined;
  let shutdownPromise: Promise<ShutdownResult> | undefined;

  function closeResources(): Promise<void> {
    if (!closePromise) {
      closePromise = (async () => {
        try {
          await options.app.close();
        } finally {
          await options.disconnect();
        }
      })();
    }
    return closePromise;
  }

  function start(): Promise<void> {
    if (!startPromise) {
      startPromise = (async () => {
        try {
          await options.readiness.initialize();
          await options.app.listen(options.listen);
          logger.info({ event: "lifecycle.server.started" }, "server started");
        } catch {
          options.readiness.beginShutdown();
          await closeResources().catch(() => undefined);
          logger.error(
            {
              event: "lifecycle.server.start_failed",
              error_code: "SERVER_STARTUP_FAILED",
            },
            "server startup failed",
          );
          throw new Error("SERVER_STARTUP_FAILED");
        }
      })();
    }
    return startPromise;
  }

  function shutdown(reason: string): Promise<ShutdownResult> {
    if (!shutdownPromise) {
      options.readiness.beginShutdown();
      shutdownPromise = settleShutdown(
        closeResources(),
        options.shutdownDeadlineMs,
      ).then((result) => {
        if (result.timedOut) {
          logger.error(
            {
              event: "lifecycle.server.stop_failed",
              error_code: "SERVER_SHUTDOWN_TIMEOUT",
              reason,
            },
            "server shutdown timed out",
          );
        } else if (result.exitCode === 1) {
          logger.error(
            {
              event: "lifecycle.server.stop_failed",
              error_code: "SERVER_SHUTDOWN_FAILED",
              reason,
            },
            "server shutdown failed",
          );
        } else {
          logger.info(
            { event: "lifecycle.server.stopped", reason },
            "server stopped",
          );
        }
        return result;
      });
    }
    return shutdownPromise;
  }

  function installSignalHandlers(input: {
    signalSource?: SignalSource;
    exit?: (code: number) => void;
  } = {}): () => void {
    const signalSource = input.signalSource ?? process;
    const exit = input.exit ?? ((code: number) => process.exit(code));
    let signalHandled = false;
    const handleSignal = (signal: "SIGINT" | "SIGTERM") => {
      if (signalHandled) {
        return;
      }
      signalHandled = true;
      void shutdown(signal).then((result) => exit(result.exitCode));
    };
    const onSigint = () => handleSignal("SIGINT");
    const onSigterm = () => handleSignal("SIGTERM");
    signalSource.on("SIGINT", onSigint);
    signalSource.on("SIGTERM", onSigterm);
    return () => {
      signalSource.removeListener("SIGINT", onSigint);
      signalSource.removeListener("SIGTERM", onSigterm);
    };
  }

  return { start, shutdown, installSignalHandlers };
}

function settleShutdown(
  closePromise: Promise<void>,
  deadlineMs: number,
): Promise<ShutdownResult> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (result: ShutdownResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(
      () => settle({ exitCode: 1, timedOut: true }),
      deadlineMs,
    );
    void closePromise.then(
      () => settle({ exitCode: 0, timedOut: false }),
      () => settle({ exitCode: 1, timedOut: false }),
    );
  });
}
