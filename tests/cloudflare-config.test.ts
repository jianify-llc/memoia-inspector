import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Cloudflare configuration", () => {
  it("has no upstream deployment resources and keeps public preview disabled", () => {
    const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
    expect(JSON.stringify(config)).not.toMatch(/memobase\.io|memobase-inspector|tail-worker|NEXT_INC_CACHE|WORKER_SELF_REFERENCE/);
    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(false);
    expect(config.env.test.workers_dev).toBe(false);
    expect(config.env.test.preview_urls).toBe(false);
    expect(config.env.test.services).toEqual([{ binding: "MEMOIA", service: "luvel-memoia-test" }]);
  });
});
