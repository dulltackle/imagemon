#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  dirname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRECTORIES = ["apps/mobile/app", "apps/mobile/src"];
const EXPO_SYMBOLS_RUNTIME_FILES = new Set([
  "apps/mobile/src/tw/symbol-icon.ios.tsx",
]);
const EXPO_SYMBOLS_TYPE_FILES = new Set([
  "apps/mobile/src/tw/symbol-icon-definitions.ts",
  "apps/mobile/src/tw/symbol-icon.types.ts",
]);
const VECTOR_ICONS_RUNTIME_FILES = new Set([
  "apps/mobile/app/(tabs)/_layout.tsx",
  "apps/mobile/src/tw/symbol-icon-fonts.ts",
  "apps/mobile/src/tw/symbol-icon.tsx",
]);
const VECTOR_ICONS_TYPE_FILES = new Set([
  "apps/mobile/src/tw/symbol-icon-definitions.ts",
]);

export function scanMobileSymbolIcons(rootDirectory) {
  const root = resolve(rootDirectory);
  const diagnostics = [];
  const files = [];

  for (const directory of SCAN_DIRECTORIES) {
    const absoluteDirectory = resolve(root, directory);
    if (!existsSync(absoluteDirectory) || !statSync(absoluteDirectory).isDirectory()) {
      diagnostics.push(scannerDiagnostic(
        "SCAN_ROOT_MISSING",
        directory,
        `缺少扫描目录：${directory}`,
      ));
      continue;
    }
    collectProductionFiles(absoluteDirectory, files);
  }

  if (files.length === 0) {
    diagnostics.push(scannerDiagnostic(
      "SCAN_NO_FILES",
      "(scanner)",
      "扫描范围内没有生产 TypeScript 文件。",
    ));
  }

  for (const file of files) {
    scanSourceFile(root, file, diagnostics);
  }

  return diagnostics.sort(compareDiagnostics);
}

function collectProductionFiles(directory, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      collectProductionFiles(absolutePath, files);
      continue;
    }
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) {
      continue;
    }
    if (/\.d\.ts$|\.(?:test|spec)\.tsx?$/.test(entry.name)) {
      continue;
    }
    files.push(absolutePath);
  }
}

function scanSourceFile(root, absolutePath, diagnostics) {
  const source = readFileSync(absolutePath, "utf8");
  const relativePath = normalizePath(relative(root, absolutePath));
  const sourceFile = ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    absolutePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const platformAliases = collectPlatformAliases(sourceFile);
  const addDiagnostic = (rule, node, message) => {
    const position = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile),
    );
    diagnostics.push({
      rule,
      file: relativePath,
      line: position.line + 1,
      column: position.character + 1,
      message,
    });
  };

  for (const parseDiagnostic of sourceFile.parseDiagnostics ?? []) {
    const position = sourceFile.getLineAndCharacterOfPosition(
      parseDiagnostic.start ?? 0,
    );
    diagnostics.push({
      rule: "PARSE_ERROR",
      file: relativePath,
      line: position.line + 1,
      column: position.character + 1,
      message: ts.flattenDiagnosticMessageText(parseDiagnostic.messageText, " "),
    });
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      checkPlatformModuleUsage(
        node.moduleSpecifier.text,
        isTypeOnlyImport(node),
        relativePath,
        node,
        addDiagnostic,
      );
    } else if (
      ts.isExportDeclaration(node)
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)
    ) {
      checkPlatformModuleUsage(
        node.moduleSpecifier.text,
        isTypeOnlyExport(node),
        relativePath,
        node,
        addDiagnostic,
      );
    } else if (
      ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression
      && ts.isStringLiteral(node.moduleReference.expression)
    ) {
      checkPlatformModuleUsage(
        node.moduleReference.expression.text,
        node.isTypeOnly,
        relativePath,
        node,
        addDiagnostic,
      );
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      if (ts.isLiteralTypeNode(argument) && ts.isStringLiteral(argument.literal)) {
        checkPlatformModuleUsage(
          argument.literal.text,
          true,
          relativePath,
          node,
          addDiagnostic,
        );
      }
    } else if (ts.isCallExpression(node)) {
      const moduleName = getRuntimeModuleName(node);
      if (moduleName) {
        checkPlatformModuleUsage(
          moduleName,
          false,
          relativePath,
          node,
          addDiagnostic,
        );
      }
    }

    if (ts.isIdentifier(node) && node.text === "SFSymbolName") {
      addDiagnostic(
        "LEGACY_SF_SYMBOL_TYPE",
        node,
        "生产代码不得继续引用 SFSymbolName。",
      );
    }

    if (isSfUriLiteral(node)) {
      addDiagnostic(
        "LEGACY_SF_URI",
        node,
        "生产代码不得把 sf: URI 交给图片组件。",
      );
    }

    if (ts.isInterfaceDeclaration(node) && node.name.text === "SymbolIconProps") {
      for (const member of node.members) {
        if (member.name?.getText(sourceFile) === "fallbackName") {
          addDiagnostic(
            "SYMBOL_ICON_FALLBACK_PROP",
            member,
            "SymbolIconProps 不得暴露 fallbackName。",
          );
        }
      }
    }

    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node))
      && isSymbolIconTag(node.tagName, sourceFile)
    ) {
      checkSymbolIconCall(
        node,
        sourceFile,
        platformAliases,
        addDiagnostic,
      );
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

function isTypeOnlyImport(node) {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  if (clause.name) return false;
  const bindings = clause.namedBindings;
  return Boolean(
    bindings
    && ts.isNamedImports(bindings)
    && bindings.elements.length > 0
    && bindings.elements.every((element) => element.isTypeOnly),
  );
}

function isTypeOnlyExport(node) {
  if (node.isTypeOnly) return true;
  return Boolean(
    node.exportClause
    && ts.isNamedExports(node.exportClause)
    && node.exportClause.elements.length > 0
    && node.exportClause.elements.every((element) => element.isTypeOnly),
  );
}

function getRuntimeModuleName(node) {
  if (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0])) {
    return null;
  }
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return node.arguments[0].text;
  }
  if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
    return node.arguments[0].text;
  }
  return null;
}

