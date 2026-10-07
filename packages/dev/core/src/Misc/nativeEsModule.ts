/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Minimal ES module evaluator used by Babylon Native.
 *
 * Babylon Native has no DOM, so the web strategy of injecting a `<script type="module">`
 * element (see `Tools._LoadScriptWeb`) is not available, and the JavaScript engines it
 * embeds are used as plain script engines with no module resolver wired up. Anything that
 * goes through `_LoadScriptModuleAsync` - the SPZ gaussian splatting decoder, the Manifold
 * CSG2 backend, the recast-navigation plugin - therefore failed outright.
 *
 * This file implements just enough of the module semantics to run those payloads: static
 * `import` resolution against the network, `export` collection, `import.meta.url`, and
 * top level `await`. It is deliberately not a spec compliant loader; in particular there
 * are no live bindings (a module namespace is snapshotted once evaluation finishes) and no
 * cyclic import support. Statements are recognized textually, so an `import`/`export`
 * statement embedded in a string or comment may be misread, and only the first declarator of
 * `export const a = 1, b = 2` is exported. Unsupported destructuring exports throw. Every payload
 * we care about is either a bundled ES module or an Emscripten `EXPORT_ES6` output, both of
 * which are self contained and acyclic.
 */

type ModuleNamespace = { [key: string]: unknown };

/**
 * Fetches the source text of a module. Injected by the caller so that this file does not
 * have to depend on `Tools` (which depends on this file).
 */
export type ModuleSourceFetcher = (url: string) => Promise<string>;

const ModuleCache = new Map<string, Promise<ModuleNamespace>>();

interface IParsedImport {
    /** Raw module specifier as written in the source. */
    specifier: string;
    /** Local name bound to the default export, if any. */
    defaultName?: string;
    /** Local name bound to the whole namespace, if any. */
    namespaceName?: string;
    /** [exported name, local name] pairs. */
    named: [string, string][];
}

interface IParsedModule {
    code: string;
    imports: IParsedImport[];
    /** [exported name, local name] pairs collected from `export` statements. */
    exports: [string, string][];
    /** Indices into `imports` that are re-exported wholesale via `export * from`. */
    starReexports: number[];
    /** [exported name, import index, imported name] triples from `export { a as b } from` / `export * as ns from`; a null imported name re-exports the whole namespace. */
    reexports: [string, number, string | null][];
}

