// runScenario.ts (supervisor) が子プロセスとして起動する、実際にquery()を駆動する側。
// トリガーの違いはここでは最小限(interruptのみ自己中断する)にとどめ、
// kill-cli/kill-nodeについては「外から見て区別がつかない、ただのquery()実行」であることが重要。
// 外側(supervisor)がいつ・何をkillするかだけがトリガーの差を生む。
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Trigger, ServerBehavior } from "./src/types";
import { buildMcpServerConfig } from "./src/mcpServer";
import { buildOptions, buildPrompt } from "./src/queryOptions";
import { waitForEvent } from "./src/eventsLog";
import { WORK_SECONDS, SERVER_READY_TIMEOUT_MS } from "./src/constants";

const trigger = process.env.MCPVERIFY_TRIGGER as Trigger;
const behavior = process.env.MCPVERIFY_BEHAVIOR_ARG as ServerBehavior;
const pidFile = process.env.MCPVERIFY_PID_FILE!;
const eventsLog = process.env.MCPVERIFY_EVENTS_LOG!;

async function main() {
  console.log(`INNER_READY pid=${process.pid}`);

  const mcpServers = buildMcpServerConfig(behavior, { pidFile, eventsLog });
  const options = buildOptions(trigger, mcpServers);
  const prompt = buildPrompt(trigger);

  const q = query({ prompt, options: options as any });

  if (trigger === "interrupt") {
    // work_started を検知したら中断する。sleepでの当てずっぽうな待機はしない。
    waitForEvent(eventsLog, "work_started", SERVER_READY_TIMEOUT_MS + WORK_SECONDS * 1000).then((ev) => {
      if (ev) {
        console.log(`INNER_INTERRUPTING t=${Date.now()}`);
        q.interrupt().catch(() => {});
      }
    });
  }

  try {
    for await (const msg of q) {
      if (msg.type === "result") console.log(`INNER_RESULT subtype=${(msg as any).subtype}`);
    }
  } catch (err) {
    console.log(`INNER_QUERY_THREW ${String(err)}`);
  }
  console.log(`INNER_DONE t=${Date.now()}`);
}

main();
