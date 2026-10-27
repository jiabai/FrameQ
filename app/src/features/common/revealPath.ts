import { revealItemInDir } from "@tauri-apps/plugin-opener";

/** Reveals a file in the OS file manager; false when the reveal failed. */
export async function revealPath(path: string): Promise<boolean> {
  try {
    await revealItemInDir(path);
    return true;
  } catch {
    return false;
  }
}
