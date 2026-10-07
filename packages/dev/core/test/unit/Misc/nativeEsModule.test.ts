import { describe, expect, it, vi } from "vitest";
import { _EvaluateEsModuleAsync, _ImportEsModuleAsync } from "core/Misc/nativeEsModule";

describe("native ES module loading", () => {
    it("resolves relative imports and preserves import.meta.url and top-level await", async () => {
        const fetcher = vi.fn(async () => "export const value = 41;");
        const module = await _EvaluateEsModuleAsync(
            'import { value } from "./dependency.js";\nexport const result = await Promise.resolve(value + 1);\nexport const url = import.meta.url;',
            "https://example.test/relative/main.js",
            fetcher
        );
        expect(module).toEqual({ result: 42, url: "https://example.test/relative/main.js" });
        expect(fetcher).toHaveBeenCalledExactlyOnceWith("https://example.test/relative/dependency.js");
    });

    it("propagates missing export bindings instead of returning an incomplete namespace", async () => {
        await expect(_EvaluateEsModuleAsync("export { missing };", "https://example.test/missing.js", vi.fn())).rejects.toThrow(ReferenceError);
    });

    it("evicts failed imports so they can be retried", async () => {
        const fetcher = vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValueOnce("export default 42;");
        await expect(_ImportEsModuleAsync("https://example.test/retry.js", fetcher)).rejects.toThrow("unavailable");
        await expect(_ImportEsModuleAsync("https://example.test/retry.js", fetcher)).resolves.toEqual({ default: 42 });
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("binds default, namespace and renamed imports", async () => {
        const fetcher = vi.fn(async () => "export default 1;\nexport const two = 2;");
        const module = await _EvaluateEsModuleAsync(
            'import one, { two as second } from "https://example.test/bindings/a.js";\nimport * as ns from "https://example.test/bindings/a.js";\nexport default one + second + ns.two;',
            "https://example.test/bindings/main.js",
            fetcher
        );
        expect(module).toEqual({ default: 5 });
        expect(fetcher).toHaveBeenCalledOnce();
    });

    it("supports star, namespace and named re-exports", async () => {
        const fetcher = vi.fn(async () => "export default 0;\nexport const a = 1;\nexport function b() { return 2; }");
        const module = await _EvaluateEsModuleAsync(
            'export * from "./reexport/lib.js";\nexport * as lib from "./reexport/lib.js";\nexport { a as renamed, default as libDefault } from "./reexport/lib.js";',
            "https://example.test/main.js",
            fetcher
        );
        expect(module.a).toBe(1);
        expect((module.b as () => number)()).toBe(2);
        expect(module).not.toHaveProperty("default");
        expect((module.lib as { a: number }).a).toBe(1);
        expect(module.renamed).toBe(1);
        expect(module.libDefault).toBe(0);
    });

    it("rejects destructuring exports instead of silently dropping them", async () => {
        await expect(_EvaluateEsModuleAsync("export const { a } = { a: 1 };", "https://example.test/destructure.js", vi.fn())).rejects.toThrow(SyntaxError);
    });
});
