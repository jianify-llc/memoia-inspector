import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type TurnReference = {
  projectId: string; userId: string; messageId: string; fingerprint: string;
  recordedAt: string; profiles: string; memories: string;
};
export const messageFingerprint = (content: unknown) => createHash("sha256").update(JSON.stringify(content)).digest("hex");
const signature = (payload: string, secret: string) => createHmac("sha256", secret)
  .update("memoia-inspector:playground-reference:v1:" + payload).digest();

/** A reference is not authority: callers must recheck the live project and user. */
export function signReference(reference: TurnReference, secret: string) {
  const payload = Buffer.from(JSON.stringify(reference)).toString("base64url");
  if (payload.length > 131072 || !secret) throw new Error("Reference exceeds budget");
  return payload + "." + signature(payload, secret).toString("base64url");
}

export function verifyReferences(tokens: unknown, secret: string, projectId: string, userId: string) {
  if (tokens === undefined) return new Map<string, TurnReference>();
  if (!Array.isArray(tokens) || tokens.length > 500 || JSON.stringify(tokens).length > 2097152) throw new Error("Invalid references");
  const references = new Map<string, TurnReference>();
  for (const token of tokens) {
    if (typeof token !== "string" || token.length > 131200 || !secret) throw new Error("Invalid reference");
    const parts = token.split(".");
    if (parts.length !== 2) throw new Error("Invalid reference");
    const actual = Buffer.from(parts[1], "base64url"), expected = signature(parts[0], secret);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Invalid reference");
    const data = JSON.parse(Buffer.from(parts[0], "base64url").toString()) as TurnReference;
    if (data.projectId !== projectId || data.userId !== userId ||
      typeof data.messageId !== "string" || !data.messageId || data.messageId.length > 255 ||
      typeof data.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(data.fingerprint) ||
      typeof data.recordedAt !== "string" || !Number.isFinite(Date.parse(data.recordedAt)) ||
      typeof data.profiles !== "string" || typeof data.memories !== "string") throw new Error("Invalid reference");
    const previous = references.get(data.messageId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(data)) throw new Error("Conflicting reference");
    references.set(data.messageId, data);
  }
  return references;
}
