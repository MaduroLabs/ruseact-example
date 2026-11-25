import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { compileTsxModule } from "ruseact-compiler";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = resolve(projectRoot, "src/examples");
const generatedRoot = resolve(projectRoot, ".generated/examples");
const sourceFiles = [
  resolve(sourceRoot, "hello-world/App.tsx"),
  resolve(sourceRoot, "counter/App.tsx"),
];

function formatDiagnostic(diagnostic) {
  const location = diagnostic.location;
  return `${location.fileName}:${location.line}:${location.column} ${diagnostic.code}: ${diagnostic.message}`;
}

await rm(generatedRoot, { recursive: true, force: true });

for (const sourceFile of sourceFiles) {
  const source = await readFile(sourceFile, "utf8");
  const fileName = relative(projectRoot, sourceFile).split(sep).join("/");
  const result = compileTsxModule(source, { fileName });
  if (!result.ok) {
    for (const diagnostic of result.diagnostics) console.error(formatDiagnostic(diagnostic));
    process.exitCode = 1;
    continue;
  }

  const relativeSource = relative(sourceRoot, sourceFile).replace(/\.tsx$/, ".mjs");
  const outputFile = resolve(generatedRoot, relativeSource);
  await mkdir(dirname(outputFile), { recursive: true });
  await writeFile(outputFile, `${result.code}\n//# sourceURL=${fileName}\n`, "utf8");
  await writeFile(
    outputFile.replace(/\.mjs$/, ".d.mts"),
    `import type { ViewDescription } from "ruseact-dom";\nexport declare function createView(context?: Record<string, unknown>): ViewDescription;\n`,
    "utf8",
  );
  console.log(`Compiled ${fileName} -> ${relative(projectRoot, outputFile)}`);
}

if (process.exitCode) process.exit(process.exitCode);
