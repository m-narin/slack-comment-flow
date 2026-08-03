// NOTE: 中身が子フレーム / 別レイヤーにあり、appendChild しても描画されない要素
const UNAPPENDABLE_TAG_NAMES = ["IFRAME", "FRAME", "VIDEO", "CANVAS"];

/*
NOTE: この関数は allFrames: true で全フレームに注入されるので、
      まずこのフレームで流すべきかを判定し、不要なフレームでは何もしない。

SEE: https://developer.mozilla.org/en-US/docs/Web/API/Document/fullscreenElement
     https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Positioning/Understanding_z_index/The_stacking_context
*/
export const injectComment = async (message: string) => {
  const getTargetNode = (): Element | null => {
    const fullscreenElement = document.fullscreenElement;

    if (fullscreenElement) {
      /*
      NOTE: Fullscreen API で全画面表示中の要素は top layer に上がるため、
            document.body の下に入れたコメントは z-index をいくら上げても画面に出ない。
            全画面要素の中に入れる必要がある。

            ただし全画面になっているのが iframe の場合、中身は子フレームなので
            iframe に appendChild しても描画されない。このとき子フレーム側の
            document.fullscreenElement は本物の全画面要素を指すので、そちらに任せる。

            Google スライドのスライドショーは iframe の中で描画されるため、
            全画面にするとこのケースに入る。
      */
      if (UNAPPENDABLE_TAG_NAMES.includes(fullscreenElement.tagName)) {
        return null;
      }

      return fullscreenElement;
    }

    // NOTE: 全画面でないときは、二重に流れないようトップフレームにだけ入れる
    if (window !== window.top) return null;

    // NOTE: 旧 google slide full screen mode element へのフォールバック
    const gSlideContentNode = document.querySelector(
      "body > div.punch-full-screen-element.punch-full-window-overlay"
    );

    return gSlideContentNode || document.body;
  };

  const targetNode = getTargetNode();
  if (!targetNode) return;

  const screenHeight = window.innerHeight;
  const screenWidth = window.innerWidth;

  const comment = document.createElement("span");

  comment.textContent = message;

  targetNode.appendChild(comment);

  const storedFontSizeMessage = await chrome.runtime.sendMessage({
    method: "getFontSize",
  });

  const letterSizeCoefficient = () => {
    switch (storedFontSizeMessage) {
      case "XS":
        return 0.25;
      case "S":
        return 0.5;
      case "M":
        return 1;
      case "L":
        return 2;
      case "XL":
        return 4;
      default:
        return 2;
    }
  };

  const letterSize = screenHeight * 0.05 * letterSizeCoefficient();
  comment.setAttribute("class", "slack-comment-flow");

  const footerHeight = 88;
  /*
  NOTE: 全画面要素の中に入れる場合、position: absolute の基準は
        （全画面要素には UA スタイルで position: fixed が付くため）その要素になる。
        ページのスクロール量を足すと下にずれるので、body に入れるときだけ足す。
  */
  const scrollTopHeight = targetNode === document.body ? window.pageYOffset : 0;
  const topPosition =
    scrollTopHeight +
    Math.floor((screenHeight - letterSize - footerHeight) * Math.random());

  const commentStyle = {
    left: `${screenWidth}px`,
    top: `${topPosition}px`,
    fontSize: `${letterSize}px`,
  };

  const storedColorMessage = await chrome.runtime.sendMessage({
    method: "getColor",
  });

  comment.style["left"] = commentStyle["left"];
  comment.style["top"] = commentStyle["top"];
  comment.style["fontSize"] = commentStyle["fontSize"];

  comment.style["color"] = storedColorMessage || "green";

  comment.style["position"] = "absolute";
  comment.style["zIndex"] = "2147483647";
  comment.style["whiteSpace"] = "nowrap";
  comment.style["lineHeight"] = "initial";

  const getDuration = (messageLength: number): number => {
    if (messageLength < 50) {
      return 5000;
    } else if (messageLength < 100) {
      return 10000;
    } else {
      return 15000;
    }
  };

  const duration = getDuration(message.length);

  const streamCommentUI = comment.animate(
    {
      left: `${-comment.offsetWidth}px`,
    },
    {
      duration: duration,
      easing: "linear",
    }
  );

  // NOTE: delete data in localStorage so that same comments can be sent in a row
  streamCommentUI.ready.then(() =>
    chrome.runtime.sendMessage({ method: "deleteComment" })
  );

  streamCommentUI.onfinish = () => {
    // NOTE: 流れている途中でプレゼンモードに入ると親が変わりうるので remove() を使う
    comment.remove();
  };
};
