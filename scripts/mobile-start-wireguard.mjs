#!/usr/bin/env node

import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const IOS_BUNDLE_WARMUP_TIMEOUT_MS = 90_000;
const IOS_BUNDLE_WARMUP_RETRY_DELAY_MS = 1_000;

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mobileRoot = join(repositoryRoot, "apps", "mobile");
const explicitHost = process.env.EXPO_WIREGUARD_HOST?.trim();
const wireguardHost = explicitHost || findWireGuardIpv4Address();

if (!wireguardHost) {
  console.error(
    "未找到 WireGuard IPv4 地址。请确认 wg0 已连接，或设置 EXPO_WIREGUARD_HOST=10.x.x.x 后重试。",
  );
  process.exit(1);
}

const expoArgs = ["expo", "start", "--go", ...process.argv.slice(2)];
const command = process.platform === "win32" ? "npx.cmd" : "npx";
const shouldWarmUpIosBundle = !hasHelpFlag(process.argv.slice(2));
const metroPort = parseMetroPort(process.argv.slice(2));

console.log(`使用 WireGuard 地址 ${wireguardHost} 启动 Expo Go。`);
if (shouldWarmUpIosBundle) {
  console.log("启动后会自动预热 iOS bundle；请等看到“iOS bundle 预热完成”后再扫码。");
}

const child = spawn(command, expoArgs, {
  cwd: mobileRoot,
  env: {
    ...process.env,
    REACT_NATIVE_PACKAGER_HOSTNAME: wireguardHost,
  },
  stdio: "inherit",
});

if (shouldWarmUpIosBundle) {
  void warmUpIosBundleAsync({ host: wireguardHost, port: metroPort })
    .then(() => {
      console.log("iOS bundle 预热完成，现在可以扫码。");
    })
    .catch((error) => {
      console.error(`iOS bundle 预热失败：${error instanceof Error ? error.message : String(error)}`);
    });
}

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    child.kill(signal);
  });
}

async function warmUpIosBundleAsync({ host, port }) {
  const manifest = await retryAsync(async () => {
    const response = await fetch(`http://${host}:${port}`, {
      headers: {
        accept: "application/expo+json,application/json",
        "expo-platform": "ios",
        "expo-protocol-version": "1",
      },
    });
    if (!response.ok) {
      throw new Error(`manifest 返回 HTTP ${response.status}`);
    }
    return response.json();
  }, "manifest");

  const bundleUrl = manifest?.launchAsset?.url;
  if (typeof bundleUrl !== "string" || bundleUrl.length === 0) {
    throw new Error("manifest 中没有 launchAsset.url。");
  }

  await retryAsync(async () => {
    const response = await fetch(bundleUrl);
    if (!response.ok) {
      throw new Error(`bundle 返回 HTTP ${response.status}`);
    }
    await response.arrayBuffer();
  }, "bundle");
}

async function retryAsync(task, label) {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < IOS_BUNDLE_WARMUP_TIMEOUT_MS) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      await delay(IOS_BUNDLE_WARMUP_RETRY_DELAY_MS);
    }
  }

  throw new Error(`${label} 预热超时：${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function delay(ms) {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

function hasHelpFlag(args) {
  return args.includes("--help") || args.includes("-h");
}

function parseMetroPort(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--port" || arg === "-p") {
      return String(args[index + 1] || process.env.RCT_METRO_PORT || 8081);
    }
    if (arg.startsWith("--port=")) {
      return arg.slice("--port=".length);
    }
    if (/^-p\d+$/.test(arg)) {
      return arg.slice(2);
    }
  }

  return String(process.env.RCT_METRO_PORT || 8081);
}

function findWireGuardIpv4Address() {
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    if (!isWireGuardInterfaceName(name)) {
      continue;
    }

    const address = addresses?.find((entry) => isIpv4Address(entry) && !entry.internal && entry.address);
    if (address) {
      return address.address;
    }
  }

  return undefined;
}

function isWireGuardInterfaceName(name) {
  const normalized = name.toLowerCase();
  return normalized === "wg0" || normalized.startsWith("wg") || normalized.includes("wireguard");
}

function isIpv4Address(address) {
  return address.family === "IPv4" || address.family === 4;
}
