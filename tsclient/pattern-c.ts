// Pattern C: サブエージェント(Task)経由でMCPツールを呼び出し、
// サブエージェント終了後・セッション終了後の子プロセスの生死を確認する
import { query } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, rmSync } from "node:fs";

const PID_FILE = "/home/akring/gekko_0/run/server.pid";
if (existsSync(PID_FILE)) rmSync(PID_FILE);

const PY_SERVER_DIR = "/home/akring/gekko_0/pyserver";

async function main() {
  const q = query({
    prompt:
      "サブエージェント 'echoer' を Task ツールで起動し、mcp__mcpverify__echo ツールで " +
      "text='hello-pattern-c' をechoさせてください。結果が返ってきたら、サブエージェントの実行は" +
      "完了した状態のまま、あなた自身はまだ何もせず10秒待ってから終了してください" +
      "(待つ際はToolやsleepではなく、単に何もツールを呼ばずに完了を報告する形で構いません)。",
    options: {
      mcpServers: {
        mcpverify: {
          type: "stdio",
          command: "uv",
          args: ["run", "--directory", PY_SERVER_DIR, "main.py"],
        },
      },
      agents: {
        echoer: {
          description: "mcpverify の echo ツールを使ってテキストをechoするだけのサブエージェント",
          prompt:
            "あなたはechoするだけのサブエージェントです。mcp__mcpverify__echo ツールを使って" +
            "指示されたテキストをechoし、結果を報告してください。",
          tools: ["mcp__mcpverify__echo"],
        },
      },
      allowedTools: ["Task", "mcp__mcpverify__echo"],
      disallowedTools: ["Bash", "Write", "Edit", "Read", "Glob", "Grep", "WebFetch", "WebSearch"],
      permissionMode: "bypassPermissions",
      maxTurns: 8,
    },
  });

  let taskDoneAt: number | null = null;

  for await (const msg of q) {
    console.log(`[msg] type=${msg.type}` + (msg.type === "result" ? ` subtype=${(msg as any).subtype}` : ""));
    if (msg.type === "assistant") {
      const content = (msg as any).message?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c.type === "text") console.log("  assistant text:", c.text);
          if (c.type === "tool_use") console.log("  tool_use:", c.name, JSON.stringify(c.input).slice(0, 200));
        }
      }
    }
    if (msg.type === "user") {
      const content = (msg as any).message?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c.type === "tool_result") {
            const preview = JSON.stringify(c.content).slice(0, 200);
            console.log("  tool_result:", preview);
            if (preview.includes("hello-pattern-c") || preview.includes("echo:")) {
              taskDoneAt = Date.now();
              console.log(`  >>> subagent task appears to have completed at t=${taskDoneAt}`);
            }
          }
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
