#!/usr/bin/env node
import { execFile, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const MOBILE_DIR = path.join(REPO_ROOT, "apps", "mobile");
const DEFAULT_PORT = 8081;
const DEFAULT_BOOT_TIMEOUT_MS = 180_000;
const DEFAULT_ROUTE_DELAY_MS = 4_500;
const DEFAULT_INITIAL_LOAD_DELAY_MS = 12_000;
const DEFAULT_ROUTE_READY_TIMEOUT_MS = 180_000;

const routes = [
  { name: "catalog", path: "/", expectText: ["模板提炼", "已生成图鉴条目"] },
  {
    name: "template-refinement",
    path: "/promptdex/refine",
    expectText: ["外部完整提示词", "生成提炼方案"],
  },
  {
    name: "promptdex-built-in-detail",
    path: "/promptdex/light-infographic",
    expectText: ["light-infographic", "生成图片"],
  },
  {
    name: "promptdex-personal-detail",
    path: "/promptdex/screenshot-personal-poster",
    expectText: ["screenshot-personal-poster", "生成图片"],
  },
  { name: "history-list", path: "/history", expectText: ["light-infographic", "完成"] },
  {
    name: "history-detail-completed",
    path: "/history/screenshot-history-completed",
    expectText: ["图鉴条目", "完整提示词"],
  },
  {
    name: "image-detail",
    path: "/images/screenshot-result-light",
    expectText: ["图片文件不可用", "基础规格"],
  },
  { name: "settings", path: "/settings", expectText: ["模型配置"] },
  {
    name: "model-configurations",
    path: "/model-configurations",
    expectText: ["图片模型", "文本模型"],
  },
  {
    name: "model-configuration-new-image",
    path: "/model-configurations/new?type=image",
    expectText: ["Base URL", "保存配置"],
  },
  {
    name: "model-configuration-new-text",
    path: "/model-configurations/new?type=text",
    expectText: ["Base URL", "保存配置"],
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

  const captures = [];
  for (const route of selectedRoutes) {
    const url = buildExpoUrl(route.path);
    console.log(`打开 ${route.name}: ${url}`);
    await forceStopExpoGo(device);
    await openExpoUrl(device, url);
    await waitForRouteReady(device, route);
    await sleep(routeDelayMs);
    const file = path.join(outputDir, `${route.name}.png`);
    await captureScreenshot(device, file);
    captures.push({
      name: route.name,
      path: route.path,
      url,
      file: path.relative(REPO_ROOT, file),
    });
    console.log(`已截图: ${path.relative(REPO_ROOT, file)}`);
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    mode: "android-emulator",
    screenshotRuntime: "EXPO_PUBLIC_IMAGEMON_SCREENSHOT_MODE=1",
    device,
    deviceInfo,
    port,
    captures,
  };
  await writeFile(
    path.join(outputDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  await cleanup();
  console.log(`完成，共生成 ${captures.length} 张截图。`);
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

async function waitForRouteReady(device, route) {
  const expectedTexts = route.expectText ?? [];
  if (expectedTexts.length === 0) {
    return;
  }

  const startedAt = Date.now();
  let latestXml = "";
  while (Date.now() - startedAt < routeReadyTimeoutMs) {
    latestXml = await dumpWindowHierarchy(device).catch(() => "");
    if (
      expectedTexts.some((expectedText) => latestXml.includes(expectedText)) &&
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
