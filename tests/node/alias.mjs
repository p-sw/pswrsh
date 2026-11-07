// Lets `node --test` load app modules that import "@/..." without a bundler.
// Usage: node --import ./tests/node/alias.mjs --test tests/node/
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(`
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
const SRC = ${JSON.stringify(new URL("../../src/", import.meta.url).pathname)};
export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const base = SRC + specifier.slice(2);
    for (const candidate of [base, base + ".ts", base + ".tsx", base + "/index.ts"]) {
      if (existsSync(candidate) && !candidate.endsWith("/")) return next(pathToFileURL(candidate).href, context);
    }
  }
  return next(specifier, context);
}
`),
  import.meta.url,
);
