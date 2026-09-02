import type { Trigger } from "./types";
import { BASE_DISALLOWED_TOOLS, MAX_TURNS, PERMISSION_MODE, WORK_SECONDS } from "./constants";

/** trigger差分だけを反映しつつ、それ以外(permissionMode/maxTurns等)は固定した
 * query() options を組み立てる唯一の場所。 */
export function buildOptions(trigger: Trigger, mcpServers: ReturnType<typeof import("./mcpServer").buildMcpServerConfig>) {
  const usesSubagent = trigger === "subagent";

  const base = {
    mcpServers,
    permissionMode: PERMISSION_MODE,
    maxTurns: MAX_TURNS,
  };

  if (usesSubagent) {
    return {
      ...base,
      allowedTools: ["Task", "mcp__mcpverify__work"],
      disallowedTools: BASE_DISALLOWED_TOOLS,
      agents: {
        worker: {
          description: "mcpverifyのworkツールを呼ぶだけのサブエージェント",
          prompt: "あなたはworkツールを呼ぶだけのサブエージェントです。指定された秒数でworkツールを呼び、結果を報告してください。",
          tools: ["mcp__mcpverify__work"],
        },
      },
    };
  }

  return {
    ...base,
    allowedTools: ["mcp__mcpverify__work"],
    disallowedTools: [...BASE_DISALLOWED_TOOLS, "Task"],
  };
}

export function buildPrompt(trigger: Trigger): string {
  if (trigger === "subagent") {
    return (
      `サブエージェント 'worker' をTaskツールで起動し、mcp__mcpverify__work ツールで ` +
      `seconds=${WORK_SECONDS}, label='scenario' を呼ばせてください。結果が返ったら報告して終了してください。`
    );
  }
  return `mcp__mcpverify__work ツールを seconds=${WORK_SECONDS}, label='scenario' で呼び出してください。結果を報告したら終了してください。`;
}
