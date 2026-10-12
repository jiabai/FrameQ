import type { PrismaClient } from "@prisma/client";
import type { AnysearchConfigRecord, Store } from "../store/contracts.js";

export async function getAnysearchConfig(
  prisma: PrismaClient,
): ReturnType<Store["getAnysearchConfig"]> {
  const config = await prisma.anysearchConfig.findUnique({ where: { id: "default" } });
  return config as AnysearchConfigRecord | null;
}

export async function upsertAnysearchConfig(
  prisma: PrismaClient,
  input: Parameters<Store["upsertAnysearchConfig"]>[0],
  now: Date,
): ReturnType<Store["upsertAnysearchConfig"]> {
  const config = await prisma.anysearchConfig.upsert({
    where: { id: "default" },
    update: { ...input, updatedAt: now },
    create: { ...input, id: "default", createdAt: now, updatedAt: now },
  });
  return config as AnysearchConfigRecord;
}