// A statement-leading `import`/`export` keyword: start of source, or preceded by a newline,
// `;` or `}`. Matching anywhere would corrupt minified payloads that merely mention the word.
const ImportStatementRegex = /(^|[\n;}])([ \t]*)import[ \t\n]+(?:([A-Za-z0-9_$,{}*\s]+?)[ \t\n]+from[ \t\n]*)?(["'])([^"'\n]+)\4[ \t]*;?/g;
const ExportStarRegex = /(^|[\n;}])([ \t]*)export[ \t\n]+\*[ \t\n]+from[ \t\n]*(["'])([^"'\n]+)\3[ \t]*;?/g;
const ExportStarAsRegex = /(^|[\n;}])([ \t]*)export[ \t\n]+\*[ \t\n]*as[ \t\n]+([A-Za-z0-9_$]+)[ \t\n]+from[ \t\n]*(["'])([^"'\n]+)\4[ \t]*;?/g;
const ExportFromRegex = /(^|[\n;}])([ \t]*)export[ \t\n]*\{([^}]*)\}[ \t\n]*from[ \t\n]*(["'])([^"'\n]+)\4[ \t]*;?/g;
const ExportListRegex = /(^|[\n;}])([ \t]*)export[ \t\n]*\{([^}]*)\}[ \t]*;?/g;
const ExportDefaultRegex = /(^|[\n;}])([ \t]*)export[ \t\n]+default[ \t\n]+/g;
const ExportDeclarationRegex = /(^|[\n;}])([ \t]*)export[ \t\n]+(?=(?:const|let|var|class|function|async)[\s(])/g;
const DeclarationNameRegex = /^(?:const|let|var|class|(?:async[ \t\n]+)?function)[ \t\n]*\*?[ \t\n]*([A-Za-z0-9_$]+)/;

/**
 * Parses a `{ a, b as c }` binding list body.
 * @param body the text between the braces
 * @returns [source name, bound name] pairs
 */
function ParseBindingList(body: string): [string, string][] {
    const bindings: [string, string][] = [];
    for (const entry of body.split(",")) {
        const parts = entry.trim().split(/[ \t\n]+as[ \t\n]+/);
        if (parts[0]) {
            bindings.push([parts[0].trim(), (parts[1] ?? parts[0]).trim()]);
        }
    }
    return bindings;
}

/**
 * Splits an `import` clause such as `Default, { a, b as c }` or `* as ns` into its bindings.
 * @param clause the text between the `import` keyword and `from`
 * @param parsed the import record to populate
 */
function ParseImportClause(clause: string, parsed: IParsedImport): void {
    const braceStart = clause.indexOf("{");
    let head = braceStart === -1 ? clause : clause.substring(0, braceStart);
    if (braceStart !== -1) {
        const braceEnd = clause.indexOf("}", braceStart);
        const body = clause.substring(braceStart + 1, braceEnd === -1 ? clause.length : braceEnd);
        parsed.named.push(...ParseBindingList(body));
    }

    head = head.replace(/,\s*$/, "").trim();
    if (!head) {
        return;
    }

    const namespaceMatch = head.match(/^\*[ \t\n]*as[ \t\n]+([A-Za-z0-9_$]+)$/);
    if (namespaceMatch) {
        parsed.namespaceName = namespaceMatch[1];
    } else {
        parsed.defaultName = head;
    }
}

/**
 * Rewrites ES module source into something that can be evaluated as a function body.
 * @param source the module source
 * @returns the rewritten source along with the import/export metadata that was extracted
 */
function ParseModule(source: string): IParsedModule {
    const imports: IParsedImport[] = [];
    const exports: [string, string][] = [];
    const starReexports: number[] = [];
    const reexports: [string, number, string | null][] = [];

    let code = source.replace(ExportStarAsRegex, (_match, lead: string, indent: string, name: string, _quote: string, specifier: string) => {
        reexports.push([name, imports.length, null]);
        imports.push({ specifier, named: [] });
        return lead + indent;
    });

    code = code.replace(ExportFromRegex, (_match, lead: string, indent: string, body: string, _quote: string, specifier: string) => {
        for (const [imported, exported] of ParseBindingList(body)) {
            reexports.push([exported, imports.length, imported]);
        }
        imports.push({ specifier, named: [] });
        return lead + indent;
    });

    code = code.replace(ExportStarRegex, (_match, lead: string, indent: string, _quote: string, specifier: string) => {
        starReexports.push(imports.length);
        imports.push({ specifier, named: [] });
        return lead + indent;
    });

    code = code.replace(ImportStatementRegex, (_match, lead: string, indent: string, clause: string | undefined, _quote: string, specifier: string) => {
        const parsed: IParsedImport = { specifier, named: [] };
        if (clause) {
            ParseImportClause(clause, parsed);
        }
        imports.push(parsed);
        return lead + indent;
    });

    code = code.replace(ExportListRegex, (_match, lead: string, indent: string, body: string) => {
        for (const [local, exported] of ParseBindingList(body)) {
            exports.push([exported, local]);
        }
        return lead + indent;
    });

    code = code.replace(ExportDefaultRegex, "$1$2__esmExports.default = ");

    code = code.replace(ExportDeclarationRegex, (match: string, lead: string, indent: string, offset: number, whole: string) => {
        const declaration = whole.substring(offset + match.length);
        const nameMatch = declaration.match(DeclarationNameRegex);
        if (!nameMatch) {
            // Destructuring exports (`export const { a } = ...`) would otherwise be silently dropped.
            throw new SyntaxError(`Unsupported export declaration in native ES module: ${declaration.substring(0, 40)}`);
        }
        exports.push([nameMatch[1], nameMatch[1]]);
        return lead + indent;
    });

    return { code, imports, exports, starReexports, reexports };
}

/**
 * Resolves a module specifier against the url of the module that imports it.
 * @param specifier the specifier as written in the source
 * @param baseUrl the url of the importing module, if known
 * @returns an absolute url
 */
function ResolveSpecifier(specifier: string, baseUrl?: string): string {
    try {
        return baseUrl ? new URL(specifier, baseUrl).href : new URL(specifier).href;
    } catch {
        // Bare specifiers ("module", "fs", ...) have no meaning here. Emscripten output only
        // reaches them behind a Node.js environment check, so returning the specifier
        // unchanged lets the fetch fail with a message that names the offender.
        return specifier;
    }
}

/**
 * Evaluates ES module source and returns its namespace object.
 * @param source the module source
 * @param url the url the source was loaded from, used for `import.meta.url` and specifier resolution
 * @param fetcher used to download statically imported modules
 * @returns the module namespace
 * @internal
 */
export async function _EvaluateEsModuleAsync(source: string, url: string, fetcher: ModuleSourceFetcher): Promise<ModuleNamespace> {
    const parsed = ParseModule(source);

    const namespaces = await Promise.all(
        parsed.imports.map(async (entry) => {
            return await _ImportEsModuleAsync(ResolveSpecifier(entry.specifier, url), fetcher);
        })
    );

    const prologue: string[] = [];
    for (let index = 0; index < parsed.imports.length; index++) {
        const entry = parsed.imports[index];
        if (entry.namespaceName) {
            prologue.push(`const ${entry.namespaceName} = __esmImports[${index}];`);
        }
        if (entry.defaultName) {
            prologue.push(`const ${entry.defaultName} = __esmImports[${index}].default;`);
        }
        for (const [exported, local] of entry.named) {
            prologue.push(`const ${local} = __esmImports[${index}][${JSON.stringify(exported)}];`);
        }
    }

    const epilogue: string[] = [];
    for (const index of parsed.starReexports) {
        epilogue.push(`for (const key of Object.keys(__esmImports[${index}])) { if (key !== "default") { __esmExports[key] = __esmImports[${index}][key]; } }`);
    }
    for (const [exported, index, imported] of parsed.reexports) {
        epilogue.push(`__esmExports[${JSON.stringify(exported)}] = __esmImports[${index}]${imported === null ? "" : `[${JSON.stringify(imported)}]`};`);
    }
    for (const [exported, local] of parsed.exports) {
        epilogue.push(`__esmExports[${JSON.stringify(exported)}] = ${local};`);
    }

    // `import.meta` is a syntax error outside a real module, so it is substituted textually.
    const body = parsed.code.replace(/\bimport\.meta\.url\b/g, JSON.stringify(url)).replace(/\bimport\.meta\b/g, `({ url: ${JSON.stringify(url)} })`);

    const exportsObject: ModuleNamespace = {};
    // The module body is wrapped in an async arrow *inside the generated source string* rather
    // than compiled with an AsyncFunction constructor. Babylon Native scripts are downleveled
    // to ES5 (see BabylonNative Apps/scripts/downlevelNativeScripts.mjs), which rewrites any
    // `async function` literal in this file into a plain promise-returning function - so
    // `Object.getPrototypeOf(async function () {}).constructor` would resolve to `Function`
    // and reject the top level `await` that every one of these payloads uses. Text inside a
    // string literal is left alone, and the engine itself supports async syntax at runtime.
    const evaluate = new Function("__esmImports", "__esmExports", `return (async () => {\n${prologue.join("\n")}\n${body}\n${epilogue.join("\n")}\n})();`);
    await evaluate(namespaces, exportsObject);
    return exportsObject;
}

/**
 * Downloads and evaluates an ES module, caching the result per url.
 * @param url absolute url of the module
 * @param fetcher used to download the module source
 * @returns the module namespace
 * @internal
 */
export async function _ImportEsModuleAsync(url: string, fetcher: ModuleSourceFetcher): Promise<ModuleNamespace> {
    let pending = ModuleCache.get(url);
    if (!pending) {
        pending = (async () => {
            const source = await fetcher(url);
            return await _EvaluateEsModuleAsync(source, url, fetcher);
        })();
        ModuleCache.set(url, pending);
    }

    try {
        return await pending;
    } catch (e) {
        // Do not cache failures: a transient network error should not poison later attempts.
        if (ModuleCache.get(url) === pending) {
            ModuleCache.delete(url);
        }
        throw e;
    }
}
