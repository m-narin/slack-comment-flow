import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/*
NOTE: 実際に踏んだ不具合の回帰テスト。

      どちらも「書けてしまうが、特定の状況でだけ壊れる」種類のもので、
      普通に動かしているだけでは気づけなかった。
      ソースを静的に見て、同じ書き方が復活していないかを確かめる。
*/

/*
NOTE: テストはコンパイル後の dist-test から実行されるので、__dirname ではなく
      Project のルート（npm test を叩いた場所）を基準に元のソースを読む。
*/
const SRC = join(process.cwd(), "src");

const readSourceFiles = (dir: string): { path: string; code: string }[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) return readSourceFiles(path);
    if (!entry.name.endsWith(".ts")) return [];

    return [{ path, code: readFileSync(path, "utf-8") }];
  });

// NOTE: コメント行は対象外にする（注意書き自体に単語が出てくるため）
const stripComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("content script はタイマーを使わない", () => {
  /*
  NOTE: Slack タブを裏に回すと Chrome が setTimeout / setInterval を throttle する
        （1 秒に 1 回、5 分ほど経つと 1 分に 1 回）。
        別タブに映した資料の上に流すのが本来の使い方なので、
        content script でタイマーを使うとコメントが流れなくなる。
  */
  const contentScripts = readSourceFiles(join(SRC, "contentScripts"));

  it("対象のファイルが見つかっている", () => {
    assert.ok(contentScripts.length > 0);
  });

  contentScripts.forEach(({ path, code }) => {
    it(`${path.replace(SRC, "src")} に setTimeout / setInterval が無い`, () => {
      const source = stripComments(code);

      assert.ok(
        !/\bsetTimeout\b/.test(source),
        "setTimeout はバックグラウンドタブで throttle される"
      );
      assert.ok(
        !/\bsetInterval\b/.test(source),
        "setInterval はバックグラウンドタブで throttle される"
      );
    });
  });
});

describe("injectComment は外部スコープを参照しない", () => {
  /*
  NOTE: chrome.scripting.executeScript は関数を文字列化して注入するため、
        モジュールスコープの定数を参照すると注入先で ReferenceError になる。
        実行時の検証は injectComment.test.ts で行っているので、
        ここでは「関数の外に定数を置いていないか」を見る。
  */
  it("import 以外のトップレベル宣言が injectComment だけになっている", () => {
    const code = stripComments(
      readFileSync(join(SRC, "background", "injectComment.ts"), "utf-8")
    );

    const topLevelDeclarations = code
      .split("\n")
      .filter((line) => /^(export )?(const|let|var|function|class) /.test(line))
      .map((line) => line.trim());

    assert.deepEqual(
      topLevelDeclarations,
      ["export const injectComment = async (tokens: CommentToken[]) => {"],
      "定数やヘルパーは injectComment の中に置くこと"
    );
  });
});
