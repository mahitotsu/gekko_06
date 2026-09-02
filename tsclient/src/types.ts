// 検証の2軸。これ以外の条件は constants.ts で固定し、全シナリオで共有する。

/** セッションがどう終わるか(終了トリガー)。 */
export type Trigger =
  | "normal-completion" // for-awaitループを最後まで回す
  | "interrupt" // query.interrupt() で中断する
  | "subagent" // サブエージェント経由でMCPツールを呼ぶ
  | "kill-cli" // claude CLIプロセスを外部からSIGKILL
  | "kill-node"; // Node.jsホストプロセスを外部からSIGKILL

/** MCPサーバーがどれだけ行儀が良い/悪いか。 */
export type ServerBehavior =
  | "normal" // シグナル・stdin EOFに素直に応答する
  | "ignore-signals" // シグナルは無視するが、stdin EOFには応答する
  | "ignore-signals-and-eof"; // シグナルもstdin EOFも無視し、居座ろうとする

export const ALL_TRIGGERS: Trigger[] = ["normal-completion", "interrupt", "subagent", "kill-cli", "kill-node"];
export const ALL_BEHAVIORS: ServerBehavior[] = ["normal", "ignore-signals", "ignore-signals-and-eof"];

export interface ServerEvent {
  ts: string;
  pid: number;
  event: string;
  [key: string]: unknown;
}

/** 1回の生死ポーリングの記録。 */
export interface LivenessSample {
  atMs: number; // 観測開始(=終了トリガー発火)からの経過ミリ秒
  alive: boolean;
}

export interface ProcessOutcome {
  pid: number | null;
  /** 観測対象になった時点で既にaliveだったか(見つからなければnull)。 */
  samples: LivenessSample[];
  /** 生存→死亡に切り替わった最初のサンプルのatMs。観測終了まで生存していればnull。 */
  diedAtMs: number | null;
  /** 観測窓の終わりまで生存し続けたか。 */
  aliveAtWindowEnd: boolean;
}

export interface ScenarioResult {
  trigger: Trigger;
  behavior: ServerBehavior;
  /** 終了トリガーが発火した瞬間(観測窓の起点、epochMs)。 */
  triggerAt: string;
  /** 観測窓が終わった(=このシナリオの記録を書き出した)瞬間。 */
  finishedAt: string;
  /** サーバー(python3)の生死追跡。 */
  server: ProcessOutcome;
  /** CLI(claudeバイナリ)の生死追跡。全トリガー共通でwork_started時点のPIDから追跡する。
   * pidがnullなのは、その時点でCLI候補プロセスが1つに定まらなかった場合のみ。 */
  cli: ProcessOutcome;
  /** サーバー自身が書いた構造化イベントログの中身(あれば)。 */
  serverEvents: ServerEvent[];
  notes: string[];
}
