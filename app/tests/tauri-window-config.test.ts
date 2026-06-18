import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type TauriWindowConfig = {
  title: string;
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
  decorations?: boolean;
  shadow?: boolean;
  center?: boolean;
};

type TauriConfig = {
  app: {
    windows: TauriWindowConfig[];
  };
  bundle: {
    targets: string[];
    resources: string[];
  };
};

const configPath = resolve(import.meta.dirname, "../src-tauri/tauri.conf.json");
const capabilityPath = resolve(import.meta.dirname, "../src-tauri/capabilities/default.json");

describe("Tauri desktop window configuration", () => {
  test("uses the custom macOS-style app chrome instead of the native titlebar", () => {
    const config = JSON.parse(readFileSync(configPath, "utf8")) as TauriConfig;
    const [mainWindow] = config.app.windows;

    expect(mainWindow).toMatchObject({
      title: "FrameQ",
      width: 1180,
      height: 760,
      minWidth: 720,
      minHeight: 640,
      decorations: false,
      shadow: true,
      center: true,
    });
  });

  test("allows the custom chrome to control the Tauri window", () => {
    const capability = JSON.parse(readFileSync(capabilityPath, "utf8")) as {
      permissions: string[];
    };

    expect(capability.permissions).toEqual(
      expect.arrayContaining([
        "core:window:allow-start-dragging",
        "core:window:allow-close",
        "core:window:allow-minimize",
        "core:window:allow-toggle-maximize",
      ]),
    );
  });

  test("bundles the local runtime resources required for ordinary users", () => {
    const config = JSON.parse(readFileSync(configPath, "utf8")) as TauriConfig;

    expect(config.bundle.targets).toEqual(expect.arrayContaining(["nsis", "dmg"]));
    expect(config.bundle.resources).toEqual(
      expect.arrayContaining([
        "resources/python/**/*",
        "resources/worker/**/*",
        "resources/bin/**/*",
        "resources/models/**/*",
        "resources/pyproject.toml",
        "resources/.env.template",
      ]),
    );
  });
});
