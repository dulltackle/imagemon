import { describe, expect, it } from "vitest";

import { parseConnectionInput } from "./connection-input";

describe("parseConnectionInput", () => {
  it("从 /base/ 云空间链接抽取 app_token", () => {
    expect(
      parseConnectionInput("https://example.feishu.cn/base/bascnAbc123?table=tblXyz"),
    ).toEqual({ kind: "app_token", appToken: "bascnAbc123" });
  });

  it("原样接受裸 app_token 并去除首尾空白", () => {
    expect(parseConnectionInput("  bascnAbc123  ")).toEqual({
      kind: "app_token",
      appToken: "bascnAbc123",
    });
  });

  it("识别 /wiki/ 链接并返回 wiki 判定", () => {
    expect(
      parseConnectionInput("https://example.feishu.cn/wiki/wikcnSomeNodeToken"),
    ).toEqual({ kind: "wiki_link" });
  });

  it("空输入返回 empty", () => {
    expect(parseConnectionInput("   ")).toEqual({ kind: "empty" });
  });

  it("无法识别的链接返回 unrecognized", () => {
    expect(parseConnectionInput("https://example.feishu.cn/drive/folder/xyz")).toEqual({
      kind: "unrecognized",
    });
  });

  it("/base/ 后缺少 token 返回 unrecognized", () => {
    expect(parseConnectionInput("https://example.feishu.cn/base/")).toEqual({
      kind: "unrecognized",
    });
  });

  it("含空白或斜杠的残缺输入返回 unrecognized", () => {
    expect(parseConnectionInput("bascn Abc")).toEqual({ kind: "unrecognized" });
    expect(parseConnectionInput("base/bascnAbc")).toEqual({ kind: "unrecognized" });
  });
});
