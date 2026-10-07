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
});
