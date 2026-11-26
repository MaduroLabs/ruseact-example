import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactRoot = resolve(projectRoot, "artifacts/ruseact/0.1.0-alpha.0");
const version = "0.1.0-alpha.0";
const manifest = JSON.parse(await readFile(resolve(artifactRoot, "distribution-manifest.json"), "utf8"));
const provenance = JSON.parse(await readFile(resolve(artifactRoot, "consumer-provenance.json"), "utf8"));
const projectLicense = await readFile(resolve(projectRoot, "LICENSE"), "utf8");
const artifactLicense = await readFile(resolve(artifactRoot, "LICENSE"), "utf8");
const artifactNotice = await readFile(resolve(artifactRoot, "NOTICE.md"), "utf8");

const expectedHashes = {
  ruseact: "baa47209ece2a943f3990eff4a0e4ca527c84a88c3fd0124cae0d0b73b3bb0c2",
  "ruseact-dom": "ab799f42890ddd5dcd313af27fd71a25caf9be8d96da1889f86601cac8073296",
  "ruseact-compiler": "1017c2888fb7e1f69d07de480e182169a21785bc4db56c4b24156f09331f52e1",
};

function fail(message) {
  throw new Error(`Artifact verification failed: ${message}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function readTarEntry(buffer, entryName) {
  const tar = gunzipSync(buffer);
  for (let offset = 0; offset + 512 <= tar.length;) {
    const name = tar.toString("utf8", offset, offset + 100).replace(/\0.*$/, "");
    if (!name) break;
    const sizeText = tar.toString("ascii", offset + 124, offset + 136).replace(/\0.*$/, "").trim();
    const size = Number.parseInt(sizeText || "0", 8);
    const dataStart = offset + 512;
    if (name === entryName) return tar.subarray(dataStart, dataStart + size).toString("utf8");
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  fail(`missing ${entryName} in tarball`);
}

assert(manifest.schemaVersion === 1, "unsupported manifest schema");
assert(manifest.repository === "MaduroLabs/ruseact", "unexpected framework repository");
assert(manifest.sourceCommit === provenance.artifactSourceCommit, "source provenance mismatch");
assert(manifest.sourceTree?.status === "clean", "artifact source was not clean");
assert(manifest.packageVersion === version, "unexpected package version");
assert(JSON.stringify(manifest.supportedTemplateProtocols) === JSON.stringify([1, 2, 3, 4]), "protocol range mismatch");
assert(provenance.promotedFrameworkMainCommit === "ef4ffdc46e4f3be98c270db7ac1a428573780afe", "unexpected promoted main provenance");
assert(provenance.packageVersion === version, "consumer provenance version mismatch");
assert(artifactLicense === projectLicense, "vendored artifact license does not match the repository MIT license");
assert(artifactLicense.includes("MIT License"), "vendored artifact license is not MIT");
assert(artifactLicense.includes("Copyright (c) 2026 MaduroLabs"), "vendored artifact copyright notice is missing");
assert(artifactLicense.includes("Permission is hereby granted"), "vendored artifact permission notice is missing");
assert(artifactNotice.includes("MaduroLabs/ruseact"), "vendored artifact provenance notice is missing");
assert(artifactNotice.includes("MIT license"), "vendored artifact license notice is missing");

const packageManifests = new Map();
for (const packageRecord of manifest.packages ?? []) {
  const packagePath = resolve(artifactRoot, basename(packageRecord.file));
  const bytes = await readFile(packagePath);
  const hash = createHash("sha256").update(bytes).digest("hex");
  assert(bytes.byteLength === packageRecord.bytes, `${packageRecord.name} byte size mismatch`);
  assert(hash === packageRecord.sha256, `${packageRecord.name} manifest checksum mismatch`);
  assert(hash === expectedHashes[packageRecord.name], `${packageRecord.name} pinned checksum mismatch`);
  const packageJson = JSON.parse(readTarEntry(bytes, "package/package.json"));
  assert(packageJson.name === packageRecord.name, `${packageRecord.name} package name mismatch`);
  assert(packageJson.version === version, `${packageRecord.name} package version mismatch`);
  assert(packageJson.private === true, `${packageRecord.name} must remain private`);
  assert(packageJson.type === "module", `${packageRecord.name} must remain ESM`);
  assert(!JSON.stringify(packageJson).includes("workspace:"), `${packageRecord.name} contains workspace metadata`);
  packageManifests.set(packageRecord.name, packageJson);
}

assert(packageManifests.size === 3, "expected exactly three package artifacts");
assert(packageManifests.get("ruseact-dom")?.dependencies?.ruseact === version, "DOM package must use the canonical runtime version");
assert(packageManifests.get("ruseact-compiler")?.dependencies?.typescript === "5.9.3", "compiler TypeScript dependency mismatch");

console.log(`Verified Ruseact ${version} artifacts from ${manifest.sourceCommit}.`);
console.log("- MIT license and copyright sidecar: verified");
for (const packageRecord of manifest.packages) {
  console.log(`- ${packageRecord.name}: ${packageRecord.bytes} bytes, sha256:${packageRecord.sha256}`);
}
