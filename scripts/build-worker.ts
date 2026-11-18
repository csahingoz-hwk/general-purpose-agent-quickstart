import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = process.cwd();
const outRoot = path.join(repoRoot, ".next", "worker");

const WORKER_SOURCES = [
  "lib/safety/untrusted-content.ts",
  "lib/safety/action-review.ts",
  "lib/cron/cron-utils.ts",
  "lib/tasks/runner.ts",
  "lib/worker/log-rotator.ts",
  "lib/worker/workload-policy.ts",
  "lib/worker/health-server.ts",
  "lib/worker/queue-worker.ts",
  "scripts/mac-worker.ts",
];

function rewriteSpecifiers(code: string, fromRelFile: string): string {
  const fromOutDir = path.dirname(path.join(outRoot, fromRelFile));

  return code.replace(
    /(from\s+["'])([^"']+)(["'])/g,
    (_full, prefix: string, spec: string, suffix: string) => {
      if (spec.startsWith("@/")) {
        const targetAbs = path.join(repoRoot, `${spec.slice(2)}.ts`);
        if (existsSync(targetAbs)) {
          const targetOut = path.join(outRoot, `${spec.slice(2)}.js`);
          let rel = path.relative(fromOutDir, targetOut).replace(/\\/g, "/");
          if (!rel.startsWith(".")) {
            rel = `./${rel}`;
          }
          return `${prefix}${rel}${suffix}`;
        }
      }
      if (
        (spec.startsWith("./") || spec.startsWith("../")) &&
        !spec.endsWith(".js") &&
        !spec.endsWith(".mjs")
      ) {
        return `${prefix}${spec}.js${suffix}`;
      }
      return `${prefix}${spec}${suffix}`;
    }
  );
}

mkdirSync(outRoot, { recursive: true });
writeFileSync(
  path.join(outRoot, "package.json"),
  '{"type":"module"}\n',
  "utf8"
);

for (const relFile of WORKER_SOURCES) {
  const absIn = path.join(repoRoot, relFile);
  const source = readFileSync(absIn, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      esModuleInterop: true,
    },
    fileName: absIn,
  });

  const relOut = relFile.replace(/\.ts$/, ".js");
  const absOut = path.join(outRoot, relOut);
  mkdirSync(path.dirname(absOut), { recursive: true });
  writeFileSync(
    absOut,
    rewriteSpecifiers(transpiled.outputText, relOut),
    "utf8"
  );
}

process.stdout.write(
  `Built lightweight worker -> ${path.join(outRoot, "scripts/mac-worker.js")}\n`
);
