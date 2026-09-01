# Claude Agent SDK (TypeScript) — stdio MCPサーバー(`uv run`)の子プロセス終了検証

## 検証環境

| 項目 | バージョン |
|---|---|
| `@anthropic-ai/claude-agent-sdk` (npm) | 0.3.252 |
| SDKが内部で使用するClaude Code CLI (`claudeCodeVersion`, sdk.mjs同梱) | 2.1.252 |
| システムにインストール済みの `claude --version` | 2.1.162 (Claude Code) |
| Node.js | v24.11.1 |
| uv | 0.9.18 |
| Python (uvプロジェクト) | 3.12 |
| mcp (Python SDK, FastMCP) | 1.29.1 (`mcp<2` に固定。2.xはFastMCPがMCPServerへ改名されAPI非互換のため) |

> SDKは `node_modules/@anthropic-ai/claude-agent-sdk` にCLI本体(`sdk.mjs`)を同梱しており、
> システムPATH上の `claude` バイナリとは別バージョンが使われる点に注意(2.1.252 vs 2.1.162)。

## 検証構成

- [pyserver/main.py](pyserver/main.py) — 最小構成のFastMCP stdioサーバー。起動時に自分のPIDを
  `run/server.pid` に書き出し、ログはすべてstderrに出す。ツールは `echo`(即時応答)と
  `slow_echo`(指定秒数sleepしてから応答、中断検証用)の2つ。
- [tsclient/pattern-a.ts](tsclient/pattern-a.ts) — 正常終了パターン。`query()` のfor-awaitを最後まで回す。
- [tsclient/pattern-b.ts](tsclient/pattern-b.ts) — 中断パターン。`slow_echo` のtool_use検出直後に
  `query.interrupt()` を呼ぶ。
- [tsclient/pattern-c.ts](tsclient/pattern-c.ts) — サブエージェント経由パターン。`agents` オプションで
  `echoer` サブエージェントを定義し、Task(Agent)ツール経由で `mcp__mcpverify__echo` を呼ばせる。
- [tsclient/run-pattern-*-monitored.sh](tsclient/run-pattern-a-monitored.sh) — 各パターンの実行と並行して
  0.2秒間隔でサーバーPIDの生死(`kill -0`)をポーリングし、スクリプト終了後も30秒間(5秒おき)追跡するラッパー。
  結果は `run/pattern-*-timeline.log` に記録。

すべて `mcpServers: { mcpverify: { type: "stdio", command: "uv", args: ["run", "--directory", ..., "main.py"] } }`
として登録し、`allowedTools` で該当MCPツールのみを許可、`disallowedTools` でBash等を明示的に禁止して
サーバーが確実に使われるようにした。

## 検証結果

| パターン | 即座に終了したか | 終了までの遅延 | 30秒後まで生存し続けたか |
|---|---|---|---|
| A: 正常終了(for-awaitを最後まで回す) | ほぼ即座 | for-awaitループが最終result受信後、**約0.53秒**でプロセス消滅を検知(Node側スクリプトの`main()`完了より前) | 生存せず。以降30秒間(POSTCHECK)もDEADのまま |
| B: 中断(`query.interrupt()`をtool_use中に呼ぶ) | ほぼ即座 | `interrupt()`呼び出しから**約0.36秒**でプロセス消滅を検知(sleep 20秒の`slow_echo`実行中に強制終了) | 生存せず。以降30秒間もDEADのまま |
| C: サブエージェント(Task)経由 | サブエージェント終了時点では**終了しない**。トップレベルのquery()セッション終了時に終了 | サブエージェントのMCP呼び出し完了(tool_result受領)から**約2.5秒後**(=セッション全体の`result`メッセージ後)にプロセス消滅を検知 | 生存せず。以降30秒間もDEADのまま |

いずれのパターンでも、明示的なkillを行わずとも子プロセス(`uv run` が起動したPythonのFastMCPプロセス)は
数百ミリ秒〜数秒以内に自然終了し、その後30秒間の追跡でも再生存(ゾンビ化・孤児化)は確認されなかった。

### 各パターンの詳細タイムライン(抜粋、Unixエポック秒)

**Pattern A**
```
1788271672.742  DEATH_DETECTED (state ALIVE→DEAD)
1788271673.270  NODE_SCRIPT_EXIT code=0   (= 死亡検知の 0.528秒後)
```
→ `for await` ループが `result` メッセージを受け取って抜けるのとほぼ同時(むしろ少し先行して)、
SDKがMCPサーバーのstdio接続を閉じ、子プロセスを終了させている。スクリプト側で明示的なクリーンアップは一切書いていない。

