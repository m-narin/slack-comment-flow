# Slack Comment Flow

Web 版 Slack のチャンネルに投稿されたコメントを、ニコニコ動画風に Chrome タブ上へ流す Chrome 拡張機能です。

画面共有をしながら発表している最中に、Slack の実況コメントを発表画面の上に流すことを想定しています。

ストアには公開していないので、local に読み込んで使います。

## local で試す方法

この Project を clone します。root で

```sh
npm install
npm run build
```

これにより、`/dist`が作成されます。（Vite による chrome 拡張機能の build）

`chrome://extensions/` = 拡張機能管理ページを開き、右上の「デベロッパー モード」ボタンを ON

「パッケージ化されていない拡張機能を読みこむ」にて`/dist`フォルダーを選択。
これにより拡張機能が有効化されます。

修正を反映させる場合は、`npm run build` → 拡張機能管理ページから再読み込み → 画面リロードです。

## 動作方法

まず Web 版 Slack（`https://app.slack.com/`）を開き、実況コメントを流したいチャンネルを表示しておきます。

**このタブは開いたままにしておいてください。** ここに表示されているメッセージ一覧からコメントを取得するので、閉じたり別のチャンネルに切り替えたりすると取得できなくなります。

右上の拡張機能設定から有効化し、色と大きさを選択できます。

| 項目 | 説明 |
| --- | --- |
| Color | 流れるコメントの文字色（デフォルト: blue） |
| Font Size | 流れるコメントの文字サイズ（XS / S / M / L / XL） |
| Enable Streaming | ON にするとコメントが流れ始めます |

この状態で Slack のチャンネルにコメントが投稿されると、focus している chrome タブ上に流れるようになります。Google スライドのスライドショーは、全画面表示でもウィンドウ表示でも流れます。

対象は**新規投稿のみ**です。有効化した時点ですでに表示されている過去のメッセージや、既存メッセージの編集は流れません。

### Slack は別ウィンドウで開く

**Slack タブと、コメントを流したいタブは別ウィンドウに分けてください。** コメントは Slack タブの DOM を監視して取得しているため、Slack タブが表示されている状態である必要があります。

- **別ウィンドウ**：Slack タブはそのウィンドウの選択中タブのままなので、ウィンドウが背面にあっても表示状態が保たれ、問題なく流れます
- **同じウィンドウの別タブ**：Slack タブが非表示になり、コメントを取得できません

Slack のウィンドウは背面に置いたままで構いません。前面にした別ウィンドウのタブにコメントが流れます。

## テスト

```sh
npm test
```

Node 標準の `node:test` と jsdom で動かしています。拡張機能を Chrome に読み込まなくても、コメントの抽出と差し込みを確認できます。

| ファイル | 内容 |
| --- | --- |
| `tests/extractMessageText.test.ts` | 本文の抽出。タグ・送信者名・時刻の除去、改行や空白の扱い、絵文字の復元 |
| `tests/injectComment.test.ts` | コメントの差し込み。差し込み先の選択、絵文字の組み立て、画像失敗時の代替 |
| `tests/decodeHTMLSpecialWord.test.ts` | HTML エンティティのデコード |
| `tests/constraints.test.ts` | 「開発時の注意」に書いた制約が守られているかの静的チェック |

実際の Slack の HTML はワークスペースの中身そのものなので Repository には置けません。代わりに `tests/helpers/dom.ts` で構造だけを真似た DOM を組み立てています。**Slack 側の構造が変わったときはここも一緒に直してください。**

`src/contentScripts/saveComment.ts` のロジック（baseline の管理、チャンネル切り替え、新規投稿だけを流す判定）はテストしていません。モジュールを読み込んだ時点で `MutationObserver` の登録などの副作用が走るため、テストするには純粋な関数として切り出すリファクタが必要です。

## 実装メモ

### コメントの取得

`src/contentScripts/saveComment.ts` で Slack のメッセージ一覧を `MutationObserver` で監視しています。

- メッセージ 1 件は `[data-qa="message_container"]` で、`data-msg-ts` に Slack のタイムスタンプ、`data-msg-channel-id` にチャンネル ID が入っています
- 本文は `.p-rich_text_section` の中にリッチテキストとして描画されます
- Slack のメッセージ一覧は仮想リストなので、スクロールしただけでも過去のメッセージが DOM に追加されます。そのため「監視を始めた時点の最新メッセージ」を baseline とし、それより新しい `ts` のメッセージだけを流します（チャンネルを切り替えたときは baseline を引き直します）
- 短時間に複数のコメントが届いた場合は、service worker 側のキューに積んで一定間隔で流します

### テキストの抽出

`src/contentScripts/utils/extractMessageText.ts` で、リッチテキストからタグを除去してテキストのみを取り出しています。

単純な `textContent` だと送信者名・時刻・スクリーンリーダー用の重複テキストまで混ざるため、下記を行っています。

