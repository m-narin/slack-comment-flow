import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeHTMLSpecialWord } from "../src/contentScripts/utils/decodeHTMLSpecialWord";

describe("HTML エンティティのデコード", () => {
  it("&amp; を & に戻す", () => {
    assert.equal(decodeHTMLSpecialWord("A&amp;B"), "A&B");
  });

  it("&lt; と &gt; を < > に戻す", () => {
    assert.equal(decodeHTMLSpecialWord("&lt;div&gt;"), "<div>");
  });

  it("&quot; と &#x27; を \" ' に戻す", () => {
    assert.equal(decodeHTMLSpecialWord("&quot;a&#x27;b"), "\"a'b");
  });

  it("同じエンティティが複数あってもすべて戻す", () => {
    assert.equal(decodeHTMLSpecialWord("&amp;&amp;&amp;"), "&&&");
  });

  it("エンティティが無い文字列はそのまま返す", () => {
    assert.equal(decodeHTMLSpecialWord("ふつうの文字列"), "ふつうの文字列");
  });
});
