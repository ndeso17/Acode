import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The cordova Server plugin is what carries every request from the native
 * NanoHTTPD server up to the webview. This file pins the serialisation of the
 * request object, because getting it wrong is silent and expensive:
 *
 *   jsonRequest.put("headers", session.getHeaders())
 *
 * JSONObject.put(String, Object) does NOT convert a Map to a JSON object - the
 * Map is kept and turned into its toString() when the JSON is flattened, so the
 * webview received
 *
 *   "headers": "{x-snapgent-token=..., content-type=application/json, ...}"
 *
 * a STRING. Every consumer does headers["x-snapgent-token"], got undefined and
 * failed closed, so the snapgent control channel answered 401 to every correct
 * token. Nothing in the Java code was obviously wrong, which is why it took a
 * probe server inside the app to find.
 */
const SERVER_SRC = path.resolve(
	fileURLToPath(new URL(".", import.meta.url)),
	"../../src/plugins/server/src/android/com/foxdebug/server/NanoHTTPDWebserver.java",
);

const source = fs.readFileSync(SERVER_SRC, "utf8");

/** The body of createJSONRequest(), from its signature to the closing brace. */
function createJSONRequestBody(text) {
	const start = text.indexOf("private JSONObject createJSONRequest(");
	if (start < 0) {
		return "";
	}
	const end = text.indexOf("\n  }", start);
	return end < 0 ? text.slice(start) : text.slice(start, end);
}

/** The expression passed as the value of `"headers"`, or null when absent. */
function headersArgument(body) {
	const match = body.match(/put\(\s*"headers"\s*,\s*(.+?)\s*\);\s*$/m);
	return match ? match[1] : null;
}

describe("cordova Server plugin request serialisation", () => {
	it("hands the webview a JSON object of headers, not a Map", () => {
		const body = createJSONRequestBody(source);
		expect(body).not.toBe("");
		const argument = headersArgument(body);
		expect(argument).not.toBeNull();
		// The raw Map must never reach JSONObject.put - it would stringify.
		expect(argument).not.toBe("session.getHeaders()");
		expect(argument).toMatch(/headersToJSON\(session\.getHeaders\(\)\)/);
	});

	it("builds the header object one entry at a time", () => {
		expect(source).toMatch(/JSONObject headersToJSON\(Map<String, String> headers\)/);
		// entrySet() + put() is what actually produces a JSON object.
		expect(source).toMatch(/for \(Map\.Entry<String, String> entry : headers\.entrySet\(\)\)/);
	});

	it("folds header names to lower case", () => {
		// RFC 7230 makes header names case-insensitive, so a client may send
		// X-Snapgent-Token while the JS looks up x-snapgent-token.
		expect(source).toMatch(/name\.toLowerCase\(java\.util\.Locale\.ROOT\)/);
	});

	it("does not fail the whole request on an unusable header", () => {
		// A null value makes JSONObject.put throw; a missing token header must
		// surface as a 401 from the handler, not as a crashed request.
		expect(source).toMatch(/catch \(JSONException e\)/);
	});
});
