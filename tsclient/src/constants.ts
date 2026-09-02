// 「検証対象(Trigger × ServerBehavior)以外の条件を同じにする」を守るための、
// 全シナリオで共有する固定パラメータ。個々のシナリオ実装はここの値を変更してはならない。

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..", "..");
export const PY_SERVER_DIR = path.join(REPO_ROOT, "pyserver");
export const RUN_DIR = path.join(REPO_ROOT, "run");
export const RESULTS_DIR = path.join(REPO_ROOT, "results");

/** プロセス生存確認のポーリング間隔。全シナリオ共通。 */
export const POLL_INTERVAL_MS = 200;

/** 終了トリガー発火後、生死を観察し続ける時間。全シナリオ共通。
 * (ignore-signals-and-eofが最終的にSIGKILLされるまで約5.8〜58秒かかった実績があるため、
 *  安全マージンを見て一律この値を使う。) */
export const OBSERVE_WINDOW_MS = 90_000;

/** MCPサーバーが起動しPIDファイルを書くまでのタイムアウト。 */
export const SERVER_READY_TIMEOUT_MS = 20_000;

/** workツールの呼び出し秒数。全シナリオ共通(この秒数の間だけツール呼び出しが「実行中」になる)。 */
export const WORK_SECONDS = 6;

export const PERMISSION_MODE = "bypassPermissions" as const;
export const MAX_TURNS = 5;

/** query()に渡す disallowedTools の基本セット。Bash等の抜け道を塞ぎ、MCP経由でしか
 * 目的を達成できない状況を作る。subagentトリガーのみTaskを許可するため個別に組み立てる。 */
export const BASE_DISALLOWED_TOOLS = ["Bash", "Write", "Edit", "Read", "Glob", "Grep", "WebFetch", "WebSearch"];
