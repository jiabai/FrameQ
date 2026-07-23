import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { Prisma, PrismaClient } from "@prisma/client";

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = join(serverRoot, "prisma", "schema.prisma");
const prismaCliPath = join(serverRoot, "node_modules", "prisma", "build", "index.js");

type TemporaryPrismaClientOptions = {
  beforeConnect?: (directory: string) => void;
};

export async function createTemporaryPrismaClient(options: TemporaryPrismaClientOptions = {}): Promise<{
  prisma: PrismaClient;
  createClient: () => Promise<PrismaClient>;
  databasePath: string;
  databaseUrl: string;
  cleanup: () => Promise<void>;
}> {
  const directory = mkdtempSync(join(tmpdir(), "frameq-prisma-transaction-"));
  const clients = new Set<PrismaClient>();
  try {
    const databasePath = join(directory, "frameq.sqlite").replace(/\\/g, "/");
    const databaseUrl = `file:${databasePath}`;
    const temporarySchemaPath = join(directory, "schema.prisma");
    const schema = readFileSync(schemaPath, "utf8").replace(
      'url      = env("DATABASE_URL")',
      'url      = "file:./frameq.sqlite"',
    );
    writeFileSync(temporarySchemaPath, schema);
    const migrationSql = execFileSync(
      process.execPath,
      [prismaCliPath, "migrate", "diff", "--from-empty", "--to-schema-datamodel", temporarySchemaPath, "--script"],
      {
        cwd: serverRoot,
        stdio: "pipe",
      },
    ).toString("utf8");
    const database = new DatabaseSync(databasePath);
    try {
      database.exec(migrationSql);
    } finally {
      database.close();
    }

    options.beforeConnect?.(directory);
    const createClient = async (): Promise<PrismaClient> => {
      const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      try {
        await client.$connect();
        await client.$queryRawUnsafe("PRAGMA journal_mode=WAL");
        await client.$queryRawUnsafe("PRAGMA busy_timeout=5000");
        clients.add(client);
        return client;
      } catch (error) {
        await client.$disconnect().catch(() => undefined);
        throw error;
      }
    };
    const prisma = await createClient();
    return {
      prisma,
      createClient,
      databasePath,
      databaseUrl,
      cleanup: async () => {
        try {
          await Promise.all([...clients].map((client) => client.$disconnect().catch(() => undefined)));
        } finally {
          rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        }
      },
    };
  } catch (error) {
    try {
      await Promise.all([...clients].map((client) => client.$disconnect().catch(() => undefined)));
    } catch {
      // Preserve the setup failure; the directory is still removed below.
    } finally {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
    throw error;
  }
}

export function prismaWithInjectedWriteFailure(
  prisma: PrismaClient,
  input: { model: string; methods: string[]; message: string },
): PrismaClient {
  const wrapClient = (target: Record<PropertyKey, unknown>): Record<PropertyKey, unknown> =>
    new Proxy(target, {
      get(currentTarget, property, receiver) {
        if (property === "$transaction") {
          const transaction = Reflect.get(currentTarget, property, receiver) as (
            callback: (transactionClient: Record<PropertyKey, unknown>) => Promise<unknown>,
            ...rest: unknown[]
          ) => Promise<unknown>;
          return async (
            callback: (transactionClient: Record<PropertyKey, unknown>) => Promise<unknown>,
            ...rest: unknown[]
          ) => transaction.call(currentTarget, async (transactionClient) => callback(wrapClient(transactionClient)), ...rest);
        }

        const value = Reflect.get(currentTarget, property, receiver);
        if (String(property) !== input.model || !value || typeof value !== "object") {
          return typeof value === "function" ? value.bind(currentTarget) : value;
        }
        return new Proxy(value as Record<PropertyKey, unknown>, {
          get(delegate, method, delegateReceiver) {
            const operation = Reflect.get(delegate, method, delegateReceiver);
            if (typeof method === "string" && input.methods.includes(method)) {
              return async () => {
                throw new Error(input.message);
              };
            }
            return typeof operation === "function" ? operation.bind(delegate) : operation;
          },
        });
      },
    });

  return wrapClient(prisma as unknown as Record<PropertyKey, unknown>) as unknown as PrismaClient;
}

export function prismaWithOneInjectedTransactionConflict(prisma: PrismaClient): PrismaClient {
  let pending = true;
  return new Proxy(prisma, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property !== "$transaction" || typeof value !== "function") {
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (...args: unknown[]) => {
        if (pending) {
          pending = false;
          throw new Prisma.PrismaClientKnownRequestError("injected transaction conflict", {
            code: "P2034",
            clientVersion: "6.19.3",
          });
        }
        return value.apply(target, args);
      };
    },
  });
}
