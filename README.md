# Slack Comment Flow

Web 版 Slack のチャンネルに投稿されたコメントを、ニコニコ動画風に Chrome タブ上へ流す Chrome 拡張機能です。

画面共有をしながら発表している最中に、Slack の実況コメントを発表画面の上に流すことを想定しています。

[m-narin/google-meet-comment-flow](https://github.com/m-narin/google-meet-comment-flow) をベースに、コメント取得部分を Google Meet のチャットから Slack のメッセージ一覧に差し替えたものです。コメントを流す側のロジックはそのままです。

ストアには公開していないので、下記の手順で local に読み込んで使います。

## local で試す方法

この Project を clone します。root で

```sh
npm install
```

```sh
npm run build
```

これにより、`/dist`が作成されます。（Vite による chrome 拡張機能の build）

`chrome://extensions/` = 拡張機能管理ページを開き、右上の「デベロッパー モード」ボタンを ON

「パッケージ化されていない拡張機能を読みこむ」にて`/dist`フォルダーを選択。
これにより拡張機能が有効化されます。

## 動作方法

まず Web 版 Slack（`https://app.slack.com/`）を開き、実況コメントを流したいチャンネルを表示しておきます。

**このタブは開いたままにしておいてください。** ここに表示されているメッセージ一覧からコメントを取得するので、閉じたり別のチャンネルに切り替えたりすると取得できなくなります。

右上の拡張機能設定から有効化し、色と大きさを選択できます。

| 項目             | 説明                                             |
| ---------------- | ------------------------------------------------ |
| Color            | 流れるコメントの文字色                           |
| Font Size        | 流れるコメントの文字サイズ（XS / S / M / L / XL）|
| Enable Streaming | ON にするとコメントが流れ始めます                |

この状態で Slack のチャンネルにコメントが投稿されると、focus している chrome タブ上に流れるようになります。

Slack のタブは裏に置いたまま、発表資料などを表示している別のタブを前面にしておけば、そのタブの上にコメントが流れます。

なお、対象は**新規投稿のみ**です。有効化した時点ですでに表示されている過去のメッセージや、既存メッセージの編集は流れません。

修正を加え反映させる場合は下記の手順となります。

1. `npm run build`
2. 拡張機能管理ページから再読み込み
3. 画面リロード

## 実装メモ

### コメントの取得

`src/contentScripts/saveComment.ts` で Slack のメッセージ一覧を `MutationObserver` で監視しています。

- メッセージ 1 件は `[data-qa="message_container"]` で、`data-msg-ts` に Slack のタイムスタンプ、`data-msg-channel-id` にチャンネル ID が入っています
- 本文は `.p-rich_text_section` の中にリッチテキストとして描画されます
- Slack のメッセージ一覧は仮想リストなので、スクロールしただけでも過去のメッセージが DOM に追加されます。そのため「監視を始めた時点の最新メッセージ」を baseline とし、それより新しい `ts` のメッセージだけを流しています（チャンネルを切り替えたときは baseline を引き直します）
- 短時間に複数のコメントが届いた場合は、キューに積んで一定間隔で流します

### テキストの抽出

`src/contentScripts/utils/extractMessageText.ts` で、リッチテキストからタグを除去してテキストのみを取り出しています。

単純な `textContent` だと送信者名・時刻・スクリーンリーダー用の重複テキストまで混ざってしまうため、下記を行っています。

- `hidden` / `aria-hidden="true"` / `.sr-only` / `data-stringify-ignore` の要素を除外する
- `<br>` と `.c-mrkdwn__br`（段落区切り）は半角スペースにする
- 絵文字は `<img>` なのでテキストが取れない。`alt`（`:raised_hands:` 形式）を使う
- 「（編集済み）」ラベル（`.c-message__edited_label`）は本文ではないので除外する
- 一行に流すため、改行や連続する空白は半角スペース一つにまとめる

実際の Slack の HTML（リポジトリ外の `slack_comment_sampke.html`）に対して抽出した結果は下記のようになります。

```text
"Slackの実況コメントをChromeタブ上に流すツールを開発してみる。 参考 github.com/m-narin/google-meet-comment-flow これのコメント取得ロジックを主に修正する。 Web版Slackで特定のchを開いて、コメント取得する。"
"p-rich_text_section タグ等が入っているのは除外し、テキストのみを取得する:バンザイ:"
"zoomの画面共有許可する"
```

### コメントを流す

`src/background/injectComment.ts` がコメントを流す処理です。ベースにした google-meet-comment-flow からそのままです。

focus している chrome タブに `chrome.scripting.executeScript` で `<span>` を差し込み、Web Animations API で右から左へ動かしています。

## License

MIT License. ベースにした [m-narin/google-meet-comment-flow](https://github.com/m-narin/google-meet-comment-flow) の著作権表示を `LICENSE` に引き継いでいます。
