# Claude Agent SDK (TypeScript) — stdio MCPサーバー(`uv run`)の子プロセス終了検証

> このMarkdown版は構造化ハーネスの実行結果を中心にまとめた作業記録です。読み物としての
> 最終版は [report.html](report.html) を参照してください。

## 検証環境

| 項目 | バージョン |
|---|---|
| `@anthropic-ai/claude-agent-sdk` (npm) | 0.3.252 |
| SDKが内部で使用するClaude Code CLI (`claudeCodeVersion`, sdk.mjs同梱) | 2.1.252 |
| システムにインストール済みの `claude --version` | 2.1.162 (Claude Code) |
| Node.js | v24.11.1 |
| uv | 0.9.18 |
| Python (uvプロジェクト) | 3.12 |
| mcp (Python SDK, FastMCP) | 1.29.1 (`mcp<2` に固定) |

> SDKは `node_modules/@anthropic-ai/claude-agent-sdk-linux-x64` にCLI本体(単一実行バイナリ)を
> 同梱しており、システムPATH上の `claude` バイナリとは別バージョンが使われる。

## 検証手法:2軸を固定した構造化ハーネス

初期のドラフトはパターンごとにスクリプトをコピーして作っていたため、ポーリング間隔・観察時間・
ツール呼び出しの秒数などが検証パターンごとにばらばらになっていた。「検証対象以外の条件を揃える」
という基本に立ち返り、`tsclient/` を以下の構造に作り直した(詳細は [tsclient/README.md](tsclient/README.md))。

検証対象の軸は2つだけ:

- **Trigger**(終了トリガー): `normal-completion` / `interrupt` / `subagent` / `kill-cli` / `kill-node`
- **ServerBehavior**(MCPサーバーの行儀): `normal` / `ignore-signals` / `ignore-signals-and-eof`

この2軸**以外**の条件(ポーリング間隔200ms、観察時間90秒、ツール呼び出し秒数6秒、許可ツール、
permissionMode等)は `tsclient/src/constants.ts` に一箇所だけ定義し、全15シナリオで共有している。
セッション/プロセスの対応関係(逐次・並列)は、この2軸とは別の関心事として `runTopology.ts` に分離した。

同期も「sleep(N)による当てずっぽう」をやめ、MCPサーバー自身が書く構造化JSONLイベントログ
(`work_started`/`work_finished`/`signal_received`/...)を監視するイベント駆動方式にした。

## 結果: Trigger × ServerBehavior フルマトリクス(15/15、実測)

`npx tsx runMatrix.ts` で全組み合わせを逐次実行し、`npx tsx renderMatrix.ts` で
`results/*.json` から機械的に生成した表(手書きではない):

| trigger | behavior | server(MCPサーバー) | cli(claudeプロセス) |
|---|---|---|---|
| normal-completion | normal | 死亡 (+0.00s) | n/a |
| normal-completion | ignore-signals | 死亡 (+0.00s) | n/a |
| normal-completion | ignore-signals-and-eof | 死亡 (+0.85s) | n/a |
| interrupt | normal | 死亡 (+0.00s) | n/a |
| interrupt | ignore-signals | 死亡 (+1.04s) | n/a |
| interrupt | ignore-signals-and-eof | 死亡 (+1.04s) | n/a |
| subagent | normal | 死亡 (+0.00s) | n/a |
| subagent | ignore-signals | 死亡 (+0.00s) | n/a |
| subagent | ignore-signals-and-eof | 死亡 (+0.83s) | n/a |
| kill-cli | normal | 死亡 (+6.19s) | 死亡 (+0.20s) |
| kill-cli | ignore-signals | 死亡 (+6.15s) | 死亡 (+0.20s) |
| kill-cli | ignore-signals-and-eof | 死亡 (+6.20s) | 死亡 (+0.20s) |
| kill-node | normal | 死亡 (+8.56s) | 死亡 (+8.96s) |
| kill-node | ignore-signals | 死亡 (+8.33s) | 死亡 (+8.74s) |
| kill-node | ignore-signals-and-eof | 死亡 (+13.50s) | 死亡 (+12.65s) |

(cli列の「+N秒」はトリガー発火からの経過時間。kill-cli/kill-nodeの`cli`はkill対象そのものなので、
死亡検知は「本当にkillできたか」の確認。normal-completion/interrupt/subagentではCLIの生死追跡自体を
行っていない(トリガーがCLI外部からの操作ではないため)。全15シナリオで「CLI候補プロセスがちょうど
1つ見つからなかった」という警告は0件——後述のバグ修正後は毎回正確に対象プロセスを特定できている。)

