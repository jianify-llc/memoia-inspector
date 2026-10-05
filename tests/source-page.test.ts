import type { Source } from "@jianify/memoia";
import { describe, expect, it } from "vitest";
import { appendSourcePage } from "@/lib/source-page";

const source: Source = {
  source_id: "dialog-1", legacy: false, created_at: "2026-01-01T00:00:00Z",
  message_ids: ["1", "2"], deleted_message_ids: ["1"], blobs: [], evidence: [],
  next_message_offset: 2, next_blob_offset: 20, next_evidence_offset: 20,
};

describe("independent source collection paging", () => {
  it("appends message IDs and their deleted subset without exhausting other collections", () => {
    const page = { ...source, message_ids: ["2", "3"], deleted_message_ids: ["3"],
      next_message_offset: null, next_blob_offset: null, next_evidence_offset: null };
    const result = appendSourcePage(source, page, "messages");
    expect(result.message_ids).toEqual(["1", "2", "3"]);
    expect(result.deleted_message_ids).toEqual(["1", "3"]);
    expect(result.next_message_offset).toBeNull();
    expect(result.next_blob_offset).toBe(20);
    expect(result.next_evidence_offset).toBe(20);
  });

  it("does not append repeated messages when fetching batches or evidence", () => {
    for (const collection of ["blobs", "evidence"] as const) {
      const result = appendSourcePage(source, { ...source, message_ids: ["unrelated"],
        next_blob_offset: null, next_evidence_offset: null }, collection);
      expect(result.message_ids).toEqual(source.message_ids);
      expect(result.next_message_offset).toBe(2);
      expect(collection === "blobs" ? result.next_evidence_offset : result.next_blob_offset).toBe(20);
    }
  });

  it("rejects a response belonging to another source", () => {
    expect(() => appendSourcePage(source, { ...source, source_id: "another" }, "messages")).toThrow("identity");
  });
});
