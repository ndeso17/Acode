import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The snapgent control channel runs inside the app's webview, but it was written
 * against `lib/editorManager`, whose DEFAULT EXPORT IS THE FACTORY:
 *
 *   export default EditorManager;              // src/lib/editorManager.js
 *
 * The instance only exists after main.js awaits it and publishes it on the
 * global. So every `editorManager.getFile(...)` in control.js threw
 *
 *   editorManager.getFile is not a function
 *
 * at runtime - a 500 from the endpoint - while reading as correct code, because
 * the factory and the instance share a name.
 */
const CONTROL = path.resolve(
	fileURLToPath(new URL(".", import.meta.url)),
	"../../src/snapgentAgent/control.js",
);
const EDITOR_MANAGER = path.resolve(
	fileURLToPath(new URL(".", import.meta.url)),
	"../../src/lib/editorManager.js",
);

const control = fs.readFileSync(CONTROL, "utf8");
const editorManagerSource = fs.readFileSync(EDITOR_MANAGER, "utf8");

describe("snapgent control channel editor access", () => {
	it("does not import the EditorManager factory as if it were the instance", () => {
		// The regression: `import editorManager from "lib/editorManager"` binds the
		// factory, and calling .getFile() on it fails at runtime.
		expect(control).not.toMatch(/import\s+editorManager\s+from\s+["']lib\/editorManager["']/);
	});

	it("confirms the library really does default-export a factory", () => {
		// Guards the reasoning above; if this ever becomes the instance, the
		// indirection can be dropped.
		expect(editorManagerSource).toMatch(/export default EditorManager;/);
	});

	it("resolves the live instance from the global at call time", () => {
		expect(control).toMatch(/function getEditorManager\(\)/);
		expect(control).toMatch(/globalThis\.editorManager/);
	});

	it("never calls a method on an unresolved editor manager", () => {
		// Only the helper may name the global directly, always optional-chained.
		// Comments are stripped first: this file's own documentation quotes the
		// failing call, which is not code.
		const code = control
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.split("\n")
			.filter((line) => !/^\s*\/\//.test(line));
		const uses = code.filter((line) => /\beditorManager\./.test(line));
		expect(uses).toEqual([]);
	});
});
