#!/usr/bin/env node
import { execFile, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { PNG } from "pngjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const MOBILE_DIR = path.join(REPO_ROOT, "apps", "mobile");
const DEFAULT_PORT = 8081;
const DEFAULT_BOOT_TIMEOUT_MS = 180_000;
const DEFAULT_ROUTE_DELAY_MS = 4_500;
const DEFAULT_INITIAL_LOAD_DELAY_MS = 12_000;
const DEFAULT_ROUTE_READY_TIMEOUT_MS = 180_000;
const MAX_EXPO_LAUNCH_RETRIES = 2;
const SYMBOL_ICON_PAGE_COUNT = 4;
const SYMBOL_ICONS_PER_PAGE = 8;
const SYMBOL_ICON_INSET_RATIO = 0.1;
const SYMBOL_ICON_MAX_FOREGROUND_LUMINANCE = 96;
const SYMBOL_ICON_MIN_FOREGROUND_PIXELS = 100;
const SYMBOL_ICON_MIN_WHITE_PIXEL_RATIO = 0.5;

const routes = [
  {
    name: "symbol-icons",
    path: "/screenshot-symbol-icons",
    symbolIconPages: SYMBOL_ICON_PAGE_COUNT,
  },
  {
    name: "catalog",
    path: "/",
    expectText: ["模板提炼", "已生成图鉴条目", "待查看"],
  },
  {
    name: "template-refinement",
    path: "/promptdex/refine",
    expectText: ["外部完整提示词", "生成提炼方案"],
  },
  {
    name: "promptdex-built-in-detail",
    path: "/promptdex/light-infographic",
    expectText: ["light-infographic", "生成图片", "图片规格"],
  },
  {
    name: "promptdex-personal-detail",
    path: "/promptdex/screenshot-personal-poster",
    expectText: ["screenshot-personal-poster", "生成图片", "图片规格"],
  },
  {
    name: "history-list",
    path: "/history",
    expectText: ["light-infographic", "完成", "待查看", "待处理"],
  },
  {
    name: "history-detail-completed",
    path: "/history/screenshot-history-completed",
    expectText: ["图鉴条目", "完整提示词"],
  },
  {
    // 「失败摘要」与「重新填写」在这条 fixture 上位于首屏之下，而截图工具不滚动，
    // 因此断言只取首屏可见文本。
    name: "history-detail-failed",
    path: "/history/screenshot-history-failed",
    expectText: ["图鉴条目", "失败"],
  },
  {
    name: "image-detail",
    path: "/images/screenshot-result-light",
    expectText: ["图片文件不可用", "基础规格"],
  },
  { name: "settings", path: "/settings", expectText: ["模型配置", "应用默认规格"] },
  {
    name: "default-image-spec",
    path: "/default-image-spec",
    expectText: ["尺寸", "当前版本固定"],
  },
  {
    name: "model-configurations",
    path: "/model-configurations",
    expectText: ["图片模型", "文本模型"],
  },
  {
    name: "model-configuration-new-image",
    path: "/model-configurations/new?type=image",
    expectText: ["Base URL", "保存并测试"],
  },
  {
    name: "model-configuration-new-text",
    path: "/model-configurations/new?type=text",
    expectText: ["Base URL", "保存并测试"],
  },
  { name: "first-run", path: "/first-run", expectText: ["图片模型", "文本模型"] },
];

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const adb = process.env.ADB || "adb";
const emulator = process.env.EMULATOR || "emulator";
let port = readIntegerEnv("IMAGEMON_EXPO_PORT", DEFAULT_PORT);
const bootTimeoutMs = readIntegerEnv(
  "IMAGEMON_ANDROID_BOOT_TIMEOUT_MS",
  DEFAULT_BOOT_TIMEOUT_MS,
);
const routeDelayMs = readIntegerEnv(
  "IMAGEMON_ANDROID_ROUTE_DELAY_MS",
  DEFAULT_ROUTE_DELAY_MS,
);
const initialLoadDelayMs = readIntegerEnv(
  "IMAGEMON_ANDROID_INITIAL_LOAD_DELAY_MS",
  DEFAULT_INITIAL_LOAD_DELAY_MS,
);
const routeReadyTimeoutMs = readIntegerEnv(
  "IMAGEMON_ANDROID_ROUTE_READY_TIMEOUT_MS",
  DEFAULT_ROUTE_READY_TIMEOUT_MS,
);
const outputDir = path.resolve(
  REPO_ROOT,
  process.env.IMAGEMON_ANDROID_SCREENSHOT_DIR ||
    path.join(
      "apps",
      "mobile",
      ".expo",
      "screenshots",
      "android",
      createTimestampSlug(),
    ),
);
const selectedRoutes = selectRoutes(args.only);

let emulatorProcess = null;
let metroProcess = null;

process.on("SIGINT", () => {
  cleanup().finally(() => process.exit(130));
});
process.on("SIGTERM", () => {
  cleanup().finally(() => process.exit(143));
});

main()
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    await cleanup();
    process.exit(1);
  });

