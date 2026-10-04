import { MemoiaClient, MemoiaError } from "@jianify/memoia";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const id = "11111111-1111-4111-8111-111111111111";
const source = {
  source_id: "dialog-1", legacy: false, message_ids: ["1"], deleted_message_ids: [],
  created_at: "2026-01-01T00:00:00Z", blobs: [],
  evidence: [{ fact_id: id, blob_id: id, content: "Likes chess", topic: "interest", sub_topic: "hobby",
    support_groups: [["1"]], event_time: null,
    source_messages: [{ message_id: "1", recorded_at: "2026-01-01T00:00:00Z", time_zone: null }] }],
};

describe("actual frozen SDK and current source evidence contract", () => {
  it("accepts event time and nullable source timezone without dropping provenance", async () => {
    const client = new MemoiaClient({ baseUrl: "https://fixture.invalid", apiKey: "fixture-only",
      fetch: async () => Response.json(source) });
    expect(await client.getSource(id, source.source_id)).toEqual(source);
  });

  it("still rejects malformed evidence instead of relaxing the SDK schema", async () => {
    const malformed = structuredClone(source);
    malformed.evidence[0].source_messages[0].recorded_at = "not-a-time";
    const client = new MemoiaClient({ baseUrl: "https://fixture.invalid", apiKey: "fixture-only",
      fetch: async () => Response.json(malformed) });
    await expect(client.getSource(id, source.source_id)).rejects.toBeInstanceOf(MemoiaError);
  });

  it("copies the dependency artifact into the Docker deps stage before frozen installation", () => {
    const dockerfile = readFileSync(resolve(__dirname, "../Dockerfile"), "utf8");
    const copy = dockerfile.indexOf("COPY vendor/ ./vendor/");
    expect(copy).toBeGreaterThan(0);
    expect(dockerfile.indexOf("RUN pnpm install --frozen-lockfile")).toBeGreaterThan(copy);
  });
});
