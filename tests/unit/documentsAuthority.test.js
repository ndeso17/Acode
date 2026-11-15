import { describe, expect, it } from "vitest";
import {
	getDocumentsAuthority,
	isAcodeDocumentsTreeUri,
	isAcodeDocumentsUri,
} from "../../src/utils/documentsAuthority";

describe("documents provider authority", () => {
	it("derives the authority from the running package", () => {
		expect(getDocumentsAuthority("com.snapgent.acode")).toBe(
			"com.snapgent.acode.documents",
		);
	});

	it("recognises the fork's own terminal public uris", () => {
		expect(
			isAcodeDocumentsUri(
				"content://com.snapgent.acode.documents/tree/primary%3Apublic",
				"com.snapgent.acode",
			),
		).toBe(true);
	});

	it("does not match a different package that shares a prefix", () => {
		expect(
			isAcodeDocumentsUri(
				"content://com.snapgent.acodefree.documents/tree/primary%3Apublic",
				"com.snapgent.acode",
			),
		).toBe(false);
		expect(
			isAcodeDocumentsUri(
				"content://com.android.externalstorage.documents/tree/primary%3A",
				"com.snapgent.acode",
			),
		).toBe(false);
	});

	it("treats only tree uris as terminal folders", () => {
		expect(
			isAcodeDocumentsTreeUri(
				"content://com.snapgent.acode.documents/tree/primary%3Apublic",
				"com.snapgent.acode",
			),
		).toBe(true);
		expect(
			isAcodeDocumentsTreeUri(
				"content://com.snapgent.acode.documents/document/primary%3Apublic%2Fa.txt",
				"com.snapgent.acode",
			),
		).toBe(false);
	});
});
