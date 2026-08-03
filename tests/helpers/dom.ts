import { JSDOM } from "jsdom";

/*
NOTE: 実際の Slack の HTML はワークスペースの中身そのものなので Repository には置けない。
      代わりに、構造だけを真似た最小限の DOM をここで組み立てる。

      属性やクラス名は実物に合わせてあるので、Slack 側の構造が変わったときは
      ここも一緒に直すこと。
*/

export const STANDARD_EMOJI_BASE =
  "https://a.slack-edge.com/production-standard-emoji-assets/16.0/apple-medium";

export const CUSTOM_EMOJI_SRC =
  "https://emoji.slack-edge.com/T0325E9PB/maron/310b88d2996a29d4.png";

export type TestDom = {
  document: Document;
  window: JSDOM["window"];
};

export const createDom = (bodyHTML = ""): TestDom => {
  const dom = new JSDOM(`<!doctype html><body>${bodyHTML}</body>`, {
    url: "https://app.slack.com/client/T123/C456",
  });

  // NOTE: 抽出処理は Node.TEXT_NODE などを参照するのでグローバルに載せる
  (globalThis as unknown as { Node: unknown }).Node = dom.window.Node;

  return { document: dom.window.document, window: dom.window };
};

/*
NOTE: `.p-rich_text_section` だけを持つ最小のメッセージ。
      本文の抽出そのものを確かめたいときに使う。
*/
export const createSection = (innerHTML: string): Element => {
  const { document } = createDom(
    `<div class="p-rich_text_section">${innerHTML}</div>`
  );

  return document.querySelector(".p-rich_text_section") as Element;
};

/*
NOTE: 送信者名・時刻・スクリーンリーダー用の要素まで含んだ、実物に近いメッセージ。
      本文以外が混ざらないことを確かめたいときに使う。
*/
export const createMessageContainer = (
  sectionsHTML: string[],
  options: { ts?: string; channelId?: string } = {}
): Element => {
  const ts = options.ts ?? "1785731069.233559";
  const channelId = options.channelId ?? "C456";

  const sections = sectionsHTML
    .map((html) => `<div class="p-rich_text_section">${html}</div>`)
    .join("");

  const { document } = createDom(`
    <div data-qa="message_pane">
      <div class="c-virtual_list__item" data-qa="virtual-list-item" data-item-key="${ts}">
        <div class="c-message_kit__background"
             data-qa="message_container"
             data-msg-ts="${ts}"
             data-msg-channel-id="${channelId}">
          <span class="c-message__sender">
            <button data-qa="message_sender_name">Narin Mando/那仁満徳</button>
          </span>
          <a class="c-timestamp" data-ts="${ts}">
            <span class="c-timestamp__label" data-qa="timestamp_label">13:24</span>
          </a>
          <span id="sender-a11y" hidden>Narin Mando/那仁満徳 : </span>
          <span class="sr-only">スクリーンリーダー用</span>
          <div class="c-message__message_blocks" data-qa="message-text">
            <div class="p-rich_text_block" dir="auto">${sections}</div>
          </div>
        </div>
      </div>
    </div>
  `);

  return document.querySelector('[data-qa="message_container"]') as Element;
};

// NOTE: Slack が絵文字を描画するときの <img>
export const emojiImg = (src: string, alt: string): string =>
  `<span class="c-emoji c-emoji--inline" data-qa="emoji"><img alt="${alt}" data-stringify-type="emoji" src="${src}"></span><span hidden data-sk="tooltip"></span>`;