async function main() {
  await mkdir(outputDir, { recursive: true });
  console.log(`截图输出目录: ${path.relative(REPO_ROOT, outputDir)}`);

  runChecked("npm", ["run", "mobile:prepare"], { cwd: REPO_ROOT });
  port = await resolveExpoPort(port);

  const device = await ensureAndroidDevice();
  await reverseMetroPort(device);
  await dismissKeyguard(device);
  const deviceInfo = await readDeviceInfo(device);

  metroProcess = startMetro();
  await waitForMetroReady(metroProcess, port, 90_000);
  await sleep(initialLoadDelayMs);

  const manifest = {
    createdAt: new Date().toISOString(),
    mode: "android-emulator",
    screenshotRuntime: "EXPO_PUBLIC_IMAGEMON_SCREENSHOT_MODE=1",
    device,
    deviceInfo,
    port,
    captures: [],
    symbolIconValidation: {
      pageCount: SYMBOL_ICON_PAGE_COUNT,
      iconsPerPage: SYMBOL_ICONS_PER_PAGE,
      insetRatio: SYMBOL_ICON_INSET_RATIO,
      maximumForegroundLuminance: SYMBOL_ICON_MAX_FOREGROUND_LUMINANCE,
      minimumForegroundPixels: SYMBOL_ICON_MIN_FOREGROUND_PIXELS,
      minimumWhitePixelRatio: SYMBOL_ICON_MIN_WHITE_PIXEL_RATIO,
    },
    symbolIconChecks: [],
    validationErrors: [],
  };

  try {
    for (const route of selectedRoutes) {
      if (route.symbolIconPages) {
        await captureSymbolIconPages(device, route, manifest);
      } else {
        await captureStandardRoute(device, route, manifest);
      }
      await writeManifest(manifest);
    }

    if (selectedRoutes.some((route) => route.symbolIconPages)) {
      validateCompleteSymbolIconMatrix(manifest);
    }
    await writeManifest(manifest);

    if (manifest.validationErrors.length > 0) {
      throw new Error(
        `图标视觉验收失败，共 ${manifest.validationErrors.length} 项。请查看 ${path.relative(
          REPO_ROOT,
          path.join(outputDir, "manifest.json"),
        )}`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!manifest.validationErrors.includes(message)) {
      manifest.validationErrors.push(message);
    }
    await writeManifest(manifest).catch(() => undefined);
    throw error;
  }

  await cleanup();
  console.log(`完成，共生成 ${manifest.captures.length} 张截图。`);
}

async function captureStandardRoute(device, route, manifest) {
  const url = buildExpoUrl(route.path);
  console.log(`打开 ${route.name}: ${url}`);
  await forceStopExpoGo(device);
  await openExpoUrl(device, url);
  await waitForRouteReady(device, route, url);
  await sleep(routeDelayMs);
  const file = path.join(outputDir, `${route.name}.png`);
  await captureScreenshot(device, file);
  manifest.captures.push({
    name: route.name,
    path: route.path,
    url,
    file: path.relative(REPO_ROOT, file),
  });
  console.log(`已截图: ${path.relative(REPO_ROOT, file)}`);
}

async function captureSymbolIconPages(device, route, manifest) {
  for (let page = 1; page <= route.symbolIconPages; page += 1) {
    try {
      await captureSymbolIconPage(device, route, page, manifest);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      manifest.validationErrors.push(`symbol-icons 第 ${page} 页：${message}`);
    }
    await writeManifest(manifest);
  }
}

async function captureSymbolIconPage(device, route, page, manifest) {
  const captureName = `symbol-icons-page-${page}`;
  const routePath = `${route.path}?page=${page}`;
  const url = buildExpoUrl(routePath);
  console.log(`打开 ${captureName}: ${url}`);
  await forceStopExpoGo(device);
  await openExpoUrl(device, url);
  await waitForSymbolPageReady(device, page, captureName, url);
  await sleep(routeDelayMs);

  const xml = await dumpWindowHierarchy(device);
  const xmlFile = path.join(outputDir, `${captureName}.xml`);
  await writeFile(xmlFile, xml);
  const pngFile = path.join(outputDir, `${captureName}.png`);
  const pngBuffer = await captureScreenshot(device, pngFile);
  manifest.captures.push({
    name: captureName,
    path: routePath,
    url,
    file: path.relative(REPO_ROOT, pngFile),
    uiHierarchyFile: path.relative(REPO_ROOT, xmlFile),
  });

  const analysis = analyzeSymbolIconPage(xml, pngBuffer, page);
  manifest.symbolIconChecks.push(...analysis.checks);
  manifest.validationErrors.push(...analysis.errors);
  console.log(
    `已校验 ${captureName}: ${analysis.checks.length} 个图标，${analysis.errors.length} 个错误`,
  );
}

function analyzeSymbolIconPage(xml, pngBuffer, page) {
  const errors = [];
  const checks = [];
  const png = PNG.sync.read(pngBuffer);
  const expectedNames = readSymbolPageNames(xml, page, errors);

  for (const name of expectedNames) {
    const checkErrors = [];
    const nodes = findNodesByContentDescription(
      xml,
      `symbol-check:${name}`,
    );
    if (nodes.length !== 1) {
      checkErrors.push(
        `${name} 的 accessibility 节点数量应为 1，实际为 ${nodes.length}`,
      );
    }

    const bounds = nodes.length > 0 ? parseNodeBounds(nodes[0]) : null;
    if (!bounds) {
      checkErrors.push(`${name} 缺少合法物理像素 bounds`);
    } else if (!areBoundsInsideImage(bounds, png)) {
      checkErrors.push(
        `${name} 的 bounds ${formatBounds(bounds)} 超出 ${png.width}x${png.height} PNG`,
      );
    }

    let inspectedBounds = null;
    let foregroundPixels = 0;
    let whitePixelRatio = 0;
    if (bounds && areBoundsInsideImage(bounds, png)) {
      inspectedBounds = insetBounds(bounds, SYMBOL_ICON_INSET_RATIO);
      if (!areBoundsInsideImage(inspectedBounds, png)) {
        checkErrors.push(`${name} 去除边缘后的检查区域无效`);
      } else {
        const pixelResult = analyzePixels(png, inspectedBounds);
        foregroundPixels = pixelResult.foregroundPixels;
        whitePixelRatio = pixelResult.whitePixelRatio;
        if (foregroundPixels < SYMBOL_ICON_MIN_FOREGROUND_PIXELS) {
          checkErrors.push(
            `${name} 的深色前景像素 ${foregroundPixels} 低于阈值 ${SYMBOL_ICON_MIN_FOREGROUND_PIXELS}`,
          );
        }
        if (whitePixelRatio < SYMBOL_ICON_MIN_WHITE_PIXEL_RATIO) {
          checkErrors.push(
            `${name} 的白色背景比例 ${whitePixelRatio} 低于阈值 ${SYMBOL_ICON_MIN_WHITE_PIXEL_RATIO}`,
          );
        }
      }
    }

    const status = checkErrors.length === 0 ? "passed" : "failed";
    checks.push({
      name,
      page,
      bounds,
      inspectedBounds,
      foregroundPixels,
      whitePixelRatio,
      status,
      errors: checkErrors,
    });
    errors.push(
      ...checkErrors.map((message) => `symbol-icons 第 ${page} 页：${message}`),
    );
  }

  return { checks, errors };
}

function readSymbolPageNames(xml, page, errors) {
  const prefix = `symbol-page:${page}/${SYMBOL_ICON_PAGE_COUNT}|`;
  const metadataNodes = findNodesByContentDescriptionPrefix(xml, prefix);
  if (metadataNodes.length !== 1) {
    errors.push(
      `symbol-icons 第 ${page} 页：页元数据节点数量应为 1，实际为 ${metadataNodes.length}`,
    );
  }
  if (metadataNodes.length === 0) {
    return [];
  }

  const contentDescription = readNodeAttribute(
    metadataNodes[0],
    "content-desc",
  );
  const names = contentDescription
    .slice(prefix.length)
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length !== SYMBOL_ICONS_PER_PAGE) {
    errors.push(
      `symbol-icons 第 ${page} 页：元数据应包含 ${SYMBOL_ICONS_PER_PAGE} 个名称，实际为 ${names.length}`,
    );
  }
  return names;
}

