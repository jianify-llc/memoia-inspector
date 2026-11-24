/** Signed, page-owned continuation receipts. Live access is checked by the route on every call. */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { ResponseInput, ResponseOutputItem } from "openai/resources/responses/responses";
import { messageFingerprint } from "./playground-reference";

type ChainReceipt = { projectId: string; userId: string; sessionId: string; responseId: string; contextHash: string; count: number; hash: string };
const signature = (value: string, secret: string) => createHmac("sha256", secret).update("playground-chain:v1:" + value).digest();

/** Provider output IDs/reasoning stay on the native chain; compare only the visible protocol. */
export function chainInput(input: ResponseInput | ResponseOutputItem[]): ResponseInput {
  const result: ResponseInput = [];
  for (const item of input) {
    if (item.type === "reasoning") continue;
    if (item.type === "function_call") {
      result.push({ type: "function_call", call_id: item.call_id, name: item.name, arguments: JSON.stringify(JSON.parse(item.arguments)) });
    } else if (item.type === "function_call_output") {
      result.push({ type: "function_call_output", call_id: item.call_id, output: item.output });
    } else if ("role" in item && "content" in item) {
      const content = item.content;
      // Assistant recording time is assigned by the UI after streaming, not evidence in the provider response.
      if (item.role === "developer" && typeof content !== "string" && content.some(p => "text" in p && p.text.startsWith('<message_metadata ') && p.text.includes('"role":"assistant"'))) continue;
      if (item.role === "assistant") {
        const text = typeof content === "string" ? content : content.map(p => "text" in p ? p.text : "").join("");
        if (!text) continue;
        const last = result.at(-1);
        if (last && "role" in last && "content" in last && last.role === "assistant" && typeof last.content === "string") last.content += text;
        else result.push({ role: "assistant", content: text });
      } else result.push(item as ResponseInput[number]);
    }
  }
  return result;
}

export function readChain(token: unknown, secret: string, scope: { projectId: string; userId: string; sessionId: string }): ChainReceipt | null {
  if (token === undefined || token === null) return null;
  if (typeof token !== "string" || token.length > 4096 || !secret) throw new Error("Invalid chain receipt");
  const parts = token.split(".");
  if (parts.length !== 2) throw new Error("Invalid chain receipt");
  const actual = Buffer.from(parts[1], "base64url"), expected = signature(parts[0], secret);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Invalid chain receipt");
  const value = JSON.parse(Buffer.from(parts[0], "base64url").toString()) as ChainReceipt;
  if (value.projectId !== scope.projectId || value.userId !== scope.userId || value.sessionId !== scope.sessionId ||
    typeof value.responseId !== "string" || !value.responseId || !Number.isSafeInteger(value.count) || value.count < 1 ||
    !/^[a-f0-9]{64}$/.test(value.hash) || !/^[a-f0-9]{64}$/.test(value.contextHash)) throw new Error("Invalid chain receipt");
  return value;
}

export function prepareChain(full: ResponseInput, receipt: ChainReceipt | null, contextHash: string) {
  if (receipt && receipt.contextHash === contextHash && full.length > receipt.count &&
    messageFingerprint(full.slice(0, receipt.count)) === receipt.hash) {
    return { input: full.slice(receipt.count), previous_response_id: receipt.responseId };
  }
  return { input: full, previous_response_id: undefined };
}

export function signChain(scope: { projectId: string; userId: string; sessionId: string }, responseId: string, contextHash: string, full: ResponseInput, output: ResponseOutputItem[], secret: string) {
  const acknowledged = chainInput([...full, ...chainInput(output)]);
  const value: ChainReceipt = { ...scope, responseId, contextHash, count: acknowledged.length, hash: messageFingerprint(acknowledged) };
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return payload + "." + signature(payload, secret).toString("base64url");
}
