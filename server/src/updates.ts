import { readFileSync } from "node:fs";
import { z } from "zod";

const semverPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

const platformArtifactSchema = z.object({
  url: z.string().url(),
  signature: z.string().min(1),
});

const releaseSchema = z.object({
  version: z.string().regex(semverPattern),
  pub_date: z.string().datetime(),
  notes: z.string().optional().default(""),
  platforms: z.record(z.string(), platformArtifactSchema),
});

export type DesktopReleaseManifest = {
  channels?: Record<
    string,
    {
      releases?: unknown[];
    }
  >;
};

export type DesktopUpdateManifest = {
  version: string;
  pub_date: string;
  url: string;
  signature: string;
  notes: string;
};

export function loadDesktopReleaseManifest(path: string | undefined): DesktopReleaseManifest | null {
  if (!path) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(path, "utf8")) as DesktopReleaseManifest;
  } catch {
    return null;
  }
}

export function findDesktopUpdate(
  manifest: DesktopReleaseManifest | null | undefined,
  input: {
    target: string;
    arch: string;
    currentVersion: string;
    channel?: string;
  },
): DesktopUpdateManifest | null {
  if (!manifest || !semverPattern.test(input.currentVersion)) {
    return null;
  }

  const channel = input.channel?.trim() || "stable";
  const releases = manifest.channels?.[channel]?.releases;
  if (!Array.isArray(releases)) {
    return null;
  }

  const platformKey = `${input.target}-${input.arch}`;
  let selected: DesktopUpdateManifest | null = null;

  for (const rawRelease of releases) {
    const parsed = releaseSchema.safeParse(rawRelease);
    if (!parsed.success) {
      continue;
    }

    const artifact = parsed.data.platforms[platformKey];
    if (!artifact) {
      continue;
    }

    if (compareSemver(parsed.data.version, input.currentVersion) <= 0) {
      continue;
    }

    if (selected && compareSemver(parsed.data.version, selected.version) <= 0) {
      continue;
    }

    selected = {
      version: parsed.data.version,
      pub_date: parsed.data.pub_date,
      url: artifact.url,
      signature: artifact.signature,
      notes: parsed.data.notes,
    };
  }

  return selected;
}

function compareSemver(left: string, right: string): number {
  const leftCore = left.split(/[+-]/, 1)[0] ?? "";
  const rightCore = right.split(/[+-]/, 1)[0] ?? "";
  const leftParts = leftCore.split(".").map((part) => Number(part));
  const rightParts = rightCore.split(".").map((part) => Number(part));

  for (let index = 0; index < 3; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }

  return comparePrerelease(left, right);
}

function comparePrerelease(left: string, right: string): number {
  const leftPrerelease = left.match(/^\d+\.\d+\.\d+-([^+]+)/)?.[1] ?? "";
  const rightPrerelease = right.match(/^\d+\.\d+\.\d+-([^+]+)/)?.[1] ?? "";

  if (leftPrerelease === rightPrerelease) {
    return 0;
  }
  if (!leftPrerelease) {
    return 1;
  }
  if (!rightPrerelease) {
    return -1;
  }

  return leftPrerelease.localeCompare(rightPrerelease);
}
