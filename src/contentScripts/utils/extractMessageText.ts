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

const collectText = (node: Node, collected: string[]): void => {
  if (node.nodeType === Node.TEXT_NODE) {
    collected.push(node.nodeValue || "");
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const element = node as Element;

  // NOTE: <br aria-hidden="true"> のように改行要素が aria-hidden を持つので先に処理する
  if (element.tagName === "BR" || element.classList.contains("c-mrkdwn__br")) {
    collected.push(" ");
    return;
  }

  if (isIgnoredElement(element)) return;

  // NOTE: カスタム絵文字を含む絵文字は alt に `:raised_hands:` 形式で入っている
  if (element.tagName === "IMG") {
    collected.push(element.getAttribute("alt") || "");
    return;
  }

  element.childNodes.forEach((childNode) => collectText(childNode, collected));
};

const normalize = (text: string): string => {
  // NOTE: 一行に流すので、改行や連続する空白は半角スペース一つにまとめる
  return text.replace(/\s+/g, " ").trim();
};

export const extractPlainText = (element: Element): string => {
  const collected: string[] = [];
  collectText(element, collected);

  return normalize(collected.join(""));
};

/*
NOTE: 一つのメッセージが複数の `.p-rich_text_section` に分かれることがある
      （箇条書きや引用を挟んだ場合など）ので、それらを連結して一つのコメントにする
*/
export const extractMessageText = (messageContainer: Element): string => {
  const sections = messageContainer.querySelectorAll(".p-rich_text_section");
  if (sections.length === 0) return "";

  const texts: string[] = [];

  sections.forEach((section) => {
    const text = extractPlainText(section);
    if (text) texts.push(text);
  });

  return texts.join(" ");
};
