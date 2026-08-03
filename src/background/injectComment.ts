import type { CommentToken } from "../types/comment";

/*
NOTE: この関数は chrome.scripting.executeScript で「文字列化して」対象ページに注入される。
      そのため外部スコープの変数・定数・関数を一切参照できない（ReferenceError になる）。
      定数もヘルパーもすべて関数の中に置くこと。型は実行時に消えるので import してよい。

SEE: https://developer.chrome.com/docs/extensions/reference/api/scripting#injected-code
*/

/*
NOTE: Fullscreen API で全画面表示中の要素は top layer に上がるため、
      document.body の下に入れたコメントは z-index をいくら上げても画面に出ない。
      全画面表示中は、全画面になっている要素の中に入れる必要がある。

      ただし全画面になっているのが iframe の場合、中身は子フレームなので
      iframe に appendChild しても描画されない。この場合コメントは流せない。

      Google スライドのスライドショーは iframe の中で描画されるため、
      全画面にするとこのケースに当たり、コメントは流れない。
      全画面にしないスライドショーであれば iframe の上に乗るので流れる。
      詳細は README の「Google スライドのスライドショーで使う場合」を参照。

SEE: https://developer.mozilla.org/en-US/docs/Web/API/Document/fullscreenElement
     https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Positioning/Understanding_z_index/The_stacking_context
*/
export const injectComment = async (tokens: CommentToken[]) => {
  const getTargetNode = (): Element => {
    // NOTE: 中身が子フレーム / 別レイヤーにあり、appendChild しても描画されない要素
    const unappendableTagNames = ["IFRAME", "FRAME", "VIDEO", "CANVAS"];

    const fullscreenElement = document.fullscreenElement;

    if (
      fullscreenElement &&
      !unappendableTagNames.includes(fullscreenElement.tagName)
    ) {
      return fullscreenElement;
    }

    // NOTE: 旧 google slide full screen mode element へのフォールバック
    const gSlideContentNode = document.querySelector(
      "body > div.punch-full-screen-element.punch-full-window-overlay"
    );

    return gSlideContentNode || document.body;
  };

  const targetNode = getTargetNode();

  const screenHeight = window.innerHeight;
  const screenWidth = window.innerWidth;

  const comment = document.createElement("span");

  /*
  NOTE: カスタム絵文字は画像なので、テキストと <img> を並べて組み立てる。
        高さを 1em にすることで文字サイズの変更に追従させる。
  */
  tokens.forEach((token) => {
    if (token.type === "text") {
      comment.appendChild(document.createTextNode(token.value));
      return;
    }

    const image = document.createElement("img");

    image.src = token.src;
    image.alt = token.alt;
    image.style.height = "1em";
    image.style.verticalAlign = "-0.15em";

    comment.appendChild(image);
  });

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

  // NOTE: popup 側の初期値（Colors.Blue）と揃えること
  comment.style["color"] = storedColorMessage || "blue";

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

  const messageLength = tokens.reduce(
    (length, token) =>
      length + (token.type === "text" ? token.value.length : token.alt.length),
    0
  );

  const duration = getDuration(messageLength);

  /*
  NOTE: 画像の読み込みが終わらないと offsetWidth が確定せず、流す距離がずれる。
        読み込みに失敗した場合（流し先ページの CSP で画像が弾かれた場合など）は
        alt（`:name:` 形式）のテキストに差し替えて、最低限読める状態にする。
  */
  const waitForImages = async (): Promise<void> => {
    const images = Array.from(comment.querySelectorAll("img"));
    if (images.length === 0) return;

    const fallbackToAlt = (image: HTMLImageElement) =>
      image.replaceWith(document.createTextNode(image.alt));

    await Promise.all(
      images.map(
        (image) =>
          new Promise<void>((resolve) => {
            if (image.complete) {
              // NOTE: complete でも naturalWidth が 0 なら読み込みに失敗している
              if (image.naturalWidth === 0) fallbackToAlt(image);
              resolve();
              return;
            }

            image.addEventListener("load", () => resolve(), { once: true });
            image.addEventListener(
              "error",
              () => {
                fallbackToAlt(image);
                resolve();
              },
              { once: true }
            );

            // NOTE: 応答がないまま流れなくなるのを防ぐ保険
            setTimeout(() => {
              fallbackToAlt(image);
              resolve();
            }, 1000);
          })
      )
    );
  };

  await waitForImages();

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
