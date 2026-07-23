import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { createTemporaryPrismaClient } from "./prismaTestHarness.js";

describe("temporary Prisma transaction fixture", () => {
  test("opens independent clients that share one WAL-backed temporary database", async () => {
    const fixture = await createTemporaryPrismaClient();
    try {
      const second = await fixture.createClient();
      expect(second).not.toBe(fixture.prisma);

      await fixture.prisma.user.create({
        data: {
          id: "shared-fixture-user",
          email: "fixture@example.com",
          createdAt: new Date("2026-07-22T08:00:00.000Z"),
          updatedAt: new Date("2026-07-22T08:00:00.000Z"),
        },
      });

      await expect(second.user.findUnique({ where: { id: "shared-fixture-user" } })).resolves.toMatchObject({
        email: "fixture@example.com",
      });
    } finally {
      await fixture.cleanup();
    }
  });

  test("removes its temporary directory when setup fails before the fixture is returned", async () => {
    let temporaryDirectory: string | null = null;
    let fixture: Awaited<ReturnType<typeof createTemporaryPrismaClient>> | null = null;
    let failure: unknown;

    try {
      fixture = await createTemporaryPrismaClient({
        beforeConnect: (directory: string) => {
          temporaryDirectory = directory;
          throw new Error("injected temporary fixture setup failure");
        },
      });
    } catch (error) {
      failure = error;
    } finally {
      await fixture?.cleanup();
    }

    expect(failure).toMatchObject({ message: "injected temporary fixture setup failure" });
    expect(temporaryDirectory).not.toBeNull();
    expect(existsSync(temporaryDirectory ?? "")).toBe(false);
  });
});
