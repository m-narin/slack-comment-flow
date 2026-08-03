import { decodeHTMLSpecialWord } from "./utils/decodeHTMLSpecialWord";
import { extractMessageText } from "./utils/extractMessageText";

const SLACK_SELECTOR_OBJ = {
  // メッセージ一覧のペイン（サイドバーの仮想リストと区別するために使う）
  messagePane: '[data-qa="message_pane"]',
  // 個別のメッセージ。data-msg-ts に Slack のタイムスタンプが入っている
  messageContainer: '[data-qa="message_container"][data-msg-ts]',
} as const;

const SCAN_DEBOUNCE_MS = 100;
// NOTE: 複数のコメントが同時に届いた場合、一つずつ間隔を空けて流す
const QUEUE_INTERVAL_MS = 700;

/*
NOTE: Slack のメッセージ一覧は仮想リストなので、スクロールするだけで
      過去のメッセージが DOM に足され MutationObserver が発火する。
      「拡張機能を動かし始めた時点で表示されていた最新メッセージ」を baseline とし、
      それより新しい ts のメッセージだけを流す。
      チャンネルを切り替えたときは baseline を引き直す。

      対象は新規投稿のみ。既存メッセージの編集は ts が変わらないため、
      baseline と streamedMessageTsSet の両方で弾かれ、流れない。
*/
let currentChannelId: string | null = null;
let baselineTs = 0;
const streamedMessageTsSet = new Set<string>();

const queue: string[] = [];
let queueTimerId: number | undefined;
let scanTimerId: number | undefined;

const isExtensionAlive = (): boolean => Boolean(chrome.runtime?.id);

const getMessageContainers = (): Element[] => {
  const messagePane = document.querySelector(SLACK_SELECTOR_OBJ.messagePane);
  const root: ParentNode = messagePane || document;

  return Array.from(root.querySelectorAll(SLACK_SELECTOR_OBJ.messageContainer));
};

const getTs = (messageContainer: Element): number =>
  Number(messageContainer.getAttribute("data-msg-ts"));

const resetBaseline = (messageContainers: Element[], channelId: string): void => {
  currentChannelId = channelId;
  baselineTs = messageContainers.reduce(
    (latestTs, messageContainer) => Math.max(latestTs, getTs(messageContainer)),
    0
  );
  streamedMessageTsSet.clear();
};

const extractNewMessages = (): string[] => {
  const messageContainers = getMessageContainers();
  if (messageContainers.length === 0) return [];

  const channelId =
    messageContainers[messageContainers.length - 1].getAttribute(
      "data-msg-channel-id"
    ) || "";

  // NOTE: 初回描画時とチャンネル切り替え時は、そのとき表示されている分を既読扱いにする
  if (channelId !== currentChannelId) {
    resetBaseline(messageContainers, channelId);
    return [];
  }

  const messages: string[] = [];

  messageContainers.forEach((messageContainer) => {
    const ts = messageContainer.getAttribute("data-msg-ts");
    if (!ts) return;

    if (Number(ts) <= baselineTs) return;
    if (streamedMessageTsSet.has(ts)) return;

    streamedMessageTsSet.add(ts);

    const message = extractMessageText(messageContainer);
    if (!message) return;

    messages.push(message);
  });

  return messages;
};

const stopQueue = (): void => {
  if (queueTimerId === undefined) return;

  window.clearInterval(queueTimerId);
  queueTimerId = undefined;
};

const sendNextComment = (): void => {
  if (!isExtensionAlive()) {
    queue.length = 0;
    stopQueue();
    return;
  }

  const message = queue.shift();

  if (message === undefined) {
    stopQueue();
    return;
  }

  chrome.runtime.sendMessage({
    method: "setComment",
    value: decodeHTMLSpecialWord(message),
  });
};

const startQueue = (): void => {
  if (queueTimerId !== undefined) return;

  sendNextComment();
  queueTimerId = window.setInterval(sendNextComment, QUEUE_INTERVAL_MS);
};

const observer = new MutationObserver(() => {
  // 拡張機能のコンテキストが有効かチェック
  if (!isExtensionAlive()) {
    observer.disconnect();
    return;
  }

  // NOTE: Slack は入力中表示などでも大量に DOM が変わるのでまとめてから走査する
  if (scanTimerId !== undefined) return;

  scanTimerId = window.setTimeout(() => {
    scanTimerId = undefined;
    void scanAndEnqueue();
  }, SCAN_DEBOUNCE_MS);
});

const scanAndEnqueue = async (): Promise<void> => {
  try {
    /*
    NOTE: 有効・無効に関わらず走査して既読にしておく。
          こうしないと無効中に届いたコメントが、有効化した瞬間にまとめて流れてしまう。
    */
    const messages = extractNewMessages();
    if (messages.length === 0) return;

    if (!isExtensionAlive()) {
      observer.disconnect();
      return;
    }

    const isEnabledStreaming = await chrome.runtime.sendMessage({
      method: "getIsEnabledStreaming",
    });

    if (!isEnabledStreaming) return;

    queue.push(...messages);
    startQueue();
  } catch (e) {
    // Extension context invalidated エラーの場合はオブザーバーを停止
    if (
      e instanceof Error &&
      e.message.includes("Extension context invalidated")
    ) {
      observer.disconnect();
      return;
    }
    console.error("[saveComment] Error:", e);
  }
};

const startObserving = () =>
  observer.observe(document.body, {
    subtree: true,
    childList: true,
  });

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startObserving);
} else {
  startObserving();
}
