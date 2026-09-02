import type { ServerBehavior } from "./types";
import { PY_SERVER_DIR } from "./constants";

export interface ServerPaths {
  pidFile: string;
  eventsLog: string;
}

/** stdio MCPサーバーの起動設定を組み立てる唯一の場所。
 * command/args/pidFile/eventsLogの与え方が全シナリオで揃っていることを保証する。 */
export function buildMcpServerConfig(behavior: ServerBehavior, paths: ServerPaths) {
  return {
    mcpverify: {
      type: "stdio" as const,
      command: "uv",
      args: ["run", "--directory", PY_SERVER_DIR, "main.py"],
      env: {
        ...process.env,
        MCPVERIFY_BEHAVIOR: behavior,
        MCPVERIFY_PID_FILE: paths.pidFile,
        MCPVERIFY_EVENTS_LOG: paths.eventsLog,
      } as Record<string, string>,
    },
  };
}