function validateCompleteSymbolIconMatrix(manifest) {
  const expectedTotal = SYMBOL_ICON_PAGE_COUNT * SYMBOL_ICONS_PER_PAGE;
  const pageCaptures = manifest.captures.filter((capture) =>
    capture.name.startsWith("symbol-icons-page-"),
  );
  if (pageCaptures.length !== SYMBOL_ICON_PAGE_COUNT) {
    manifest.validationErrors.push(
      `图标矩阵应有 ${SYMBOL_ICON_PAGE_COUNT} 页截图，实际为 ${pageCaptures.length}`,
    );
  }
  if (manifest.symbolIconChecks.length !== expectedTotal) {
    manifest.validationErrors.push(
      `图标矩阵应有 ${expectedTotal} 项检查，实际为 ${manifest.symbolIconChecks.length}`,
    );
  }

  const counts = new Map();
  for (const check of manifest.symbolIconChecks) {
    counts.set(check.name, (counts.get(check.name) ?? 0) + 1);
  }
  if (counts.size !== expectedTotal) {
    manifest.validationErrors.push(
      `图标矩阵应有 ${expectedTotal} 个唯一语义键，实际为 ${counts.size}`,
    );
  }
  for (const [name, count] of counts) {
    if (count !== 1) {
      manifest.validationErrors.push(`语义键 ${name} 出现 ${count} 次`);
    }
  }
}

