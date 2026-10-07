/**
 * Lets Node's test runner load a module that imports its PURE siblings through
 * the app's own `@/` alias (lib/customer-stock.ts → lib/storage-filter.ts,
 * lib/customer-link.ts).
 *
 * Every other module the tests load is import-free, which is why none of them
 * needed this: Node resolves neither `@/lib/x` nor an extension-less path, and
 * tsconfig rejects the explicit `.ts` Node wants. Rather than copy five
 * storage rules into a second file — the copies are how two readings of one
 * rule drift apart — the alias is mapped HERE, for the test process only. The
 * app's resolution (tsconfig `paths`, the bundler) is untouched.
 *
 * Import this file FIRST and load the module under test with a dynamic
 * `await import(...)`: static imports are linked before any module runs, so a
 * static import of the module would be resolved before this hook exists.
 *
 * Not a `*.test.ts` file, so `npm test` does not run it on its own.
 */
import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const file = path.join(ROOT, `${specifier.slice(2)}.ts`);
      return nextResolve(pathToFileURL(file).href, context);
    }
    return nextResolve(specifier, context);
  },
});