### トポロジー確認(2軸とは別枠)

`npx tsx runTopology.ts` の結果:

- **逐次**: メインNode.jsプロセスを終了させずに2回`query()`を実行すると、MCPサーバーは別PIDで
  立ち上がり直す(`samePid: false`)。1回目のセッション終了後、そのサーバーは既に死亡している。
- **並列**: 2つの`query()`を同時実行すると、2つのMCPサーバーが**同時刻に**生存する
  (`bothAliveAtSameInstant: true`)。共有やロック待ちはない。

## 主な発見

### 1. 正常系(normal-completion / interrupt / subagent)は一貫して即座〜1秒程度で終了する

行儀の良いサーバー(`normal`)は全トリガーで実質0秒(次のポーリングサンプルで既に死亡)。
シグナルを無視するだけの`ignore-signals`は、stdin EOFで自然終了するため大きな差はない
(interruptトリガーのみ約1.0秒——中断処理そのものにかかる時間)。

### 2. `normal-completion × ignore-signals-and-eof`: 「query()完了」と「MCPサーバーの後始末完了」は別のタイミング

表では0.85秒と、初期ドラフト(Pattern F、約5.8秒)よりずっと短く見えるが、これは矛盾ではなく
**測定の基準点が違う**。イベントログを詳しく見ると、CLIは`work()`の結果を受け取った後、シグナルを
送り(無視され)、無視されたシグナルへの対応(再試行ループの末の強制終了)を**バックグラウンドで
続けながら**、ほぼ同時にターン自体を完了させて`query()`の結果を返している。つまり:

- 呼び出し側から見た「`query()`のfor-awaitループが終わる瞬間」と、
- CLIが実際にMCPサーバーの後始末を終える瞬間

はイコールではない。今回の測定は前者を基準点にしているため、「`query()`が完了してから実際に
プロセスが消えるまで」は約1秒未満で済んでいるように見えるが、その裏では既にシグナル送信〜
再試行〜強制終了のシーケンス(合計で約5.5秒)がバックグラウンドで進行しており、たまたま
`query()`の完了タイミングがその終盤(強制終了の直前)と重なっていた、というのが実態である。

**実務上の含意**: `for await (const msg of query())`のループが終わった直後に「MCPサーバーは
もう存在しない」と仮定するのは、行儀の悪いサーバーの場合は安全ではない。数秒のバックグラウンド
後始末が続いている可能性がある。

### 3. `kill-cli`: サーバーの死亡タイミングは「シグナル」ではなく「次にI/Oしようとするタイミング」で決まる

3つの行儀すべてで、サーバーの死亡は**約6.15〜6.20秒後**とほぼ同一だった。これはワークツールの
呼び出し秒数(`WORK_SECONDS=6`)とほぼ一致する。イベントログを見ると、シグナルは一切送られておらず、
サーバーは`work()`の`time.sleep(6)`をブロッキングのまま最後まで実行し、完了後に結果を書き込もうと
した瞬間に壊れたパイプ(uvも道連れに死んでいる)を検知してクラッシュしている。

つまり「行儀が良いか悪いか」はこの経路では無関係——`time.sleep()`のように何のI/Oも行わない処理を
実行中は、シグナルハンドラの有無に関係なく、そのブロッキング処理が終わるまで死を検知できない。
死亡タイミングは概ね「トリガー発火時点で残っていたツール処理時間」で決まる。

### 4. `kill-node`: CLIは孤児化しても、いずれ自分から終了する(旧検証の結論を訂正)

初期のドラフト(パターンJ/K)では「Node.jsプロセスが死ぬと、CLIは観測した範囲(最大60秒)では
自己終了しない」と結論づけていたが、これは**観察時間が短すぎたことによる誤り**だった。

今回、全シナリオに一律90秒の観察窓を適用した結果:

- `kill-node × normal` / `ignore-signals`: CLIは約**8.7〜9.0秒後**に自己終了
- `kill-node × ignore-signals-and-eof`: CLIは約**12.7秒後**に自己終了(サーバー側のSIGKILL
  エスカレーション待ちの分、通常より4〜5秒長い)

CLIはホストプロセス(Node.js)が死んで孤児になっても、進行中のツール呼び出しが終わるのを待ち、
通常のターン完了処理(MCPサーバーへのSIGINT/SIGTERM送信、応答がなければ最終的な強制終了)を
一通り済ませたうえで、自分自身も終了している。**「孤児プロセスが無期限に残り続ける」という
リスクは、少なくとも本検証で試した範囲では確認されなかった**——ただし現在進行中のツール呼び出しが
終わるまでの時間だけ、実際には終了までの猶予がある。

