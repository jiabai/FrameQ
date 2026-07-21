import type { FastifyInstance } from "fastify";
import { findDesktopUpdate, type DesktopReleaseManifest } from "../updates.js";

type DesktopUpdateRouteDependencies = {
  releaseManifest: DesktopReleaseManifest | null;
};

export function registerDesktopUpdateRoutes(
  app: FastifyInstance,
  dependencies: DesktopUpdateRouteDependencies,
): void {
  // Reserved for a future server-hosted update manifest. Current desktop builds
  // use Tauri's GitHub Releases `latest.json` endpoint configured in tauri.conf.json.
  app.get("/api/desktop/updates/:target/:arch/:currentVersion", async (request, reply) => {
    const params = request.params as {
      target?: string;
      arch?: string;
      currentVersion?: string;
    };
    const query = request.query as { channel?: string };
    const update = findDesktopUpdate(dependencies.releaseManifest, {
      target: params.target ?? "",
      arch: params.arch ?? "",
      currentVersion: params.currentVersion ?? "",
      channel: query.channel,
    });

    if (!update) {
      return reply.code(204).send();
    }

    return update;
  });
}
