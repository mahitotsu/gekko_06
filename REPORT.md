# Claude Agent SDK (TypeScript) — stdio MCPサーバー(`uv run`)の子プロセス終了検証

> このMarkdown版は生ログ中心の作業記録です。読み物としてまとめた最終版は
> [report.html](report.html)(ブログ形式、11パターン全ての実測データ・タイムライン図・
> MCP仕様/公式ドキュメントとの比較付き)を参照してください。
> ローカルで開くか、公開版は https://claude.ai/code/artifact/255316b1-e8b1-4c7f-a2e5-9502016c303c 。

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
終了するタイミング**まで生き続ける。これはパターンDの結果(MCPサーバーは`query()`=セッション単位に
紐づき、それより粒度の細かい単位(サブエージェント)にも粗い単位(メインNode.jsプロセス)にも紐づかない)
と整合する。

## パターンD: メインNode.jsプロセスは終了させず、`query()`を2回連続実行

「セッション(query()呼び出し)に紐づくのか、メインプロセスに紐づくのか」を切り分けるため、
[tsclient/pattern-d.ts](tsclient/pattern-d.ts) で同一Node.jsプロセス内で `query()` を2回連続実行し、
1回目のMCPサーバーPIDと2回目のMCPサーバーPIDを比較した。メインNode.jsプロセス自体は一度も終了させていない。

```
main Node.js process pid = 138606
[query#1] query() finished. server pid=138684
[query#1] immediately after: pid=138684 alive=false
=== メインNodeプロセスは終了させず、続けて2回目のquery()を開始します ===
[query#2] query() finished. server pid=138797
[query#2] immediately after: pid=138797 alive=false
pid1=138684, pid2=138797, same_pid=false
→ 異なるプロセスが起動された(query()=セッション単位でMCPサーバーが立ち上げ直されている)
```

**結果**: メインNode.jsプロセス(pid=138606)は2回のquery()の間ずっと生存し続けたにもかかわらず、
1回目と2回目で**別のPID**のMCPサーバープロセスが起動された。これにより、MCPサーバープロセスの
ライフサイクルは「メインNode.jsプロセスの生存期間」ではなく「個々の`query()`呼び出し
(= CLIプロセス1回分の起動、実質的にMCPの1セッション)」に紐づいていることが実測で確認できた。

## MCP仕様における正しい挙動(公式仕様の確認)

[MCP公式仕様(2025-06-18) Lifecycle章](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle#shutdown)
には、stdio transportのシャットダウン手順が明記されている:

> For the stdio transport, the client SHOULD initiate shutdown by:
> 1. First, closing the input stream to the child process (the server)
> 2. Waiting for the server to exit, or sending `SIGTERM` if the server does not exit within a reasonable time
> 3. Sending `SIGKILL` if the server does not exit within a reasonable time after `SIGTERM`

つまり仕様が推奨するのは「**stdinクローズ → 様子見 → SIGTERM → 様子見 → SIGKILL**」という段階的な
エスカレーションである。しかし本検証の実測(A/B/Cすべて)では、`SIGINT`と`SIGTERM`が1ミリ秒未満の差で
ほぼ同時に送られており、stdinクローズを起点とした「様子見」の段階は観測されなかった。これは
**Claude Code CLIのMCPクライアント実装が、仕様が推奨する段階的シャットダウンではなく、即座の
シグナル送信で終了させている**ことを示す(未定義動作というわけではないが、仕様の"SHOULD"からは外れる)。

また[同仕様 Transports章 Session Management節](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#session-management)
によれば、"session"(セッション)は「`initialize`から始まる、論理的に関連したクライアント-サーバー間の
やり取り」と定義されるが、その対応関係はtransportによって異なる:

- **stdio**: セッションIDという概念自体が存在しない。クライアントがサブプロセスを起動し、そのプロセスの
  標準入出力を使って1対1で通信する構造上、**「1回のサブプロセス起動 = 1セッション」が構造的に固定**される。
  プロセスがステートを保持するなら、それは必然的にそのセッション1つ分のスコープにしかならない
  (プロセスを跨いだ状態共有はtransport上不可能)。
- **Streamable HTTP**: `Mcp-Session-Id` ヘッダで明示的にセッションを識別する。**1つの長命なサーバー
  プロセスが複数のクライアントセッションを同時に処理できる**設計になっており、セッションとプロセスは
  分離されている。サーバー実装は、セッションIDごとに状態を分離して保持する責任を負う。

**この検証(stdio + `uv run`)への示唆**: 今回のようにstdio transportでMCPサーバーを起動する構成では、
仕様の設計上「1 `query()` = 1 MCPサーバープロセス = 1セッション」が正しい(というより必然の)挙動であり、
Pattern Dの実測結果はこれと整合する。もし複数の`query()`呼び出しをまたいでMCPサーバー側の状態を
保持したい場合、stdio transportではなくStreamable HTTP transportで長命なサーバープロセスを立て、
セッションID単位で状態を管理する設計にする必要がある。

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

**追記(プロセスツリー調査により一部確認できた)**: [pattern-tree.ts](tsclient/pattern-tree.ts) で
`slow_echo`(15秒sleep)を使いMCPサーバーを稼働させたまま `ps --forest` で観察したところ、実際の
プロセス親子関係は次の通りだった(cmdlineも実測):

```
claude (CLI本体, 実体は node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude という
        プラットフォーム別の単一実行バイナリ。sdk.mjsはこれをspawnする側のJSライブラリ)
  └─ uv run --directory .../pyserver main.py
       └─ python3 main.py   (= mcpverifyサーバー本体。uvはexecで自身を置き換えていない)
```

このとき検証スクリプト自身(Node/tsx側の祖先プロセス群)はSIGTERMの影響を一切受けず動作を継続していた
ことから、**プロセスグループ全体への一斉kill ( `kill(-pgid)` ) ではなく、`claude`が直接の子である`uv`を
狙って終了させ、`uv`がそれを子の`python3`へ中継(フォワード)している**、という説明が最も整合的である。
ただし、これは状況証拠からの推論であり、`claude`バイナリ本体は214MBのコンパイル済み単一実行ファイルで
現実的に逆解析できなかったため、`kill()`が具体的にどのAPI・引数で呼ばれているかのソースレベルでの
確認はできていない(未確認のまま報告する)。