function checkPlatformModuleUsage(
  moduleName,
  typeOnly,
  relativePath,
  node,
  addDiagnostic,
) {
  if (isModule(moduleName, "sf-symbols-typescript")) {
    addDiagnostic(
      "IMPORT_SF_SYMBOLS_TYPESCRIPT",
      node,
      "生产代码不得直接导入 sf-symbols-typescript。",
    );
    return;
  }

  if (isModule(moduleName, "expo-symbols")) {
    const allowed = typeOnly
      ? EXPO_SYMBOLS_TYPE_FILES
      : EXPO_SYMBOLS_RUNTIME_FILES;
    if (!allowed.has(relativePath)) {
      addDiagnostic(
        typeOnly
          ? "IMPORT_PLATFORM_TYPE_BOUNDARY"
          : "IMPORT_EXPO_SYMBOLS_RUNTIME",
        node,
        typeOnly
          ? "expo-symbols 的类型导入只能存在于集中定义与公共类型文件。"
          : "expo-symbols 的运行时导入只能存在于 iOS 图标适配器。",
      );
    }
    return;
  }

  if (isModule(moduleName, "@expo/vector-icons")) {
    const allowed = typeOnly
      ? VECTOR_ICONS_TYPE_FILES
      : VECTOR_ICONS_RUNTIME_FILES;
    if (!allowed.has(relativePath)) {
      addDiagnostic(
        typeOnly
          ? "IMPORT_PLATFORM_TYPE_BOUNDARY"
          : "IMPORT_VECTOR_ICONS_RUNTIME",
        node,
        typeOnly
          ? "Ionicons 的类型导入只能存在于集中定义文件。"
          : "Ionicons 的运行时导入只能存在于 fallback、字体表或 NativeTabs。",
      );
    }
  }
}

function isModule(moduleName, packageName) {
  return moduleName === packageName || moduleName.startsWith(`${packageName}/`);
}

function isSfUriLiteral(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text.startsWith("sf:");
  }
  return ts.isTemplateExpression(node) && node.head.text.startsWith("sf:");
}

function isSymbolIconTag(tagName, sourceFile) {
  return tagName.getText(sourceFile).split(".").at(-1) === "SymbolIcon";
}