**Pattern B**
```
1788271757.906  tool_use: mcp__mcpverify__echo(slow_echo) 検出 (20秒sleep開始直後)
1788271759.412  query.interrupt() 呼び出し
1788271759.772  DEATH_DETECTED                  (= interrupt呼び出しの 0.36秒後)
1788271760.212  NODE_SCRIPT_EXIT code=1          (= 死亡検知の 0.44秒後。interruptによりresult subtype=error_during_executionとなりmain()がcatchでexitCode=1)
```
→ サーバー側がまだ20秒のsleepループの途中(1〜2秒しか経過していない状態)でも、`interrupt()` は
子プロセスを速やかに終了させた。サーバーのstderrログ上でも `slow_echo still sleeping...` が
数回しか出ない段階で打ち切られている。

**Pattern C**
```
1788271842.646  サブエージェント内のmcp__mcpverify__echo tool_result 受領
1788271844.130  Agent(Task)ツール全体のtool_result受領 (=サブエージェント完了)
1788271846.670  DEATH_DETECTED                  (= サブエージェント完了の 2.54秒後。トップレベルのassistantまとめ+resultメッセージの後)
1788271847.070  NODE_SCRIPT_EXIT code=0          (= 死亡検知の 0.40秒後)
```
→ MCPサーバーはセッション単位で1プロセスのみ起動され、サブエージェント専用の別プロセスにはならない。
サブエージェントのタスクが完了してもMCPサーバーは終了せず、**トップレベルの`query()`セッション自体が
終了するタイミング**まで生き続ける。

## 結論

- 3パターンいずれも、`uv run` で起動したstdio MCPサーバーの子プロセスは、`query()` セッション終了に
  伴ってSDK側が自発的に(明示的なkill処理をアプリコードに書かなくても)速やかに終了させる。
  観測された遅延はいずれも1秒未満〜数秒程度で、30秒経過後も残り続けるケースは1件もなかった。
- 正常終了(A)・中断(B)は、いずれもその場でのターン/セッション終了と同時にほぼ即座(0.5秒前後)に
  子プロセスが消える。
- サブエージェント経由(C)は、MCPサーバーがセッションスコープのリソースであるため、
  **個々のサブエージェントの完了では終了せず**、トップレベルの`query()`セッションが完全に終わるまで
  生存し続ける点が他の2パターンと異なる。長時間動くサブエージェントを多用する構成では、
  MCPサーバーは「セッションが生きている間ずっと立ち上がったまま」という前提で設計する必要がある。
- 今回の検証範囲では「明示的にkillするまで残り続けた」ケースは確認されなかった。ネットワーク越しの
  SSE/HTTP MCPサーバーや、プロセスが後述のシグナルを無視するような実装の場合の挙動は本検証の対象外。

## 終了要因の実測(推測ではなく検証済み)

初版のレポートでは終了メカニズムを「stdinクローズ等によるMCPサーバー側の自発終了」と推測で記述していたが、
実際には検証していなかった。そこで [pyserver/main.py](pyserver/main.py) に

- `SIGTERM` / `SIGINT` / `SIGHUP` のシグナルハンドラ
- SDK/CLIからは見えない、サーバー自身が独立に書き込む終了要因ログ(`run/server-shutdown-cause.log`)

を追加し、A/B/Cすべてを再実行して実測した。結果、**3パターンすべてで `SIGINT` と `SIGTERM` がほぼ同時
(1ミリ秒未満の差)に子プロセスへ届いており**、stdinのEOFによる自然終了(`mcp.run()`の自発的なreturn)は
一度も観測されなかった。`SIGKILL`も一度も観測されず、`SIGTERM`ハンドラ内の`sys.exit()`でプロセスは
正常に終了できていた。

パターンAの生ログ例(`run/server-shutdown-cause.log`):
```
2026-09-01T14:15:35.261305+00:00 pid=136409 STARTED
2026-09-01T14:15:40.978714+00:00 pid=136409 SIGNAL_RECEIVED signal=SIGINT(2)
2026-09-01T14:15:40.979282+00:00 pid=136409 SIGNAL_RECEIVED signal=SIGTERM(15)
2026-09-01T14:15:41.680239+00:00 pid=136409 SYSTEM_EXIT code=130
2026-09-01T14:15:41.680331+00:00 pid=136409 PROCESS_EXITING
```
パターンB・Cもシグナルの種類・到達順(SIGINT→SIGTERM、ほぼ同時)は同一だった。

**未確認事項**: この`SIGINT`/`SIGTERM`が子プロセス単体への`kill()`なのか、プロセスグループ全体への
送信なのかは切り分けていない。また、SDKが内蔵する`sdk.mjs`(バンドル・難読化済み)のソースレベルでの
該当処理箇所までは追っていない。あくまで「サーバー側から見て何が届いたか」の実測に基づく報告である。
