import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";

const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_ALLOWED_CONTENT_TYPES = Object.freeze(["image/png", "image/jpeg", "image/webp"]);
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type ImageDownloadLookup = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<Array<{ address: string; family: number }>>;

export interface ImageDownloadOptions {
  /** Trusted transport override. Requires allowPrivateNetwork: true. */
  fetch?: typeof fetch;
  /** DNS resolver injection for testing. Resolved addresses are always validated. */
  lookup?: ImageDownloadLookup;
  timeoutMs?: number;
  maxBytes?: number;
  allowPrivateNetwork?: boolean;
  allowHttp?: boolean;
  allowedContentTypes?: string[];
}

export async function downloadImage(url: string, options: ImageDownloadOptions = {}): Promise<Buffer> {
  const timeoutMs = positiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "download timeoutMs");
  const maxBytes = positiveInteger(options.maxBytes ?? DEFAULT_MAX_BYTES, "download maxBytes");
  const allowedContentTypes = normalizeAllowedContentTypes(options.allowedContentTypes);
  if (options.fetch && !options.allowPrivateNetwork) {
    throw new Error("Custom image download fetch requires allowPrivateNetwork: true");
  }
  const controller = new AbortController();
  const timeoutError = new Error(`Image download timed out after ${timeoutMs}ms`);
  let rejectTimeout: (reason: Error) => void = () => undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    rejectTimeout = reject;
  });

  const timeout = setTimeout(() => {
    controller.abort();
    rejectTimeout(timeoutError);
  }, timeoutMs);

  try {
    let currentUrl = parseDownloadUrl(url);

    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const target = options.fetch
        ? validateDownloadUrl(currentUrl, options)
        : await withTimeout(resolveDownloadTarget(currentUrl, options), timeoutPromise);

      let response: Response;
      try {
        response = await withTimeout(
          options.fetch
            ? options.fetch(currentUrl, {
                redirect: "manual",
                signal: controller.signal,
              })
            : requestImage(currentUrl, target as ResolvedTarget, controller.signal),
          timeoutPromise,
        );
      } catch (error) {
        if (error === timeoutError || isAbortError(error)) {
          throw timeoutError;
        }
        throw new Error(`Image download request failed for ${safeUrl(currentUrl)}`);
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        await withTimeout(cancelResponseBody(response), timeoutPromise);
        if (redirectCount === MAX_REDIRECTS) {
          throw new Error(`Image download exceeded ${MAX_REDIRECTS} redirects`);
        }
        const location = response.headers.get("location");
        if (!location) {
          throw new Error(`Image download redirect from ${safeUrl(currentUrl)} is missing Location`);
        }
        currentUrl = parseDownloadUrl(new URL(location, currentUrl).toString());
        continue;
      }

      if (!response.ok) {
        await withTimeout(cancelResponseBody(response), timeoutPromise);
        throw new Error(`Image download failed for ${safeUrl(currentUrl)} with status ${response.status}`);
      }

      try {
        validateContentType(response, allowedContentTypes);
        validateContentLength(response, maxBytes);
      } catch (error) {
        await withTimeout(cancelResponseBody(response), timeoutPromise);
        throw error;
      }
      return await withTimeout(readLimitedBody(response, maxBytes, controller), timeoutPromise);
    }

    throw new Error(`Image download exceeded ${MAX_REDIRECTS} redirects`);
  } finally {
    clearTimeout(timeout);
  }
}

function parseDownloadUrl(value: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error("Image download URL is invalid");
  }
}

interface ResolvedTarget {
  address: string;
  family: number;
}

async function resolveDownloadTarget(url: URL, options: ImageDownloadOptions): Promise<ResolvedTarget> {
  validateDownloadUrl(url, options);

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!options.allowPrivateNetwork && (hostname === "localhost" || hostname.endsWith(".localhost"))) {
    throw new Error(`Image download target is not allowed: ${hostname}`);
  }

  const family = isIP(hostname);
  if (family) {
    if (!options.allowPrivateNetwork && isPrivateAddress(hostname)) {
      throw new Error(`Image download target is not allowed: ${hostname}`);
    }
    return { address: hostname, family };
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = options.lookup
      ? await options.lookup(hostname, { all: true, verbatim: true })
      : await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error(`Image download host could not be resolved: ${hostname}`);
  }

  if (
    addresses.length === 0 ||
    addresses.some(({ address, family: addressFamily }) => {
      return (addressFamily !== 4 && addressFamily !== 6) || isIP(address) !== addressFamily;
    }) ||
    (!options.allowPrivateNetwork && addresses.some(({ address }) => isPrivateAddress(address)))
  ) {
    throw new Error(`Image download target is not allowed: ${hostname}`);
  }

  return addresses[0];
}

