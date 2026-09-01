// Pattern A: query() のfor-awaitループを最後まで回して正常終了させる
import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync, existsSync, rmSync } from "node:fs";

const PID_FILE = "/home/akring/gekko_0/run/server.pid";
if (existsSync(PID_FILE)) rmSync(PID_FILE);

const PY_SERVER_DIR = "/home/akring/gekko_0/pyserver";

async function main() {
  const q = query({
    prompt: "echoツールを使って 'hello-pattern-a' というテキストをechoしてください。結果を報告したら終了してください。",
    options: {
      mcpServers: {
        mcpverify: {
          type: "stdio",
          command: "uv",
          args: ["run", "--directory", PY_SERVER_DIR, "main.py"],
        },
      },
      allowedTools: ["mcp__mcpverify__echo"],
      disallowedTools: ["Bash", "Write", "Edit", "Read", "Glob", "Grep", "WebFetch", "WebSearch", "Task"],
      permissionMode: "bypassPermissions",
      maxTurns: 5,
    },
  });

  for await (const msg of q) {
    console.log(`[msg] type=${msg.type}` + (msg.type === "result" ? ` subtype=${(msg as any).subtype}` : ""));
    if (msg.type === "system") {
      console.log("  system full:", JSON.stringify(msg));
    }
    if (msg.type === "assistant") {
      const content = (msg as any).message?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c.type === "text") console.log("  assistant text:", c.text);
          if (c.type === "tool_use") console.log("  tool_use:", c.name, JSON.stringify(c.input));
        }
      }
    }
  }

  console.log("=== for-await loop finished normally ===");
}

main()
  .then(() => {
    console.log("=== main() resolved, script about to exit naturally ===");
  })
  .catch((err) => {
    console.error("main() error:", err);
    process.exitCode = 1;
  });
