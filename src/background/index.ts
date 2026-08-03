import { injectComment } from "./injectComment";

const StorageKeys = {
  Comment: "comment",
  Color: "color",
  FontSize: "fontSize",
  IsEnabledStreaming: "isEnabledStreaming",
} as const;

/*
NOTE: 同時に複数のコメントが届いた場合、一つずつ間隔を空けて流す。

      間隔調整を content script 側でやると、Slack タブを裏に回したときに
      Chrome のタイマー throttle を受けてコメントが流れなくなるため、
      service worker 側で行っている（詳細は contentScripts/saveComment.ts のコメント）。

      1 件目は待たずにそのまま流すので、通常の 1 件ずつ届くケースでは
      service worker の寿命に左右されない。
*/
const COMMENT_INTERVAL_MS = 700;

const commentQueue: string[] = [];
let isDrainingCommentQueue = false;

const drainCommentQueue = (): void => {
  const comment = commentQueue.shift();

  if (comment === undefined) {
    isDrainingCommentQueue = false;
    return;
  }

  chrome.storage.local.set({ comment });

  setTimeout(drainCommentQueue, COMMENT_INTERVAL_MS);
};

const enqueueComment = (comment: string): void => {
  commentQueue.push(comment);

  if (isDrainingCommentQueue) return;

  isDrainingCommentQueue = true;
  drainCommentQueue();
};

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  switch (request.method) {
    case "setComment":
      enqueueComment(request.value);
      return true;
    case "deleteComment":
      chrome.storage.local.remove([StorageKeys.Comment]);
      return true;
    case "injectCommentToFocusedTab":
      chrome.storage.local.get([StorageKeys.Comment]).then((res) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (!tabs[0]?.id || !res[StorageKeys.Comment]) return;

          chrome.scripting.executeScript({
            /*
            NOTE: Google スライドのスライドショーのように、全画面になる要素が
                  iframe の中にあるケースがある。親フレームからは中身を触れないので
                  全フレームに注入し、どのフレームで流すかは injectComment 側で判定する。
            */
            target: { tabId: tabs[0].id, allFrames: true },
            func: injectComment,
            args: [res[StorageKeys.Comment]],
          });
        });
      });
      return true;
    case "setColor":
      chrome.storage.local.set({
        color: request.value,
      });
      return true;
    case "getColor":
      chrome.storage.local.get([StorageKeys.Color]).then((res) => {
        sendResponse(res[StorageKeys.Color]);
      });
      return true;
    case "setFontSize":
      chrome.storage.local.set({
        fontSize: request.value,
      });
      return true;
    case "getFontSize":
      chrome.storage.local.get([StorageKeys.FontSize]).then((res) => {
        sendResponse(res[StorageKeys.FontSize]);
      });
      return true;
    case "setIsEnabledStreaming":
      chrome.storage.local.set({
        isEnabledStreaming: request.value,
      });
      return true;
    case "getIsEnabledStreaming":
      chrome.storage.local.get([StorageKeys.IsEnabledStreaming]).then((res) => {
        if (typeof res[StorageKeys.IsEnabledStreaming] !== "boolean") return;
        sendResponse(res[StorageKeys.IsEnabledStreaming]);
      });
      return true;
    default:
      console.log("no method");
      return true;
  }
});