function findNodesByContentDescription(xml, expectedValue) {
  return findNodesByContentDescriptionPrefix(xml, expectedValue).filter(
    (node) => readNodeAttribute(node, "content-desc") === expectedValue,
  );
}

function findNodesByContentDescriptionPrefix(xml, prefix) {
  const nodes = [];
  for (const match of xml.matchAll(/<node\b[^>]*>/g)) {
    const node = match[0];
    if (readNodeAttribute(node, "content-desc").startsWith(prefix)) {
      nodes.push(node);
    }
  }
  return nodes;
}

function readNodeAttribute(node, attributeName) {
  const escapedName = attributeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return node.match(new RegExp(`${escapedName}="([^"]*)"`))?.[1] ?? "";
}

function parseNodeBounds(node) {
  const match = readNodeAttribute(node, "bounds").match(
    /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/,
  );
  if (!match) return null;
  return {
    left: Number(match[1]),
    top: Number(match[2]),
    right: Number(match[3]),
    bottom: Number(match[4]),
  };
}

function areBoundsInsideImage(bounds, png) {
  return bounds.left >= 0
    && bounds.top >= 0
    && bounds.right > bounds.left
    && bounds.bottom > bounds.top
    && bounds.right <= png.width
    && bounds.bottom <= png.height;
}

function insetBounds(bounds, ratio) {
  const insetX = Math.max(2, Math.floor((bounds.right - bounds.left) * ratio));
  const insetY = Math.max(2, Math.floor((bounds.bottom - bounds.top) * ratio));
  return {
    left: bounds.left + insetX,
    top: bounds.top + insetY,
    right: bounds.right - insetX,
    bottom: bounds.bottom - insetY,
  };
}