function checkSymbolIconCall(
  node,
  sourceFile,
  platformAliases,
  addDiagnostic,
) {
  for (const attribute of node.attributes.properties) {
    if (ts.isJsxSpreadAttribute(attribute)) {
      addDiagnostic(
        "SYMBOL_ICON_SPREAD",
        attribute,
        "SymbolIcon 不允许使用无法静态审查的 spread props。",
      );
      continue;
    }

    const attributeName = attribute.name.getText(sourceFile);
    if (attributeName === "fallbackName") {
      addDiagnostic(
        "SYMBOL_ICON_FALLBACK",
        attribute,
        "业务调用点不得传入 fallbackName。",
      );
    }
    if (
      attributeName === "name"
      && attribute.initializer
      && ts.isJsxExpression(attribute.initializer)
      && attribute.initializer.expression
      && containsPlatformReference(
        attribute.initializer.expression,
        sourceFile,
        platformAliases,
      )
    ) {
      addDiagnostic(
        "SYMBOL_ICON_PLATFORM_BRANCH",
        attribute,
        "SymbolIcon 的 name 不得按平台分支。",
      );
    }
  }

  if (hasPlatformControlledAncestor(node, sourceFile, platformAliases)) {
    addDiagnostic(
      "SYMBOL_ICON_PLATFORM_BRANCH",
      node,
      "业务页面不得按平台决定是否渲染 SymbolIcon。",
    );
  }
}

function hasPlatformControlledAncestor(node, sourceFile, platformAliases) {
  let current = node;
  while (current.parent && !ts.isSourceFile(current.parent)) {
    const parent = current.parent;
    if (
      ts.isConditionalExpression(parent)
      && current !== parent.condition
      && containsPlatformReference(parent.condition, sourceFile, platformAliases)
    ) {
      return true;
    }
    if (
      ts.isIfStatement(parent)
      && current !== parent.expression
      && containsPlatformReference(parent.expression, sourceFile, platformAliases)
    ) {
      return true;
    }
    if (
      ts.isSwitchStatement(parent)
      && containsPlatformReference(parent.expression, sourceFile, platformAliases)
    ) {
      return true;
    }
    if (
      ts.isBinaryExpression(parent)
      && current === parent.right
      && (
        parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
        || parent.operatorToken.kind === ts.SyntaxKind.BarBarToken
      )
      && containsPlatformReference(parent.left, sourceFile, platformAliases)
    ) {
      return true;
    }
    current = parent;
  }
  return false;
}

function collectPlatformAliases(sourceFile) {
  const aliases = new Set(["Platform"]);
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement)
      || !ts.isStringLiteral(statement.moduleSpecifier)
      || statement.moduleSpecifier.text !== "react-native"
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if ((element.propertyName?.text ?? element.name.text) === "Platform") {
        aliases.add(element.name.text);
      }
    }
  }
  return aliases;
}

function containsPlatformReference(node, sourceFile, platformAliases) {
  let found = false;
  function visit(current) {
    if (found) return;
    if (ts.isPropertyAccessExpression(current)) {
      if (
        ts.isIdentifier(current.expression)
        && platformAliases.has(current.expression.text)
        && current.name.text === "OS"
      ) {
        found = true;
        return;
      }
      if (current.getText(sourceFile).replace(/\s/g, "") === "process.env.EXPO_OS") {
        found = true;
        return;
      }
    }
    if (
      ts.isElementAccessExpression(current)
      && current.argumentExpression
      && ts.isStringLiteral(current.argumentExpression)
    ) {
      const expressionText = current.expression
        .getText(sourceFile)
        .replace(/\s/g, "");
      if (
        (platformAliases.has(expressionText)
          && current.argumentExpression.text === "OS")
        || (expressionText === "process.env"
          && current.argumentExpression.text === "EXPO_OS")
      ) {
        found = true;
        return;
      }
    }
    ts.forEachChild(current, visit);
  }
  visit(node);
  return found;
}

function scannerDiagnostic(rule, file, message) {
  return { rule, file, line: 1, column: 1, message };
}

function compareDiagnostics(left, right) {
  return left.file.localeCompare(right.file)
    || left.line - right.line
    || left.column - right.column
    || left.rule.localeCompare(right.rule);
}

function normalizePath(path) {
  return path.split(sep).join("/");
}

function parseArguments(args) {
  let root = DEFAULT_ROOT;
  let selfTest = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--self-test") {
      selfTest = true;
      continue;
    }
    if (argument === "--root" && args[index + 1]) {
      root = resolve(args[index + 1]);
      index += 1;
      continue;
    }
    throw new Error(
      "用法：node scripts/check-mobile-symbol-icons.mjs [--root <path>] [--self-test]",
    );
  }
  return { root, selfTest };
}

