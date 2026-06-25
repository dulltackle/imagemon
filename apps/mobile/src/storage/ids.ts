export type IdGenerator = () => string;

export function createRandomId(): string {
  const crypto = globalThis.crypto;
  if (typeof crypto?.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
