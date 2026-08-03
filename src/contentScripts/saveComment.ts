import { decodeHTMLSpecialWord } from "./utils/decodeHTMLSpecialWord";
import { extractMessageText } from "./utils/extractMessageText";

const SLACK_SELECTOR_OBJ = {
  // メッセージ一覧のペイン（サイドバーの仮想リストと区別するために使う）
  messagePane: '[data-qa="message_pane"]',
  // 個別のメッセージ。data-msg-ts に Slack のタイムスタンプが入っている
  messageContainer: '[data-qa="message_container"][data-msg-ts]',
} as const;

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

const isExtensionAlive = (): boolean => Boolean(chrome.runtime?.id);

const getMessageContainers = (): Element[] => {
  const messagePane = document.querySelector(SLACK_SELECTOR_OBJ.messagePane);
  const root: ParentNode = messagePane || document;

  return Array.from(root.querySelectorAll(SLACK_SELECTOR_OBJ.messageContainer));
};

const getTs = (messageContainer: Element): number =>
  Number(messageContainer.getAttribute("data-msg-ts"));

const resetBaseline = (
  messageContainers: Element[],
  channelId: string
): void => {
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

/*
NOTE: この content script では setTimeout / setInterval を使わないこと。

      別タブに映した資料の上にコメントを流すのが本来の使い方なので、
      Slack タブは裏に回った状態で動く必要がある。ところが Chrome は
      バックグラウンドタブのタイマーを throttle する（1 秒に 1 回まで、
      さらに 5 分ほど非表示が続くと 1 分に 1 回まで）ため、
      デバウンスや送信間隔をタイマーで作るとコメントが流れなくなる。

      MutationObserver のコールバックと chrome.runtime.sendMessage は
      throttle されないので、走査と送信はコールバックの中で同期的に行い、
      複数コメントの間隔調整は service worker 側（background/index.ts）に任せる。
*/
const sendNewComments = async (): Promise<void> => {
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

    messages.forEach((message) => {
      chrome.runtime.sendMessage({
        method: "setComment",
        value: decodeHTMLSpecialWord(message),
      });
    });
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

const hasAddedElementNode = (mutations: MutationRecord[]): boolean =>
  mutations.some((mutation) =>
    Array.from(mutation.addedNodes).some(
      (node) => node.nodeType === Node.ELEMENT_NODE
    )
  );

const observer = new MutationObserver((mutations: MutationRecord[]) => {
  // 拡張機能のコンテキストが有効かチェック
  if (!isExtensionAlive()) {
    observer.disconnect();
    return;
  }

  // NOTE: Slack は入力中表示などでも DOM が変わるので、要素の追加時だけ走査する
  if (!hasAddedElementNode(mutations)) return;

  void sendNewComments();
});

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
