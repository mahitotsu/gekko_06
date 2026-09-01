// Pattern B: ツール呼び出しの途中で query.interrupt() を呼んで中断する
import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync, existsSync, rmSync } from "node:fs";

const PID_FILE = "/home/akring/gekko_0/run/server.pid";
if (existsSync(PID_FILE)) rmSync(PID_FILE);

const PY_SERVER_DIR = "/home/akring/gekko_0/pyserver";

async function main() {
  const q = query({
    prompt:
      "slow_echoツールを使って text='hello-pattern-b', delay_seconds=20 で呼び出してください。",
    options: {
      mcpServers: {
        mcpverify: {
          type: "stdio",
          command: "uv",
          args: ["run", "--directory", PY_SERVER_DIR, "main.py"],
        },
      },
      allowedTools: ["mcp__mcpverify__slow_echo"],
      disallowedTools: ["Bash", "Write", "Edit", "Read", "Glob", "Grep", "WebFetch", "WebSearch", "Task"],
      permissionMode: "bypassPermissions",
      maxTurns: 5,
    },
  });

  let interrupted = false;

  for await (const msg of q) {
    console.log(`[msg] type=${msg.type}` + (msg.type === "result" ? ` subtype=${(msg as any).subtype}` : ""));
    if (msg.type === "assistant") {
      const content = (msg as any).message?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c.type === "text") console.log("  assistant text:", c.text);
          if (c.type === "tool_use") {
            console.log("  tool_use:", c.name, JSON.stringify(c.input));
            if (c.name === "mcp__mcpverify__slow_echo" && !interrupted) {
              interrupted = true;
              console.log(`  >>> tool_use detected for slow_echo at t=${Date.now()}, calling query.interrupt() now`);
              // 少し待ってからinterrupt。MCPサーバー側にツール呼び出しが実際に飛ぶ時間を確保する
              setTimeout(async () => {
                console.log(`  >>> invoking query.interrupt() at t=${Date.now()}`);
                try {
                  const res = await q.interrupt();
                  console.log("  >>> interrupt() resolved:", JSON.stringify(res));
                } catch (err) {
                  console.error("  >>> interrupt() error:", err);
                }
              }, 1500);
            }
          }
        }
      }
    }
  }

  console.log("=== for-await loop finished (after interrupt) ===");
}

main()
  .then(() => {
    console.log("=== main() resolved, script about to exit naturally ===");
  })
  .catch((err) => {
    console.error("main() error:", err);
    process.exitCode = 1;
  });
