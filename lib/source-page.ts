import type { Source } from "@jianify/memoia";

export type SourceCollection = "messages" | "blobs" | "evidence";

/** Each collection advances independently; fetching evidence cannot exhaust messages. */
export function appendSourcePage(current: Source, page: Source, collection: SourceCollection): Source {
  if (current.source_id !== page.source_id) throw new Error("Source identity mismatch");
  if (collection === "messages") {
    return { ...current,
      message_ids: [...new Set([...current.message_ids, ...page.message_ids])],
      deleted_message_ids: [...new Set([...current.deleted_message_ids, ...page.deleted_message_ids])],
      next_message_offset: page.next_message_offset };
  }
  if (collection === "blobs") {
    return { ...current,
      blobs: [...new Map([...current.blobs, ...page.blobs].map((blob) => [blob.blob_id, blob])).values()],
      next_blob_offset: page.next_blob_offset };
  }
  return { ...current,
    evidence: [...new Map([...current.evidence, ...page.evidence].map((fact) => [fact.fact_id, fact])).values()],
    next_evidence_offset: page.next_evidence_offset };
}