function validateDownloadUrl(url: URL, options: ImageDownloadOptions): undefined {
  if (url.protocol !== "https:" && !(options.allowHttp && url.protocol === "http:")) {
    throw new Error(`Image download protocol is not allowed: ${url.protocol}`);
  }

  if (url.username || url.password) {
    throw new Error("Image download URL credentials are not allowed");
  }
}

async function requestImage(url: URL, target: ResolvedTarget, signal: AbortSignal): Promise<Response> {
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;

  return await new Promise<Response>((resolve, reject) => {
    const outgoing = request(
      url,
      {
        signal,
        lookup: ((_hostname: string, lookupOptions: { all?: boolean }, callback: (...args: unknown[]) => void) => {
          if (lookupOptions.all) {
            callback(null, [target]);
            return;
          }
          callback(null, target.address, target.family);
        }) as never,
      },
      (incoming) => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) {
            for (const item of value) {
              headers.append(name, item);
            }
          } else if (value !== undefined) {
            headers.set(name, value);
          }
        }

        resolve(
          new Response(Readable.toWeb(incoming) as ReadableStream<Uint8Array>, {
            status: incoming.statusCode,
            statusText: incoming.statusMessage,
            headers,
          }),
        );
      },
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
}

function isPrivateAddress(address: string): boolean {
  if (address.includes(":")) {
    return isPrivateIpv6(address);
  }

  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return true;
  }

  const [first, second, third] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0];
  if (normalized === "::" || normalized === "::1") {
    return true;
  }

  const mappedIpv4 = ipv4FromMappedIpv6(normalized);
  if (mappedIpv4) {
    return isPrivateAddress(mappedIpv4);
  }

  const firstGroup = Number.parseInt(normalized.split(":")[0] || "0", 16);
  return firstGroup < 0x2000 || firstGroup > 0x3fff;
}

function ipv4FromMappedIpv6(address: string): string | undefined {
  if (!address.startsWith("::ffff:")) {
    return undefined;
  }

  const suffix = address.slice("::ffff:".length);
  if (isIP(suffix) === 4) {
    return suffix;
  }

  const groups = suffix.split(":");
  if (groups.length !== 2 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) {
    return undefined;
  }

  const high = Number.parseInt(groups[0], 16);
  const low = Number.parseInt(groups[1], 16);
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

function normalizeAllowedContentTypes(value: string[] | undefined): Set<string> {
  const contentTypes = value ?? [...DEFAULT_ALLOWED_CONTENT_TYPES];
  const normalized = new Set(contentTypes.map((contentType) => contentType.trim().toLowerCase()).filter(Boolean));
  if (normalized.size === 0) {
    throw new Error("download allowedContentTypes cannot be empty");
  }
  return normalized;
}

function validateContentType(response: Response, allowedContentTypes: Set<string>): void {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (!contentType || !allowedContentTypes.has(contentType)) {
    throw new Error(`Image download Content-Type is not allowed: ${contentType ?? "missing"}`);
  }
}

function validateContentLength(response: Response, maxBytes: number): void {
  const rawContentLength = response.headers.get("content-length");
  if (!rawContentLength) {
    return;
  }

  const contentLength = Number(rawContentLength);
  if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
    throw new Error("Image download Content-Length is invalid");
  }
  if (contentLength > maxBytes) {
    throw new Error(`Image download exceeds maximum size of ${maxBytes} bytes`);
  }
}

async function readLimitedBody(response: Response, maxBytes: number, controller: AbortController): Promise<Buffer> {
  if (!response.body) {
    throw new Error("Image download response body is missing");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return Buffer.concat(chunks, totalBytes);
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        controller.abort();
        throw new Error(`Image download exceeds maximum size of ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // 仅用于释放失败响应资源，不覆盖原始下载错误。
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function safeUrl(url: URL): string {
  return url.origin;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function withTimeout<T>(operation: Promise<T>, timeoutPromise: Promise<never>): Promise<T> {
  return await Promise.race([operation, timeoutPromise]);
}