function analyzePixels(png, bounds) {
  let foregroundPixels = 0;
  let whitePixels = 0;
  let totalPixels = 0;
  for (let y = bounds.top; y < bounds.bottom; y += 1) {
    for (let x = bounds.left; x < bounds.right; x += 1) {
      const offset = (png.width * y + x) * 4;
      const red = png.data[offset];
      const green = png.data[offset + 1];
      const blue = png.data[offset + 2];
      const alpha = png.data[offset + 3];
      const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      if (alpha >= 200 && luminance <= SYMBOL_ICON_MAX_FOREGROUND_LUMINANCE) {
        foregroundPixels += 1;
      }
      if (alpha >= 200 && red >= 240 && green >= 240 && blue >= 240) {
        whitePixels += 1;
      }
      totalPixels += 1;
    }
  }
  return {
    foregroundPixels,
    whitePixelRatio: Number((whitePixels / totalPixels).toFixed(4)),
  };
}

function formatBounds(bounds) {
  return `[${bounds.left},${bounds.top}][${bounds.right},${bounds.bottom}]`;
}

function writeManifest(manifest) {
  return writeFile(
    path.join(outputDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

function parseArgs(rawArgs) {
  const parsed = { help: false, only: null };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--only") {
      parsed.only = rawArgs[index + 1] ?? "";
      index += 1;
    } else if (arg.startsWith("--only=")) {
      parsed.only = arg.slice("--only=".length);
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }
  return parsed;
}

function printHelp() {
  console.log(`用法: npm run mobile:screenshots:android -- [选项]

选项:
  --only <names>  只截取指定页面，多个名称用逗号分隔
  -h, --help      显示帮助

常用环境变量:
  IMAGEMON_ANDROID_AVD                 指定 AVD 名称，默认优先使用 imagemon-avd
  ANDROID_SERIAL                       指定已连接设备或模拟器
  IMAGEMON_ANDROID_SCREENSHOT_DIR      指定截图输出目录
  IMAGEMON_EXPO_PORT                   指定 Expo/Metro 端口，默认 8081
  IMAGEMON_ANDROID_ROUTE_DELAY_MS      每个页面打开后的等待时间，默认 4500
  IMAGEMON_ANDROID_ROUTE_READY_TIMEOUT_MS 等待页面文本出现的超时时间，默认 180000
  IMAGEMON_ANDROID_KEEP_EMULATOR=1     脚本结束后保留由脚本启动的模拟器

可选页面:
${routes.map((route) => `  ${route.name}`).join("\n")}
`);
}

function selectRoutes(only) {
  if (!only) {
    return routes;
  }
  const names = only
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const routeByName = new Map(routes.map((route) => [route.name, route]));
  const missing = names.filter((name) => !routeByName.has(name));
  if (missing.length > 0) {
    throw new Error(`未知截图页面: ${missing.join(", ")}`);
  }
  return names.map((name) => routeByName.get(name));
}

async function resolveExpoPort(preferredPort) {
  if (process.env.IMAGEMON_EXPO_PORT) {
    if (await canConnect(preferredPort)) {
      throw new Error(
        `IMAGEMON_EXPO_PORT=${preferredPort} 已被占用，请指定空闲端口。`,
      );
    }
    return preferredPort;
  }

  let candidate = preferredPort;
  while (await canConnect(candidate)) {
    candidate += 1;
  }
  if (candidate !== preferredPort) {
    console.log(`端口 ${preferredPort} 已被占用，改用 ${candidate}。`);
  }
  return candidate;
}

async function ensureAndroidDevice() {
  const requestedDevice = process.env.ANDROID_SERIAL?.trim();
  if (requestedDevice) {
    await waitForBoot(requestedDevice, bootTimeoutMs);
    return requestedDevice;
  }

  const existingDevice = listReadyDevices()[0];
  if (existingDevice) {
    await waitForBoot(existingDevice, bootTimeoutMs);
    return existingDevice;
  }

  const avdName = resolveAvdName();
  console.log(`启动 Android 模拟器: ${avdName}`);
  emulatorProcess = spawn(
    emulator,
    [
      "-avd",
      avdName,
      "-no-window",
      "-no-boot-anim",
      "-no-snapshot-save",
      "-gpu",
      "swiftshader_indirect",
    ],
    {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  pipeChildOutput(emulatorProcess, path.join(outputDir, "emulator.log"));

  const bootedDevice = await waitForAnyDevice(bootTimeoutMs);
  await waitForBoot(bootedDevice, bootTimeoutMs);
  return bootedDevice;
}

function resolveAvdName() {
  const requestedAvd = process.env.IMAGEMON_ANDROID_AVD?.trim();
  const avds = listAvds();
  if (requestedAvd) {
    if (!avds.includes(requestedAvd)) {
      throw new Error(
        `找不到 AVD ${requestedAvd}。可用 AVD: ${avds.join(", ") || "无"}`,
      );
    }
    return requestedAvd;
  }
  if (avds.includes("imagemon-avd")) {
    return "imagemon-avd";
  }
  if (avds.length > 0) {
    return avds[0];
  }
  throw new Error("没有可用 Android AVD。请先创建模拟器。");
}

function listAvds() {
  const result = spawnSync(emulator, ["-list-avds"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || "读取 Android AVD 列表失败。");
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function listReadyDevices() {
  const result = spawnSync(adb, ["devices"], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || "读取 adb 设备列表失败。");
  }
  return result.stdout
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/))
    .filter(([, state]) => state === "device")
    .map(([serial]) => serial);
}

async function waitForAnyDevice(timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const device = listReadyDevices()[0];
    if (device) {
      return device;
    }
    await sleep(1_000);
  }
  throw new Error("等待 Android 设备连接超时。");
}

async function waitForBoot(device, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const completed = await adbText(device, [
      "shell",
      "getprop",
      "sys.boot_completed",
    ]).catch(() => "");
    if (completed.trim() === "1") {
      return;
    }
    await sleep(1_000);
  }
  throw new Error(`等待 Android 设备 ${device} 启动完成超时。`);
}

async function reverseMetroPort(device) {
  await adbText(device, ["reverse", `tcp:${port}`, `tcp:${port}`]);
}

async function dismissKeyguard(device) {
  await adbText(device, ["shell", "input", "keyevent", "KEYCODE_WAKEUP"]).catch(
    () => "",
  );
  await adbText(device, ["shell", "wm", "dismiss-keyguard"]).catch(() => "");
}

async function readDeviceInfo(device) {
  const [model, androidVersion, wmSize, wmDensity] = await Promise.all([
    adbText(device, ["shell", "getprop", "ro.product.model"]).catch(() => ""),
    adbText(device, ["shell", "getprop", "ro.build.version.release"]).catch(
      () => "",
    ),
    adbText(device, ["shell", "wm", "size"]).catch(() => ""),
    adbText(device, ["shell", "wm", "density"]).catch(() => ""),
  ]);
  return {
    model: model.trim(),
    androidVersion: androidVersion.trim(),
    wmSize: wmSize.trim(),
    wmDensity: wmDensity.trim(),
  };
}

function startMetro() {
  console.log("启动 Expo/Metro。");
  const child = spawn(
    "npx",
    [
      "expo",
      "start",
      "--localhost",
      "--port",
      String(port),
      "--android",
      "--go",
    ],
    {
      cwd: MOBILE_DIR,
      detached: true,
      env: {
        ...process.env,
        CI: "1",
        EXPO_NO_TELEMETRY: "1",
        EXPO_PUBLIC_IMAGEMON_SCREENSHOT_MODE: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  pipeChildOutput(child, path.join(outputDir, "metro.log"));
  return child;
}

function buildExpoUrl(routePath) {
  const normalizedPath = routePath.startsWith("/") ? routePath : `/${routePath}`;
  return `exp://127.0.0.1:${port}/--${normalizedPath}`;
}

async function openExpoUrl(device, url) {
  await adbText(device, [
    "shell",
    "am",
    "start",
    "-W",
    "-a",
    "android.intent.action.VIEW",
    "-d",
    url,
  ]);
}

async function forceStopExpoGo(device) {
  await adbText(device, ["shell", "am", "force-stop", "host.exp.exponent"]).catch(
    () => "",
  );
  await sleep(500);
}

async function waitForRouteReady(device, route, url) {
  const expectedTexts = route.expectText ?? [];
  if (expectedTexts.length === 0) {
    return;
  }

  const startedAt = Date.now();
  let latestXml = "";
  let launchRetries = 0;
  while (Date.now() - startedAt < routeReadyTimeoutMs) {
    latestXml = await dumpWindowHierarchy(device).catch(() => "");
    if (
      isAndroidLauncherVisible(latestXml)
      && launchRetries < MAX_EXPO_LAUNCH_RETRIES
    ) {
      launchRetries += 1;
      console.log(
        `页面 ${route.name} 停留在 Android Launcher，重新打开深链（${launchRetries}/${MAX_EXPO_LAUNCH_RETRIES}）。`,
      );
      await openExpoUrl(device, url);
      await sleep(1_000);
      continue;
    }
    if (
      expectedTexts.every((expectedText) => latestXml.includes(expectedText)) &&
      !latestXml.includes("Bundling")
    ) {
      await dismissExpoGoDeveloperMenuIfPresent(device, latestXml);
      return;
    }
    await sleep(1_000);
  }

  const debugFile = path.join(outputDir, `${route.name}.xml`);
  await writeFile(debugFile, latestXml);
  throw new Error(
    `页面 ${route.name} 未在 ${routeReadyTimeoutMs}ms 内出现预期文本：${expectedTexts.join(
      " / ",
    )}。已保存 UI 层级: ${path.relative(REPO_ROOT, debugFile)}`,
  );
}

async function waitForSymbolPageReady(device, page, captureName, url) {
  const expectedPrefix = `symbol-page:${page}/${SYMBOL_ICON_PAGE_COUNT}|`;
  const startedAt = Date.now();
  let latestXml = "";
  let launchRetries = 0;
  while (Date.now() - startedAt < routeReadyTimeoutMs) {
    latestXml = await dumpWindowHierarchy(device).catch(() => "");
    if (
      isAndroidLauncherVisible(latestXml)
      && launchRetries < MAX_EXPO_LAUNCH_RETRIES
    ) {
      launchRetries += 1;
      console.log(
        `页面 ${captureName} 停留在 Android Launcher，重新打开深链（${launchRetries}/${MAX_EXPO_LAUNCH_RETRIES}）。`,
      );
      await openExpoUrl(device, url);
      await sleep(1_000);
      continue;
    }
    if (latestXml.includes(expectedPrefix) && !latestXml.includes("Bundling")) {
      await dismissExpoGoDeveloperMenuIfPresent(device, latestXml);
      return;
    }
    await sleep(1_000);
  }

  const debugFile = path.join(outputDir, `${captureName}.xml`);
  await writeFile(debugFile, latestXml);
  throw new Error(
    `页面 ${captureName} 未在 ${routeReadyTimeoutMs}ms 内出现 ${expectedPrefix}。已保存 UI 层级: ${path.relative(
      REPO_ROOT,
      debugFile,
    )}`,
  );
}

function isAndroidLauncherVisible(xml) {
  return xml.includes('package="com.google.android.apps.nexuslauncher"');
}

async function dumpWindowHierarchy(device) {
  // 先删除上一轮残留文件，避免 dump 未成功覆盖时 cat 读到旧 XML 导致误判页面。
  await adbText(device, ["shell", "rm", "-f", "/sdcard/imagemon-window.xml"]);
  await adbText(device, [
    "shell",
    "uiautomator",
    "dump",
    "/sdcard/imagemon-window.xml",
  ]);
  return adbText(device, ["exec-out", "cat", "/sdcard/imagemon-window.xml"]);
}

async function dismissExpoGoDeveloperMenuIfPresent(device, initialXml) {
  if (!isExpoGoDeveloperMenuVisible(initialXml)) {
    return;
  }

  const bounds = findNodeBoundsForText(initialXml, "Continue");
  if (bounds) {
    await adbText(device, [
      "shell",
      "input",
      "tap",
      String(Math.round((bounds.left + bounds.right) / 2)),
      String(Math.round((bounds.top + bounds.bottom) / 2)),
    ]);
  } else {
    await adbText(device, ["shell", "input", "keyevent", "KEYCODE_BACK"]);
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    const xml = await dumpWindowHierarchy(device).catch(() => "");
    if (!isExpoGoDeveloperMenuVisible(xml)) {
      return;
    }
    await sleep(500);
  }
}

function isExpoGoDeveloperMenuVisible(xml) {
  return xml.includes("This is the developer menu") || xml.includes("SDK version:");
}

function findNodeBoundsForText(xml, text) {
  for (const match of xml.matchAll(/<node\b[^>]*>/g)) {
    const node = match[0];
    if (!node.includes(`text="${text}"`) && !node.includes(`content-desc="${text}"`)) {
      continue;
    }
    const boundsMatch = node.match(
      /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/,
    );
    if (!boundsMatch) {
      continue;
    }
    return {
      left: Number(boundsMatch[1]),
      top: Number(boundsMatch[2]),
      right: Number(boundsMatch[3]),
      bottom: Number(boundsMatch[4]),
    };
  }
  return null;
}

async function captureScreenshot(device, file) {
  const buffer = await adbBuffer(device, ["exec-out", "screencap", "-p"]);
  await writeFile(file, buffer);
  return buffer;
}

function runChecked(command, commandArgs, options) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} 执行失败。`);
  }
}

function pipeChildOutput(child, logFile) {
  const log = createWriteStream(logFile, { flags: "a" });
  child.stdout?.pipe(log, { end: false });
  child.stderr?.pipe(log, { end: false });
  child.on("exit", (code, signal) => {
    log.write(`\n[exit] code=${code ?? ""} signal=${signal ?? ""}\n`);
    log.end();
  });
}

function adbText(device, adbArgs) {
  return execFileText(adb, ["-s", device, ...adbArgs]);
}

function adbBuffer(device, adbArgs) {
  return execFileBuffer(adb, ["-s", device, ...adbArgs]);
}

function execFileText(command, commandArgs, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      commandArgs,
      {
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
        timeout: timeoutMs,
        killSignal: "SIGKILL",
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function execFileBuffer(command, commandArgs, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      commandArgs,
      {
        encoding: "buffer",
        maxBuffer: 32 * 1024 * 1024,
        timeout: timeoutMs,
        killSignal: "SIGKILL",
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(bufferToString(stderr) || error.message));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

async function waitForMetroReady(child, targetPort, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Expo/Metro 已提前退出，请查看 ${path.relative(
          REPO_ROOT,
          path.join(outputDir, "metro.log"),
        )}`,
      );
    }
    if (await canConnect(targetPort)) {
      return;
    }
    await sleep(500);
  }
  throw new Error(`等待 Expo/Metro 端口 ${targetPort} 超时。`);
}

