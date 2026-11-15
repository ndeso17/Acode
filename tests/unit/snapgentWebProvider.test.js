import { describe, expect, it } from "vitest";
import {
	DEFAULT_PROVIDER_ID,
	PROVIDERS,
	getProviderById,
	isTrustedProviderUrl,
} from "../../src/snapgentAgent/providers";

describe("snapgent web providers", () => {
	it("uses a website session by default and does not require an API key", () => {
		expect(DEFAULT_PROVIDER_ID).toBe("chatgpt");
		expect(getProviderById(DEFAULT_PROVIDER_ID)).toMatchObject({
			url: "https://chatgpt.com/",
			script: "chatgpt",
		});
	});

	it("includes the supported snapgent website providers", () => {
		expect(PROVIDERS.map(({ id }) => id)).toEqual([
			"chatgpt",
			"claude",
			"deepseek",
			"gemini",
			"kimi",
			"glm",
			"qwen",
			"arena",
			"meta",
			"ptero",
			"grok",
			"mistral",
		]);
	});

	it("allows only HTTPS pages on the selected provider host", () => {
		expect(isTrustedProviderUrl("https://chatgpt.com/c/123", "chatgpt")).toBe(true);
		expect(isTrustedProviderUrl("http://chatgpt.com/c/123", "chatgpt")).toBe(false);
		expect(isTrustedProviderUrl("https://evil.test/", "chatgpt")).toBe(false);
		expect(isTrustedProviderUrl("not a URL", "chatgpt")).toBe(false);
	});
});