function runSelfTest() {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "imagemon-mobile-icons-"));
  try {
    assertFixture("合法 type-only 与白名单运行时导入", temporaryRoot, {
      "apps/mobile/src/tw/symbol-icon-definitions.ts": [
        'import type Ionicons from "@expo/vector-icons/Ionicons";',
        'import type { SFSymbol } from "expo-symbols";',
      ].join("\n"),
      "apps/mobile/src/tw/symbol-icon.types.ts":
        'import type { SymbolWeight } from "expo-symbols";',
      "apps/mobile/src/tw/symbol-icon.ios.tsx":
        'import { SymbolView } from "expo-symbols"; export const value = SymbolView;',
      "apps/mobile/src/tw/symbol-icon.tsx":
        'import Ionicons from "@expo/vector-icons/Ionicons"; export const value = Ionicons;',
      "apps/mobile/src/tw/symbol-icon-fonts.ts":
        'import Ionicons from "@expo/vector-icons/Ionicons"; export const value = Ionicons.font;',
      "apps/mobile/app/(tabs)/_layout.tsx":
        'import Ionicons from "@expo/vector-icons/Ionicons"; export const value = Ionicons;',
    }, []);

    assertFixture("业务页面运行时导入 expo-symbols", temporaryRoot, {
      "apps/mobile/app/index.tsx":
        'import { SymbolView } from "expo-symbols"; export const value = SymbolView;',
    }, ["IMPORT_EXPO_SYMBOLS_RUNTIME"]);

    assertFixture("业务页面运行时导入 Ionicons", temporaryRoot, {
      "apps/mobile/app/index.tsx":
        'import Ionicons from "@expo/vector-icons/Ionicons"; export const value = Ionicons;',
    }, ["IMPORT_VECTOR_ICONS_RUNTIME"]);

    assertFixture("混合 import 不是 type-only", temporaryRoot, {
      "apps/mobile/src/tw/symbol-icon-definitions.ts":
        'import { type SFSymbol, SymbolView } from "expo-symbols"; export const value = SymbolView;',
    }, ["IMPORT_EXPO_SYMBOLS_RUNTIME"]);

    assertFixture("旧 sf URI", temporaryRoot, {
      "apps/mobile/app/index.tsx":
        "export const value = `sf:${name}`;",
    }, ["LEGACY_SF_URI"]);

    assertFixture("调用点 fallbackName", temporaryRoot, {
      "apps/mobile/app/index.tsx":
        'export const value = <SymbolIcon name="photo" fallbackName="image" />;',
    }, ["SYMBOL_ICON_FALLBACK"]);

    assertFixture("调用点平台分支", temporaryRoot, {
      "apps/mobile/app/index.tsx": [
        'import { Platform } from "react-native";',
        'export const value = <SymbolIcon name={Platform.OS === "ios" ? "photo" : "photos"} />;',
      ].join("\n"),
    }, ["SYMBOL_ICON_PLATFORM_BRANCH"]);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
  console.log("移动端图标静态检查器自测通过（7 组 fixture）");
}

function assertFixture(name, temporaryRoot, files, expectedRules) {
  const fixtureRoot = resolve(temporaryRoot, name.replace(/\W+/g, "-"));
  mkdirSync(resolve(fixtureRoot, "apps/mobile/app"), { recursive: true });
  mkdirSync(resolve(fixtureRoot, "apps/mobile/src"), { recursive: true });
  for (const [relativePath, source] of Object.entries(files)) {
    const absolutePath = resolve(fixtureRoot, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, `${source}\n`);
  }

  const diagnostics = scanMobileSymbolIcons(fixtureRoot);
  if (expectedRules.length === 0 && diagnostics.length > 0) {
    throw new Error(
      `${name} 应通过，但得到：${diagnostics.map(formatDiagnostic).join("\n")}`,
    );
  }
  const actualRules = new Set(diagnostics.map((diagnostic) => diagnostic.rule));
  for (const rule of expectedRules) {
    if (!actualRules.has(rule)) {
      throw new Error(
        `${name} 应触发 ${rule}，实际为：${[...actualRules].join(", ") || "无"}`,
      );
    }
  }
}

function formatDiagnostic(diagnostic) {
  return `${diagnostic.file}:${diagnostic.line}:${diagnostic.column} [${diagnostic.rule}] ${diagnostic.message}`;
}

function main() {
  const { root, selfTest } = parseArguments(process.argv.slice(2));
  if (selfTest) {
    runSelfTest();
    return;
  }

  const diagnostics = scanMobileSymbolIcons(root);
  if (diagnostics.length > 0) {
    for (const diagnostic of diagnostics) {
      console.error(formatDiagnostic(diagnostic));
    }
    process.exitCode = 1;
    return;
  }
  console.log("移动端图标渲染与导入边界检查通过");
}

if (
  process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main();
}
