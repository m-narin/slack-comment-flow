import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractMessageText,
  extractMessageTokens,
  extractPlainTokens,
} from "../src/contentScripts/utils/extractMessageText";
import {
  CUSTOM_EMOJI_SRC,
  STANDARD_EMOJI_BASE,
  createMessageContainer,
  createSection,
  emojiImg,
} from "./helpers/dom";

describe("テキストの抽出", () => {
  it("本文をそのまま取り出す", () => {
    const section = createSection("こんにちは");

    assert.deepEqual(extractPlainTokens(section), [
      { type: "text", value: "こんにちは" },
    ]);
  });

  it("<br> を半角スペースにする", () => {
    const section = createSection('1行目<br aria-hidden="true">2行目');

    assert.deepEqual(extractPlainTokens(section), [
      { type: "text", value: "1行目 2行目" },
    ]);
  });

  it("段落区切り（.c-mrkdwn__br）を半角スペースにする", () => {
    const section = createSection(
      '前<span class="c-mrkdwn__br" data-stringify-type="paragraph-break"></span>後'
    );

    assert.deepEqual(extractPlainTokens(section), [
      { type: "text", value: "前 後" },
    ]);
  });

  it("連続する空白を1つにまとめ、前後の空白を落とす", () => {
    const section = createSection("  空白   の   テスト  ");

    assert.deepEqual(extractPlainTokens(section), [
      { type: "text", value: "空白 の テスト" },
    ]);
  });

  it("hidden / aria-hidden / .sr-only / data-stringify-ignore を除外する", () => {
    const section = createSection(`
      本文
      <span hidden>hidden は除外</span>
      <span aria-hidden="true">aria-hidden は除外</span>
      <span class="sr-only">sr-only は除外</span>
      <span data-stringify-ignore="true">stringify-ignore は除外</span>
    `);

    assert.deepEqual(extractPlainTokens(section), [
      { type: "text", value: "本文" },
    ]);
  });

  it("「（編集済み）」ラベルを除外する", () => {
    const section = createSection(
      '編集したメッセージ<span class="c-message__edited_label">&nbsp;（編集済み）&nbsp;</span>'
    );

    assert.deepEqual(extractPlainTokens(section), [
      { type: "text", value: "編集したメッセージ" },
    ]);
  });

  it("<script> / <style> を除外する", () => {
    const section = createSection(
      "本文<script>alert(1)</script><style>.a{}</style>"
    );

    assert.deepEqual(extractPlainTokens(section), [
      { type: "text", value: "本文" },
    ]);
  });

  it("入れ子になった要素の中のテキストも拾う", () => {
    const section = createSection(
      '<b>太字</b>と<a href="https://example.com">リンク</a>'
    );

    assert.deepEqual(extractPlainTokens(section), [
      { type: "text", value: "太字とリンク" },
    ]);
  });
});

