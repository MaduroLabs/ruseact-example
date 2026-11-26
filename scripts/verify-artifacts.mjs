import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactRoot = resolve(projectRoot, "artifacts/ruseact/0.1.0-alpha.1");
const version = "0.1.0-alpha.1";
const expectedArtifactSourceCommit = "2a0ab7781b6c56fde643bf6bc8ed3f550097209c";
const expectedDistributionSourceCommit = "149c3bb1147c1e9baf311cd8a7eb77189f516055";
const expectedPromotedMainCommit = "2a0ab7781b6c56fde643bf6bc8ed3f550097209c";
const manifest = JSON.parse(await readFile(resolve(artifactRoot, "distribution-manifest.json"), "utf8"));
const provenance = JSON.parse(await readFile(resolve(artifactRoot, "consumer-provenance.json"), "utf8"));
const projectLicense = await readFile(resolve(projectRoot, "LICENSE"), "utf8");
const artifactLicense = await readFile(resolve(artifactRoot, "LICENSE"), "utf8");
const artifactNotice = await readFile(resolve(artifactRoot, "NOTICE.md"), "utf8");

const expectedHashes = {
  ruseact: "2101d2a8c038fbefbfcb091b5a337462dbbb67a8b1d253398679eca551663867",
  "ruseact-dom": "7323748f727057476d6282c7e40ff01537767e1108f903554a88a3b0c078c8e3",
  "ruseact-compiler": "bb180975b41099cea8ce428126b04aec28dc9d08bb569f4805b705f374ef06d1",
};
const expectedBytes = {
  ruseact: 78819,
  "ruseact-dom": 76434,
  "ruseact-compiler": 22832,
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
assert(manifest.sourceCommit === expectedArtifactSourceCommit, "unexpected artifact source commit");
assert(manifest.sourceCommit === provenance.artifactSourceCommit, "source provenance mismatch");
assert(provenance.distributionSourceCommit === expectedDistributionSourceCommit, "unexpected distribution source commit");
assert(manifest.sourceTree?.status === "clean", "artifact source was not clean");
assert(manifest.packageVersion === version, "unexpected package version");
assert(JSON.stringify(manifest.supportedTemplateProtocols) === JSON.stringify([1, 2, 3, 4]), "protocol range mismatch");
assert(provenance.promotedFrameworkMainCommit === expectedPromotedMainCommit, "unexpected promoted main provenance");
assert(provenance.packageVersion === version, "consumer provenance version mismatch");
assert(provenance.distributionPullRequest === 67, "unexpected distribution PR provenance");
assert(provenance.promotionPullRequest === 68, "unexpected promotion PR provenance");
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
  assert(bytes.byteLength === expectedBytes[packageRecord.name], `${packageRecord.name} pinned byte size mismatch`);
  assert(bytes.byteLength === packageRecord.bytes, `${packageRecord.name} manifest byte size mismatch`);
  assert(hash === packageRecord.sha256, `${packageRecord.name} manifest checksum mismatch`);
  assert(hash === expectedHashes[packageRecord.name], `${packageRecord.name} pinned checksum mismatch`);
  const packageJson = JSON.parse(readTarEntry(bytes, "package/package.json"));
  assert(packageJson.name === packageRecord.name, `${packageRecord.name} package name mismatch`);
  assert(packageJson.version === version, `${packageRecord.name} package version mismatch`);
  assert(packageJson.private === true, `${packageRecord.name} must remain private`);
  assert(packageJson.type === "module", `${packageRecord.name} must remain ESM`);
  assert(!JSON.stringify(packageJson).includes("workspace:"), `${packageRecord.name} contains workspace metadata`);
  assert(readTarEntry(bytes, "package/LICENSE") === projectLicense, `${packageRecord.name} package license mismatch`);
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
