import type { CommentToken } from "../../types/comment";

/*
NOTE: Slack のメッセージ本文は `.p-rich_text_section` の中にリッチテキストとして描画される。
      絵文字は <img>、改行は <br> や `.c-mrkdwn__br` といった要素で表現されているため、
      単純な textContent では欠落したりスクリーンリーダー用の文言が混ざったりする。
      ここではタグを取り除きつつ、流すのに必要なテキストだけを取り出す。
*/

const IGNORED_TAG_NAMES = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG"]);

// NOTE: 本文ではなく Slack が付けるラベル（「（編集済み）」など）
const IGNORED_CLASS_NAMES = ["c-message__edited_label"];

const isIgnoredElement = (element: Element): boolean => {
  if (IGNORED_TAG_NAMES.has(element.tagName)) return true;
  if (IGNORED_CLASS_NAMES.some((name) => element.classList.contains(name)))
    return true;
  // NOTE: hidden / aria-hidden / sr-only はスクリーンリーダー用の重複テキストなど
  if (element.hasAttribute("hidden")) return true;
  if (element.getAttribute("aria-hidden") === "true") return true;
  if (element.getAttribute("data-stringify-ignore") === "true") return true;
  if (element.classList.contains("sr-only")) return true;

  return false;
};

// NOTE: 標準絵文字の画像はこのパスから配信される（カスタム絵文字は emoji.slack-edge.com）
const STANDARD_EMOJI_ASSET_PATH = "production-standard-emoji-assets";

/*
NOTE: 標準絵文字の画像 URL は、ファイル名が Unicode のコードポイントになっている。
      そこから実際の絵文字の文字を復元する。

      例: .../production-standard-emoji-assets/16.0/apple-medium/1f64c.png
          -> "1f64c" -> 🙌

      ZWJ シーケンスや国旗はハイフン区切りで複数のコードポイントが入る。
      例: 1f469-200d-1f4bb.png -> 👩‍💻

      Slack のカスタム絵文字は Unicode に対応する文字がないので復元できない。
      その場合は null を返し、呼び出し側で alt（`:name:` 形式）にフォールバックする。
*/
const toUnicodeEmoji = (src: string): string | null => {
  if (!src.includes(STANDARD_EMOJI_ASSET_PATH)) return null;

  /*
  NOTE: クエリ文字列・拡張子・解像度サフィックスを落としてコードポイントだけにする。
        Retina ディスプレイでは `1f64c@2x.png` のように `@2x` が付く。
  */
  const fileName = src.split("/").pop()?.split("?")[0] || "";
  const codePointsText = fileName
    .replace(/\.[a-z0-9]+$/i, "")
    .split("@")[0];

  // NOTE: 16 進数をハイフンで繋いだ形式でなければ絵文字として扱わない
  if (!/^[0-9a-f]{1,6}(-[0-9a-f]{1,6})*$/i.test(codePointsText)) return null;

  const codePoints = codePointsText
    .split("-")
    .map((codePoint) => parseInt(codePoint, 16));

  try {
    return String.fromCodePoint(...codePoints);
  } catch {
    // NOTE: Unicode の範囲外だった場合
    return null;
  }
};

const collectTokens = (node: Node, tokens: CommentToken[]): void => {
  if (node.nodeType === Node.TEXT_NODE) {
    tokens.push({ type: "text", value: node.nodeValue || "" });
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const element = node as Element;

  // NOTE: <br aria-hidden="true"> のように改行要素が aria-hidden を持つので先に処理する
  if (element.tagName === "BR" || element.classList.contains("c-mrkdwn__br")) {
    tokens.push({ type: "text", value: " " });
    return;
  }

  if (isIgnoredElement(element)) return;

  // NOTE: 絵文字は <img> なのでテキストが取れない
  if (element.tagName === "IMG") {
    const image = element as HTMLImageElement;

    /*
    NOTE: src 属性が無く srcset だけ設定されていることがあるので currentSrc も見る。
          image.src は属性値ではなく解決済みの絶対 URL を返す。
    */
    const src = image.currentSrc || image.src || "";

    /*
    NOTE: 標準絵文字もカスタム絵文字も、Slack が表示しているのと同じ画像で流す。
          こうすると Slack 上の見た目と一致し、OS の絵文字フォントにも依存しない。

          画像を読み込めなかったとき（流し先ページの CSP で弾かれた場合など）に
          備えて、代替テキストを alt に持たせておく。
          標準絵文字は画像 URL から Unicode の絵文字に復元できるのでそれを使い、
          復元できないカスタム絵文字は Slack の alt（`:name:` 形式）を使う。
    */
    const alt = toUnicodeEmoji(src) || element.getAttribute("alt") || "";

    if (src) {
      tokens.push({ type: "image", src, alt });
      return;
    }

    // NOTE: src が無い場合は画像にできないのでテキストとして流す
    tokens.push({ type: "text", value: alt });
    return;
  }

  element.childNodes.forEach((childNode) => collectTokens(childNode, tokens));
};

/*
NOTE: 一行に流すので、改行や連続する空白は半角スペース一つにまとめ、
      前後の空白を落とす。テキストは画像を挟んで分断されているため、
      隣り合うテキストを連結してから処理する。
*/
const normalizeTokens = (tokens: CommentToken[]): CommentToken[] => {
  const merged: CommentToken[] = [];

  tokens.forEach((token) => {
    const previous = merged[merged.length - 1];

    if (token.type === "text" && previous?.type === "text") {
      previous.value += token.value;
      return;
    }

    merged.push({ ...token });
  });

  merged.forEach((token, index) => {
    if (token.type !== "text") return;

    let value = token.value.replace(/\s+/g, " ");

    if (index === 0) value = value.replace(/^ /, "");
    if (index === merged.length - 1) value = value.replace(/ $/, "");

    token.value = value;
  });

  return merged.filter((token) => token.type !== "text" || token.value !== "");
};

export const extractPlainTokens = (element: Element): CommentToken[] => {
  const tokens: CommentToken[] = [];
  collectTokens(element, tokens);

  return normalizeTokens(tokens);
};

/*
NOTE: 一つのメッセージが複数の `.p-rich_text_section` に分かれることがある
      （箇条書きや引用を挟んだ場合など）ので、それらを連結して一つのコメントにする
*/
export const extractMessageTokens = (
  messageContainer: Element
): CommentToken[] => {
  const sections = messageContainer.querySelectorAll(".p-rich_text_section");
  if (sections.length === 0) return [];

  const tokens: CommentToken[] = [];

  sections.forEach((section) => {
    const sectionTokens = extractPlainTokens(section);
    if (sectionTokens.length === 0) return;

    // NOTE: セクションの区切りは半角スペースで繋ぐ
    if (tokens.length > 0) tokens.push({ type: "text", value: " " });

    tokens.push(...sectionTokens);
  });

  return normalizeTokens(tokens);
};

// NOTE: テストとデバッグ用。画像は alt で代用した文字列にする
export const extractMessageText = (messageContainer: Element): string =>
  extractMessageTokens(messageContainer)
    .map((token) => (token.type === "text" ? token.value : token.alt))
    .join("");
