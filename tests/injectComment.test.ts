import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { beforeEach, describe, it } from "node:test";
import { injectComment } from "../src/background/injectComment";
import type { CommentToken } from "../src/types/comment";
import { CUSTOM_EMOJI_SRC, STANDARD_EMOJI_BASE } from "./helpers/dom";

/*
NOTE: injectComment は chrome.scripting.executeScript で「文字列化して」
      対象ページに注入されるため、外部スコープの変数を一切参照できない。

      ここでは toString() -> new Function で関数を作り直すことで、
      その条件をそのまま再現している。外部スコープを参照していれば
      ReferenceError になり、テストが落ちる。

      実際に定数を関数の外に置いてしまい、全画面表示のときだけ
      ReferenceError で落ちる不具合を踏んだので、その回帰テストでもある。
*/
const injectInIsolatedScope = new Function(
  `return (${injectComment.toString()})`
)() as typeof injectComment;

let window: JSDOM["window"];

const setupPage = () => {
  const dom = new JSDOM("<!doctype html><body></body>", {
    url: "https://docs.google.com/presentation/d/x/present",
  });

  window = dom.window;

  // NOTE: jsdom は Web Animations API を実装していないので最低限のスタブを置く
  window.Element.prototype.animate = () =>
    ({ ready: Promise.resolve(), onfinish: null } as unknown as Animation);

  const globals = globalThis as unknown as Record<string, unknown>;
  globals.window = window;
  globals.document = window.document;
  globals.chrome = {
    runtime: {
      sendMessage: async (request: { method: string }) => {
        if (request.method === "getFontSize") return "L";
        if (request.method === "getColor") return "blue";
        return undefined;
      },
    },
  };
};

const enterFullscreen = (tagName = "div"): Element => {
  const element = window.document.createElement(tagName);
  window.document.body.appendChild(element);

  Object.defineProperty(window.document, "fullscreenElement", {
    value: element,
    configurable: true,
  });

  return element;
};

const getComment = (): HTMLElement | null =>
  window.document.querySelector(".slack-comment-flow");

const TEXT_ONLY: CommentToken[] = [{ type: "text", value: "こんにちは" }];

describe("コメントの差し込み", () => {
  beforeEach(setupPage);

  it("外部スコープを参照しない（注入しても ReferenceError にならない）", async () => {
    await injectInIsolatedScope(TEXT_ONLY);

    assert.ok(getComment(), "コメントが差し込まれていること");
  });

  it("通常時は body に差し込む", async () => {
    await injectInIsolatedScope(TEXT_ONLY);

    assert.equal(getComment()?.parentElement, window.document.body);
  });

  it("テキストをそのまま表示する", async () => {
    await injectInIsolatedScope(TEXT_ONLY);

    assert.equal(getComment()?.textContent, "こんにちは");
  });

  it("画面外（右端）から流し始める", async () => {
    await injectInIsolatedScope(TEXT_ONLY);

    assert.equal(getComment()?.style.left, `${window.innerWidth}px`);
  });

  it("他の要素に隠れないよう z-index を最大にする", async () => {
    await injectInIsolatedScope(TEXT_ONLY);

    assert.equal(getComment()?.style.zIndex, "2147483647");
  });
});

describe("全画面表示への対応", () => {
  beforeEach(setupPage);

  it("全画面表示中は全画面要素の中に差し込む（top layer に隠されないため）", async () => {
    const overlay = enterFullscreen("div");

    await injectInIsolatedScope(TEXT_ONLY);

    assert.equal(getComment()?.parentElement, overlay);
  });

  it("全画面要素が <iframe> の場合は body に戻す（子要素を描画できないため）", async () => {
    enterFullscreen("iframe");

    await injectInIsolatedScope(TEXT_ONLY);

    assert.equal(getComment()?.parentElement, window.document.body);
  });

  it("全画面要素が <video> の場合は body に戻す", async () => {
    enterFullscreen("video");

    await injectInIsolatedScope(TEXT_ONLY);

    assert.equal(getComment()?.parentElement, window.document.body);
  });

  it("全画面表示中はページのスクロール量を足さない", async () => {
    enterFullscreen("div");

    await injectInIsolatedScope(TEXT_ONLY);

    // NOTE: 全画面要素が基準になるので、top はビューポート内に収まる
    const top = Number.parseInt(getComment()?.style.top ?? "-1", 10);

    assert.ok(top >= 0 && top < window.innerHeight, `top=${top}`);
  });
});

describe("絵文字の差し込み", () => {
  beforeEach(setupPage);

  const withEmoji: CommentToken[] = [
    { type: "text", value: "標準" },
    { type: "image", src: `${STANDARD_EMOJI_BASE}/1f64c@2x.png`, alt: "🙌" },
    { type: "text", value: "とカスタム" },
    { type: "image", src: CUSTOM_EMOJI_SRC, alt: ":maron:" },
  ];

  // NOTE: injectComment は途中で何度か await するので、その分だけ進める
  const flush = async () => {
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  };

  // NOTE: CSP で弾かれた場合と同じように、すべての画像を読み込み失敗にする
  const failAllImages = async () => {
    await flush();
    window.document
      .querySelectorAll("img")
      .forEach((image) => image.dispatchEvent(new window.Event("error")));
  };

  it("テキストと <img> を並べて組み立てる", async () => {
    const injecting = injectInIsolatedScope(withEmoji);
    await flush();

    const images = Array.from(window.document.querySelectorAll("img"));

    assert.equal(images.length, 2);
    assert.equal(
      images[0].getAttribute("src"),
      `${STANDARD_EMOJI_BASE}/1f64c@2x.png`
    );
    assert.equal(images[1].getAttribute("src"), CUSTOM_EMOJI_SRC);

    await failAllImages();
    await injecting;
  });

  it("<img> の高さを 1em にして Font Size に追従させる", async () => {
    const injecting = injectInIsolatedScope(withEmoji);
    await flush();

    const image = window.document.querySelector("img") as HTMLImageElement;

    assert.equal(image.style.height, "1em");

    await failAllImages();
    await injecting;
  });

  it("読み込みに失敗したら代替テキストに差し替える", async () => {
    const injecting = injectInIsolatedScope(withEmoji);
    await failAllImages();
    await injecting;

    assert.equal(getComment()?.textContent, "標準🙌とカスタム:maron:");
  });

  it("応答が返らないまま止まらないよう、タイムアウトして流す", async () => {
    // NOTE: jsdom は画像を読み込まないので、応答が返らない状態と同じになる
    await injectInIsolatedScope(withEmoji);

    assert.ok(getComment(), "コメントが差し込まれていること");
    assert.equal(getComment()?.textContent, "標準🙌とカスタム:maron:");
  });

  it("全画面表示中でも絵文字を含むコメントを流せる", async () => {
    const overlay = enterFullscreen("div");

    const injecting = injectInIsolatedScope(withEmoji);
    await failAllImages();
    await injecting;

    assert.equal(getComment()?.parentElement, overlay);
  });
});