- `hidden` / `aria-hidden="true"` / `.sr-only` / `data-stringify-ignore` の要素を除外する
- `<br>` と `.c-mrkdwn__br`（段落区切り）は半角スペースにする
- 「（編集済み）」ラベル（`.c-message__edited_label`）は本文ではないので除外する
- 一行に流すため、改行や連続する空白は半角スペース一つにまとめる

### 絵文字の扱い

Slack の絵文字は標準絵文字もカスタム絵文字も `<img>` で描画されます。**どちらも Slack が表示しているのと同じ画像でそのまま流します。** Slack 上の見た目と一致し、OS の絵文字フォントにも依存しません。

そのためコメントは文字列ではなく、テキストと画像のトークン列（`src/types/comment.ts` の `CommentToken`）として扱っています。

```ts
[
  { type: "text", value: "標準絵文字" },
  { type: "image", src: ".../apple-medium/1f64c@2x.png", alt: "🙌" },
  { type: "text", value: "とカスタム絵文字" },
  { type: "image", src: "https://emoji.slack-edge.com/.../maron.png", alt: ":maron:" }
]
```

流す側では `<span>` の中にテキストノードと `<img>` を並べて組み立てます。`<img>` の高さは `1em` にしてあるので Font Size に追従します。画像の読み込みが終わるまで `offsetWidth` が確定せず流す距離がずれるため、読み込みを待ってからアニメーションを開始し、1 秒でタイムアウトします。

#### 画像を読み込めなかったときの代替テキスト

流し先ページの CSP（`img-src`）で画像が弾かれることがあるため、`alt` に代替テキストを持たせ、読み込みに失敗したらそれに差し替えます。

標準絵文字の代替テキストには Unicode の絵文字そのものを入れます。画像 URL のファイル名が Unicode のコードポイントになっていることを利用して復元しています。

```text
.../production-standard-emoji-assets/16.0/apple-medium/1f64c@2x.png
                                                       ^^^^^ -> String.fromCodePoint(0x1f64c) -> 🙌
```

ファイル名には下記のバリエーションがあるので、いずれも落としてコードポイントだけを取り出します。

- Retina ディスプレイでは `@2x` / `@3x` の解像度サフィックスが付く（`1f64c@2x.png`）
- ZWJ シーケンスや国旗はハイフン区切りで複数のコードポイントが入る（`1f469-200d-1f4bb.png` → 👩‍💻）
- クエリ文字列が付くことがある（`1f514.png?v=2`）

`:バンザイ:` のようにエイリアス名が付いていても、実体が標準絵文字であれば URL から復元できます。名前ではなく URL を見るのがポイントです。

一方 Slack のカスタム絵文字は Unicode に対応する文字がないため復元できません。この場合は Slack の `alt`（`:maron:` 形式）をそのまま代替テキストにします。

つまり画像が読めない環境でも、標準絵文字は 🙌 のまま、カスタム絵文字は `:maron:` として表示されます。

### コメントを流す

`src/background/injectComment.ts` が、focus している chrome タブに `chrome.scripting.executeScript` で `<span>` を差し込み、Web Animations API で右から左へ動かしています。

Fullscreen API で全画面表示中の要素は **top layer** という特別な層に上がり、それ以外の要素は `z-index` をいくら上げてもその下に隠れます。そのため全画面表示中は `document.fullscreenElement`（＝全画面になっている要素）を差し込み先にしています。Google スライドのプレゼンモードに限らず、Fullscreen API を使っているページであれば同じように流れます。

ただし全画面になっているのが `<iframe>` や `<video>` の場合は、子要素を追加しても描画されないので流せません。この場合は `document.body` にフォールバックします。

## 開発時の注意

いずれも「書けてしまうが、特定の状況でだけ壊れる」ものです。`tests/constraints.test.ts` と `tests/injectComment.test.ts` で検出できるようにしてあります。

### content script でタイマーを使わない

**`src/contentScripts/` の中では `setTimeout` / `setInterval` を使わないでください。**

別タブに映した資料の上にコメントを流すのが本来の使い方なので、Slack タブは裏に回った状態で動く必要があります。ところが Chrome はバックグラウンドタブのタイマーを throttle します（1 秒に 1 回まで、さらに 5 分ほど非表示が続くと 1 分に 1 回まで）。そのためデバウンスや送信間隔をタイマーで作ると、他のタブに切り替えた瞬間にコメントが流れなくなります。

`MutationObserver` のコールバックと `chrome.runtime.sendMessage` は throttle されないので、走査と送信はコールバックの中で同期的に行い、複数コメントの間隔調整は service worker 側（`src/background/index.ts`）に寄せています。

### injectComment の中で外部スコープを参照しない

**`injectComment` は関数が文字列化されて対象ページに注入されるため、外部スコープの変数・定数・関数を一切参照できません。** 参照すると注入先で `ReferenceError` になります。

定数もヘルパーもすべて関数の中に置いてください。型は実行時に消えるので `import type` は問題ありません。
