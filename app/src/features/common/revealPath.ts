import { revealItemInDir } from "@tauri-apps/plugin-opener";

export function toFileManagerPath(path: string): string {
  // Windows Shell requires backslashes in extended drive and UNC paths.
  return /^[/\\]{2}\?[/\\](?:[a-z]:[/\\]|UNC[/\\])/i.test(path)
    ? path.replace(/\//g, "\\")
    : path;
}

export async function revealFileInDirectory(path: string): Promise<void> {
  await revealItemInDir(toFileManagerPath(path));
}

/** Reveals a file in the OS file manager; false when the reveal failed. */
export async function revealPath(path: string): Promise<boolean> {
  try {
    await revealFileInDirectory(path);
    return true;
  } catch {
    return false;
  }
}
