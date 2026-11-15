import { describe, expect, it } from "vitest";
import {
	normalizeStorageUrl,
	resolveStorageUrl,
	shouldShowInternalStorage,
} from "../../src/pages/fileBrowser/storageEntry";

describe("file browser storage entries", () => {
	it("does not build a raw file:// url without all-files access", () => {
		expect(
			resolveStorageUrl({ path: "/storage/1A2B-3C4D", uuid: "1A2B-3C4D" }, false),
		).toBe("");
	});

	it("uses the raw path only when all-files access is granted", () => {
		expect(
			resolveStorageUrl({ path: "/storage/1A2B-3C4D", uuid: "1A2B-3C4D" }, true),
		).toBe("file:///storage/1A2B-3C4D");
	});

	it("keeps an existing SAF url when no raw path is available", () => {
		expect(
			resolveStorageUrl({ url: "content://x/tree/y", uuid: "primary" }, false),
		).toBe("content://x/tree/y");
	});

	it("shows shared storage on Android 11+ only with all-files access", () => {
		expect(shouldShowInternalStorage({ sdkInt: 33, hasStorageManager: true })).toBe(
			true,
		);
		expect(shouldShowInternalStorage({ sdkInt: 33, hasStorageManager: false })).toBe(
			false,
		);
		expect(shouldShowInternalStorage({ sdkInt: 29, hasInternalStorage: true })).toBe(
			true,
		);
	});

	it("treats trailing slashes as the same storage url", () => {
		expect(normalizeStorageUrl("file:///storage/emulated/0/")).toBe(
			normalizeStorageUrl("file:///storage/emulated/0"),
		);
		expect(normalizeStorageUrl(undefined)).toBe("");
	});
});