describe("絵文字の抽出", () => {
  it("標準絵文字を画像トークンにし、代替テキストに Unicode の絵文字を入れる", () => {
    const section = createSection(
      emojiImg(`${STANDARD_EMOJI_BASE}/1f64c.png`, ":バンザイ:")
    );

    assert.deepEqual(extractPlainTokens(section), [
      { type: "image", src: `${STANDARD_EMOJI_BASE}/1f64c.png`, alt: "🙌" },
    ]);
  });

  it("Retina の @2x / @3x が付いていても復元できる", () => {
    const at2x = createSection(
      emojiImg(`${STANDARD_EMOJI_BASE}/1f64c@2x.png`, ":バンザイ:")
    );
    const at3x = createSection(
      emojiImg(`${STANDARD_EMOJI_BASE}/1f514@3x.png`, ":bell:")
    );

    assert.equal(extractPlainTokens(at2x)[0].type, "image");
    assert.equal((extractPlainTokens(at2x)[0] as { alt: string }).alt, "🙌");
    assert.equal((extractPlainTokens(at3x)[0] as { alt: string }).alt, "🔔");
  });

  it("ZWJ シーケンスを復元できる", () => {
    const section = createSection(
      emojiImg(
        `${STANDARD_EMOJI_BASE}/1f469-200d-1f4bb@2x.png`,
        ":woman_technologist:"
      )
    );

    assert.equal(
      (extractPlainTokens(section)[0] as { alt: string }).alt,
      "👩‍💻"
    );
  });

  it("国旗（regional indicator）を復元できる", () => {
    const section = createSection(
      emojiImg(`${STANDARD_EMOJI_BASE}/1f1ef-1f1f5.png`, ":jp:")
    );

    assert.equal((extractPlainTokens(section)[0] as { alt: string }).alt, "🇯🇵");
  });

  it("クエリ文字列が付いていても復元できる", () => {
    const section = createSection(
      emojiImg(`${STANDARD_EMOJI_BASE}/1f514.png?v=2`, ":bell:")
    );

    assert.equal((extractPlainTokens(section)[0] as { alt: string }).alt, "🔔");
  });

  it("カスタム絵文字は画像トークンにし、代替テキストに :name: を入れる", () => {
    const section = createSection(emojiImg(CUSTOM_EMOJI_SRC, ":maron:"));

    assert.deepEqual(extractPlainTokens(section), [
      { type: "image", src: CUSTOM_EMOJI_SRC, alt: ":maron:" },
    ]);
  });

  it("コードポイントでないファイル名は Unicode に復元せず :name: のままにする", () => {
    const src = `${STANDARD_EMOJI_BASE}/not-a-codepoint.png`;
    const section = createSection(emojiImg(src, ":custom:"));

    assert.deepEqual(extractPlainTokens(section), [
      { type: "image", src, alt: ":custom:" },
    ]);
  });

  it("src が無い場合はテキストトークンにする", () => {
    const section = createSection('<img alt=":shrug:">');

    assert.deepEqual(extractPlainTokens(section), [
      { type: "text", value: ":shrug:" },
    ]);
  });

  it("テキストと絵文字が混ざっても順番を保つ", () => {
    const section = createSection(
      `前${emojiImg(`${STANDARD_EMOJI_BASE}/1f64c@2x.png`, ":バンザイ:")}後`
    );

    assert.deepEqual(extractPlainTokens(section), [
      { type: "text", value: "前" },
      { type: "image", src: `${STANDARD_EMOJI_BASE}/1f64c@2x.png`, alt: "🙌" },
      { type: "text", value: "後" },
    ]);
  });
});

describe("メッセージ単位の抽出", () => {
  it("送信者名・時刻・スクリーンリーダー用テキストを含めない", () => {
    const container = createMessageContainer(["本文だけ取りたい"]);

    assert.equal(extractMessageText(container), "本文だけ取りたい");
  });

  it("複数のセクションを半角スペースで繋ぐ", () => {
    const container = createMessageContainer(["1つ目", "2つ目"]);

    assert.equal(extractMessageText(container), "1つ目 2つ目");
  });

  it("本文が無いメッセージは空のトークン列になる", () => {
    const container = createMessageContainer([]);

    assert.deepEqual(extractMessageTokens(container), []);
  });

  it("絵文字を含むメッセージをトークン列にする", () => {
    const container = createMessageContainer([
      `カスタム絵文字${emojiImg(CUSTOM_EMOJI_SRC, ":maron:")}`,
    ]);

    assert.deepEqual(extractMessageTokens(container), [
      { type: "text", value: "カスタム絵文字" },
      { type: "image", src: CUSTOM_EMOJI_SRC, alt: ":maron:" },
    ]);
  });

  it("文字列版は画像を代替テキストで表す", () => {
    const container = createMessageContainer([
      `標準${emojiImg(`${STANDARD_EMOJI_BASE}/1f64c@2x.png`, ":バンザイ:")}`,
    ]);

    assert.equal(extractMessageText(container), "標準🙌");
  });
});
