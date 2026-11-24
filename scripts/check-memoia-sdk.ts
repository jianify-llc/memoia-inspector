import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const root = resolve(import.meta.dirname, "..");
const inspector = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const dependency = inspector.dependencies["@jianify/memoia"];
if (dependency !== "file:vendor/jianify-memoia-0.12.0-12c695bdaeea.tgz") throw new Error("Inspector requires the reviewed fixed SDK tarball");
const tarball = resolve(root, dependency.slice(5));
const packed = (path: string) => execFileSync("tar", ["-xOf", tarball, `package/${path}`], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
const packageInfo = JSON.parse(packed("package.json"));
const manifest = JSON.parse(packed("src/generated/manifest.json"));
if (packageInfo.name !== "@jianify/memoia" || packageInfo.version !== "0.12.0" || manifest.sdkVersion !== "0.12.0" || manifest.openapiSha256 !== "12c695bdaeea536d3050e1f38ec1786f04f8f250466b297fd0218a63c5fc7dae") {
  throw new Error("Unreviewed or missing SDK protocol/version identity");
}
const sdkRoot = resolve(dirname(fileURLToPath(import.meta.resolve("@jianify/memoia"))), "..");
for (const path of ["package.json", "dist/client.js", "dist/client.d.ts", "dist/index.d.ts", "dist/generated/openapi.d.ts", "dist/generated/validators.js", "src/generated/manifest.json", "THIRD_PARTY_NOTICES"]) {
  if (readFileSync(resolve(sdkRoot, path), "utf8") !== packed(path)) throw new Error(`Installed SDK does not match frozen tarball: ${path}`);
}
console.log(`SDK ${packageInfo.version}: OpenAPI sha256 ${manifest.openapiSha256}`);
