import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const script = resolve(__dirname, "../scripts/check-memoia-sdk.mjs");
const root = resolve(__dirname, "..");

describe("frozen SDK artifact identity check", () => {
  it("accepts the installed package only when it matches the vendored artifact", () => {
    const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/SDK 0\.9\.1: OpenAPI sha256 [a-f0-9]{64}/);
  });

  it("rejects a dependency pointing outside the reviewed fixed SDK artifact", () => {
    const fixture = mkdtempSync(resolve(tmpdir(), "inspector-sdk-check-"));
    try {
      mkdirSync(resolve(fixture, "scripts"));
      copyFileSync(script, resolve(fixture, "scripts/check-memoia-sdk.mjs"));
      writeFileSync(resolve(fixture, "package.json"), JSON.stringify({ dependencies: { "@jianify/memoia": "file:unreviewed.tgz" } }));
      const result = spawnSync(process.execPath, [resolve(fixture, "scripts/check-memoia-sdk.mjs")], { encoding: "utf8" });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("reviewed fixed SDK tarball");
    } finally { rmSync(fixture, { recursive: true }); }
  });

  it("rejects a tarball whose protocol manifest/version does not identify the reviewed SDK", () => {
    const fixture = mkdtempSync(resolve(tmpdir(), "inspector-sdk-manifest-"));
    try {
      mkdirSync(resolve(fixture, "scripts"));
      mkdirSync(resolve(fixture, "vendor"));
      mkdirSync(resolve(fixture, "payload/package/src/generated"), { recursive: true });
      copyFileSync(script, resolve(fixture, "scripts/check-memoia-sdk.mjs"));
      writeFileSync(resolve(fixture, "package.json"), JSON.stringify({ dependencies: { "@jianify/memoia": "file:vendor/jianify-memoia-0.9.1.tgz" } }));
      writeFileSync(resolve(fixture, "payload/package/package.json"), JSON.stringify({ name: "@jianify/memoia", version: "0.1.0" }));
      writeFileSync(resolve(fixture, "payload/package/src/generated/manifest.json"), JSON.stringify({ sdkVersion: "0.9.1", openapiSha256: "a".repeat(64) }));
      execFileSync("tar", ["-czf", resolve(fixture, "vendor/jianify-memoia-0.9.1.tgz"), "-C", resolve(fixture, "payload"), "package"]);
      const result = spawnSync(process.execPath, [resolve(fixture, "scripts/check-memoia-sdk.mjs")], { encoding: "utf8" });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Unreviewed or missing SDK protocol/version identity");
    } finally { rmSync(fixture, { recursive: true }); }
  });
});
