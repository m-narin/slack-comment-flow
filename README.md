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

### Google スライドのスライドショーで使う場合

**うまく流れない場合は、全画面表示ではなく「ウィンドウ表示」のスライドショーを使ってください。**

全画面表示（Fullscreen API）中の要素は **top layer** という特別な層に上がり、それ以外の要素は `z-index` をいくら上げてもその下に隠れます。そのため全画面中は、全画面になっている要素の中にコメントを差し込む必要があります。

Google スライドのスライドショーは iframe の中で描画されるため、全画面にすると iframe そのものが全画面要素になります。iframe に要素を追加しても中身は描画されないので、iframe の中のフレーム側に差し込む必要があり、そのために全フレームへコメントを注入して、どのフレームで流すかを `injectComment` 側で判定しています。

この構造は Google 側の実装に依存するため、スライドの仕様変更で再び流れなくなる可能性があります。その場合は全画面にしないスライドショー（ウィンドウ表示）であれば確実に流れます。

### Slack は別ウィンドウで開くのがおすすめ

**Slack タブと、コメントを流したいタブは別ウィンドウに分けてください。**

コメントは Slack タブの DOM を監視して取得しているため、Slack タブが「表示されている」状態である必要があります。

- **別ウィンドウ**：Slack タブはそのウィンドウの選択中タブのままなので、ウィンドウが背面にあっても表示状態が保たれ、問題なく流れます
- **同じウィンドウの別タブ**：Slack タブが非表示になり、コメントを取得できません

Slack のウィンドウは背面に置いたままで構いません。前面にした別ウィンドウのタブにコメントが流れます。

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

### バックグラウンドタブでのタイマー throttle に注意

**`src/contentScripts/` の中では `setTimeout` / `setInterval` を使わないでください。**

別タブに映した資料の上にコメントを流すのがこのツールの本来の使い方なので、Slack タブは裏に回った状態で動く必要があります。ところが Chrome はバックグラウンドタブのタイマーを throttle します（1 秒に 1 回まで、さらに 5 分ほど非表示が続くと 1 分に 1 回まで）。

そのためデバウンスや送信間隔をタイマーで作ると、Slack タブを表示している間は動くのに、他のタブに切り替えた瞬間にコメントが流れなくなります。

`MutationObserver` のコールバックと `chrome.runtime.sendMessage` は throttle されないので、走査と送信はコールバックの中で同期的に行い、複数コメントの間隔調整は service worker 側（`src/background/index.ts`）に寄せています。

### テキストの抽出

`src/contentScripts/utils/extractMessageText.ts` で、リッチテキストからタグを除去してテキストのみを取り出しています。

単純な `textContent` だと送信者名・時刻・スクリーンリーダー用の重複テキストまで混ざってしまうため、下記を行っています。

- `hidden` / `aria-hidden="true"` / `.sr-only` / `data-stringify-ignore` の要素を除外する
- `<br>` と `.c-mrkdwn__br`（段落区切り）は半角スペースにする
- 絵文字は `<img>` なのでテキストが取れない。`alt`（`:raised_hands:` 形式）を使う
- 「（編集済み）」ラベル（`.c-message__edited_label`）は本文ではないので除外する
- 一行に流すため、改行や連続する空白は半角スペース一つにまとめる

イメージとしては、下記のようなメッセージが

```text
サンプルコメントです。          ← 本文 1 行目
改行した 2 行目です:raised_hands: ← 絵文字つき
                                （編集済み）
```

こう抽出されます。

```text
"サンプルコメントです。 改行した 2 行目です:raised_hands:"
```

送信者名・時刻・「（編集済み）」は落ち、改行は半角スペースになり、絵文字は `alt` の文字列になります。

### コメントを流す

`src/background/injectComment.ts` がコメントを流す処理です。ベースにした google-meet-comment-flow をほぼそのまま使っています。

focus している chrome タブに `chrome.scripting.executeScript` で `<span>` を差し込み、Web Animations API で右から左へ動かしています。

#### 全画面表示（プレゼンモード）への対応

Fullscreen API で全画面表示中の要素は **top layer** に上がるため、`document.body` の下に差し込んだコメントは `z-index` をいくら上げても画面に出ません。

そのため全画面表示中は `document.fullscreenElement`（＝全画面になっている要素）の中にコメントを差し込んでいます。Google スライドのプレゼンモードに限らず、Fullscreen API を使っているページであれば同じように流れます。

ベースにした google-meet-comment-flow は Google スライド固有のクラス名（`.punch-full-screen-element`）で全画面要素を探していましたが、DOM が変わると効かなくなるため標準 API に置き換えました。元のセレクタもフォールバックとして残してあります。

## License

MIT License. ベースにした [m-narin/google-meet-comment-flow](https://github.com/m-narin/google-meet-comment-flow) の著作権表示を `LICENSE` に引き継いでいます。
