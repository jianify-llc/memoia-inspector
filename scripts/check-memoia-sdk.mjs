import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const root = resolve(import.meta.dirname, "..");
const inspector = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const dependency = inspector.dependencies["@jianify/memoia"];
if (dependency !== "file:vendor/jianify-memoia-0.4.1.tgz") throw new Error("Inspector requires the reviewed fixed v2 SDK tarball");
const tarball = resolve(root, dependency.slice(5));
const packed = (path) => execFileSync("tar", ["-xOf", tarball, `package/${path}`], { encoding: "utf8" });
const packageInfo = JSON.parse(packed("package.json"));
const manifest = JSON.parse(packed("src/generated/manifest.json"));
if (packageInfo.name !== "@jianify/memoia" || packageInfo.version !== "0.4.1" || manifest.sdkVersion !== "0.4.1" || !/^[a-f0-9]{64}$/.test(manifest.openapiSha256)) {
  throw new Error("Unreviewed or missing SDK protocol/version identity");
}
const sdkRoot = resolve(dirname(fileURLToPath(import.meta.resolve("@jianify/memoia"))), "..");
for (const path of ["package.json", "dist/client.js", "dist/generated/validators.js", "src/generated/manifest.json", "THIRD_PARTY_NOTICES"]) {
  if (readFileSync(resolve(sdkRoot, path), "utf8") !== packed(path)) throw new Error(`Installed SDK does not match frozen tarball: ${path}`);
}
console.log(`SDK ${packageInfo.version}: OpenAPI sha256 ${manifest.openapiSha256}`);