function canConnect(targetPort) {
  return new Promise((resolve) => {
    const socket = net.createConnection(
      { host: "127.0.0.1", port: targetPort },
      () => {
        socket.destroy();
        resolve(true);
      },
    );
    socket.setTimeout(500);
    socket.on("error", () => resolve(false));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

let cleanupPromise = null;

function cleanup() {
  // cleanup 会被 SIGINT/SIGTERM 处理器、错误分支和正常收尾多路调用，
  // 用共享 Promise 保证只执行一次，避免并发调用交叠操作同一子进程引用。
  if (!cleanupPromise) {
    cleanupPromise = runCleanup();
  }
  return cleanupPromise;
}

async function runCleanup() {
  if (metroProcess) {
    await terminateChildProcess(metroProcess);
    metroProcess = null;
  }
  if (
    emulatorProcess &&
    process.env.IMAGEMON_ANDROID_KEEP_EMULATOR !== "1"
  ) {
    await terminateChildProcess(emulatorProcess);
    emulatorProcess = null;
  }
}

async function terminateChildProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  sendSignalToChildGroup(child, "SIGTERM");
  const closed = await waitForChildClose(child, 5_000);
  if (!closed) {
    sendSignalToChildGroup(child, "SIGKILL");
    await waitForChildClose(child, 5_000);
  }
}

async function waitForChildClose(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return true;
  }
  return Promise.race([
    once(child, "close").then(() => true),
    sleep(timeoutMs).then(() => false),
  ]);
}

function sendSignalToChildGroup(child, signal) {
  if (!child.pid) {
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

function readIntegerEnv(name, fallback) {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} 必须是正整数。`);
  }
  return parsed;
}

function createTimestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function bufferToString(value) {
  return Buffer.isBuffer(value) ? value.toString("utf8") : String(value || "");
}
