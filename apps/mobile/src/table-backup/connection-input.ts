// 飞书连接配置的录入解析（ADR 0213 双轨录入）。
//
// - 云空间「/base/<app_token>」链接：直接抽取 app_token。
// - 裸 app_token：原样接受（去除首尾空白）。
// - 知识库「/wiki/」链接：携带的是 wiki 节点 token 而非 app_token，
//   解析它需要开放平台应用权限，本通道做不到——返回 wiki_link 判定，
//   由 UI 引导使用者用「开发工具」插件查出 app_token 后再粘贴。
export type ParsedConnectionInput =
  | { kind: "app_token"; appToken: string }
  | { kind: "wiki_link" }
  | { kind: "empty" }
  | { kind: "unrecognized" };

export function parseConnectionInput(raw: string): ParsedConnectionInput {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { kind: "empty" };
  }

  const asUrl = tryParseUrl(trimmed);
  if (asUrl) {
    const segments = asUrl.pathname.split("/").filter((segment) => segment !== "");
    const baseIndex = segments.indexOf("base");
    if (baseIndex >= 0) {
      const token = segments[baseIndex + 1];
      if (token && token.trim() !== "") {
        return { kind: "app_token", appToken: token };
      }
      return { kind: "unrecognized" };
    }
    if (segments.includes("wiki")) {
      return { kind: "wiki_link" };
    }
    return { kind: "unrecognized" };
  }

  // 非 URL：视为裸 app_token 原样接受。含空白或路径分隔符说明是残缺链接，拒绝。
  if (/[\s/]/.test(trimmed)) {
    return { kind: "unrecognized" };
  }
  return { kind: "app_token", appToken: trimmed };
}

function tryParseUrl(value: string): URL | null {
  if (!/^https?:\/\//i.test(value)) {
    return null;
  }
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