## 検証中に見つけた実装上の注意点(このハーネス自体のバグ)

`kill-cli`/`kill-node`トリガーでは、対象の`claude` CLIプロセスをシステム全体から
`pgrep -f "claude-agent-sdk-.*/claude"` で検索していたが、これは**この検証環境(VS Code拡張の
ホストプロセス上)では、無関係な別セッションが起動した同名バイナリのプロセスを誤って
拾ってしまう危険があった**。実際、あるテスト実行で「このテストの起動より前から存在していた、
より小さいPIDのプロセス」をkillしてしまっていたことが判明した。

対策として、`ps -eo pid,ppid,cmd` からプロセスツリーを構築し、**自分がspawnしたinnerSessionの
子孫プロセスの中からのみ**CLIを探す方式(`findClaudeCliPidsUnder()`)に修正した。候補が0件または
複数件のときはkillを見送り、結果に記録するだけにして安全側に倒している。

## MCP公式仕様との比較

[MCP公式仕様(2025-06-18)のLifecycle章](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle#shutdown)は、stdio transportのシャットダウン手順を次のように定めている:

> 1. まずサーバーへの入力ストリーム(stdin)を閉じる
> 2. サーバーの終了を待つ。合理的な時間内に終了しなければ`SIGTERM`
> 3. `SIGTERM`後も終了しなければ`SIGKILL`

実測(正常系シナリオ)では、`SIGINT`と`SIGTERM`が1ミリ秒未満の差でほぼ同時に送られており、
「様子見」の段階は観測されなかった。stdin EOFのクローズも(シグナルと)並行して行われているらしく、
`ignore-signals`(シグナル無視、EOF応答)のケースでも問題なく終了できている。

また、[Transports章 Session Management節](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#session-management)によれば、"session"の対応関係はtransportごとに異なる。stdioでは
セッションIDという概念自体が存在せず、「1回のサブプロセス起動 = 1セッション」が構造的に固定される。
今回のトポロジー確認の結果(逐次・並列いずれも別PID)はこれと整合する。

## Claude Code / Agent SDK公式ドキュメントとの比較

- **記載あり**: 「1 agent session = 1 subprocess」という粒度([Agent SDK — Hosting the Agent SDK](https://code.claude.com/docs/en/agent-sdk/hosting)「The subprocess model」)、MCPサーバーの接続タイミングや
  ステータス遷移([Agent SDK — Connect to external tools with MCP](https://code.claude.com/docs/en/agent-sdk/mcp)「Connection timing」「Error handling」)。
- **記載なし**: stdio MCPサーバーの子プロセスをいつ・どうやって終了させるか(シグナルの種類・
  タイミング)、ホストプロセスがクラッシュした場合の子プロセスの扱い。今回の検証はこの
  未文書化領域を実測で埋めるものである。

## 実務への示唆

- 正常系の後始末は自分で書く必要はない。`query()`セッションが終われば、MCPサーバーの子プロセスは
  1秒未満〜数秒以内にSDK側(CLI・`uv run`)が終了させる。
- 実行中のツール呼び出しがI/Oを伴わないブロッキング処理(例: 純粋な計算やsleep)の場合、CLI/uvが
  死んでも、その処理が終わるまでMCPサーバーは終了を検知できない。長時間のブロッキング処理を
  伴うツールを設計する際は、定期的なI/O(進捗通知など)を挟むと異常検知が速くなる可能性がある。
- ホストプロセス(Node.js)が異常終了しても、CLIは孤児化した状態で進行中のターンを完了させ、
  通常の後始末を経てから自分自身も終了する。ただし何十秒か余分にプロセスが残る可能性はあるため、
  短命コンテナやサーバーレス環境では、プロセスグループごと確実に片付ける監督者を用意しておくのが
  安全。

## 再現方法

```bash
cd tsclient
npm run matrix              # 全15組み合わせを実行(所要時間: 約15〜20分)
npm run topology              # セッション/プロセスの対応関係の確認
npm run render                  # results/*.json から決定表(Markdown)を生成
```

検証一式(Pythonサーバー・TypeScriptハーネス・実測ログ・本レポート)は本リポジトリにコミット済み。
SSE/HTTP型MCPサーバーでの挙動、および`interrupt`/`subagent`/逐次・並列セッションと
`kill-cli`/`kill-node`の組み合わせ(計10セル)は、今回のマトリクスには含めていない
(既に検証した独立要因の組み合わせであり、新しい終了経路を生むとは考えにくいという判断による)。
