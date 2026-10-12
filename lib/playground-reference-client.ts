/** Current component lifetime only. No localStorage, sessionStorage or server session. */
export async function retainReference(response: Response, references: Map<string, string>) {
  const reader = response.clone().body?.getReader();
  if (!reader) return;
  let text = "";
  const decoder = new TextDecoder();
  try {
    while (!text.includes("\n")) {
      const chunk = await reader.read();
      if (chunk.done) return;
      text += decoder.decode(chunk.value, { stream: true });
      if (text.length > 262144) throw new Error("Invalid reference stream");
    }
    const line = text.slice(0, text.indexOf("\n"));
    if (!line.startsWith("8:")) return;
    const annotation = JSON.parse(line.slice(2))[0];
    if (typeof annotation?.memoia_reference !== "string" || typeof annotation?.message_id !== "string") return;
    // First delivery wins: retry/cancellation must preserve the already used prefix.
    if (!references.has(annotation.message_id)) references.set(annotation.message_id, annotation.memoia_reference);
  } finally {
    // Awaiting a tee cancellation here would deadlock before the UI reads its branch.
    void reader.cancel().catch(() => {});
  }
}
