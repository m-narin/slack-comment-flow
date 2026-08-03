/*
NOTE: 流すコメント 1 件を表すトークン列。

      カスタム絵文字は Unicode に対応する文字がないため画像として流す必要があり、
      コメントを「文字列」ではなく「テキストと画像の並び」として扱っている。

      chrome.storage / chrome.runtime.sendMessage を通るので、
      JSON でシリアライズできる形にしておくこと。
*/
export type CommentToken =
  | { type: "text"; value: string }
  | { type: "image"; src: string; alt: string };
