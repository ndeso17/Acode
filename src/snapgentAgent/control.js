import fsOperation from "fileSystem";
import toast from "components/toast";
import alert from "dialogs/alert";
import acode from "lib/acode";
import openFile from "lib/openFile";

/**
 * snapgent control channel.
 *
 * The agent runs MCP tools on the device (bridge -> android_mcp.py), and those
 * tools cannot reach into a running WebView. This module exposes a tiny
 * loopback HTTP endpoint *inside* Acode so the `acode_*` MCP tools can push an
 * action into the app the moment the agent asks for it: open a file in the
 * editor, run an editor command, show a message.
 *
 * Why an HTTP endpoint instead of the bridge socket: the bridge is a separate
 * process that only answers requests, and the MCP server is its child. A
 * loopback port is the smallest channel that works whether or not the snapgent
 * sidebar has been opened, and it needs no change to the bridge protocol.
 *
 * Security: the Cordova server plugin binds every interface, so every request
 * must carry the token generated here and come from loopback. The port and
 * token are published in a handshake file that the MCP server reads.
 */

const CONTROL_PORT = 8791;
const CONTROL_PORT_TRIES = 6;
const CONTROL_DIR = "file:///storage/emulated/0/.snapgent";
const CONTROL_FILE = `${CONTROL_DIR}/acode-control.json`;
const CONTROL_FILE_NAME = "acode-control.json";
const PRIMARY_STORAGE = "file:///storage/emulated/0";

/**
 * The editor manager instance.
 *
 * `lib/editorManager` default-exports the EditorManager FACTORY, and the instance
 * only exists after main.js has awaited it (main.js: `await EditorManager(...)`,
 * then `window.editorManager = editorManager`). Importing the factory here and
 * calling `.getFile()` on it threw
 *
 *   editorManager.getFile is not a function
 *
 * at runtime while looking perfectly valid in review, because the factory itself
 * has no such method. Reading it off the global at call time is what the rest of
 * Acode does as well.
 */
function getEditorManager() {
	return globalThis.editorManager || null;
}

function randomToken() {
	const bytes = new Uint8Array(24);
	const crypto = globalThis.crypto;
	if (crypto?.getRandomValues) crypto.getRandomValues(bytes);
	else
		for (let i = 0; i < bytes.length; i += 1)
			bytes[i] = Math.floor(Math.random() * 256);
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}

function isLoopback(remote) {
	const value = String(remote || "").trim();
	if (!value) return true; // older plugin builds do not report the peer
	return (
		value === "127.0.0.1" ||
		value === "::1" ||
		value === "::ffff:127.0.0.1" ||
		value.startsWith("127.")
	);
}

function sameSecret(left, right) {
	const a = String(left || "");
	const b = String(right || "");
	if (a.length !== b.length || !a) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i += 1)
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

function reply(server, requestId, status, payload) {
	try {
		server.send(requestId, {
			status,
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
	} catch (error) {
		console.warn("[snapgent] control reply failed", error);
	}
}

function toFileUrl(path) {
	const value = String(path || "").trim();
	if (!value) return "";
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
	return `file://${value.startsWith("/") ? value : `/${value}`}`;
}

function activeFilePath() {
	try {
		return getEditorManager()?.activeFile?.uri || "";
	} catch {
		return "";
	}
}

async function openInEditor(body) {
	const uri = toFileUrl(body.path);
	if (!uri)
		return { status: 400, payload: { ok: false, error: "path is required" } };

	// Re-opening a file the user already has open only makes its tab active, so
	// an edit made by the agent would stay invisible. Drop the stale tab first -
	// but never throw away unsaved changes the user is holding.
	const existing = getEditorManager()?.getFile(uri, "uri");
	if (existing && body.reload !== false && !existing.isUnsaved) {
		// Pinned tabs cannot be removed through the normal user path. This is an
		// internal reload of the same file, so bypass the pin guard without ever
		// bypassing the unsaved-change guard above.
		await existing.remove(false, { ignorePinned: true, silentPinned: true });
	}

	await openFile(uri, { render: true, persistInSession: false });

	const line = Number(body.line);
	if (Number.isFinite(line) && line > 0) {
		const editor = getEditorManager()?.editor;
		if (editor?.state?.doc) {
			const doc = editor.state.doc;
			const target = Math.max(1, Math.min(doc.lines, Math.trunc(line)));
			const column = Math.max(
				1,
				Number.isFinite(Number(body.column))
					? Math.trunc(Number(body.column))
					: 1,
			);
			const lineInfo = doc.line(target);
			const anchor = Math.min(lineInfo.to, lineInfo.from + (column - 1));
			editor.dispatch({ selection: { anchor }, scrollIntoView: true });
		}
	}
	try {
		getEditorManager()?.editor?.focus?.();
	} catch {}

	return {
		status: 200,
		payload: { ok: true, path: uri, active: activeFilePath() },
	};
}

const AGENT_COMMANDS = new Set([
	"save",
	"run",
	"run-file",
	"close-current-tab",
	"close-all-tabs",
	"focus-next-pane",
	"focus-previous-pane",
]);

async function runCommand(body) {
	const command = String(body.command || "").trim();
	if (!command)
		return {
			status: 400,
			payload: { ok: false, error: "command is required" },
		};
	if (!AGENT_COMMANDS.has(command)) {
		return {
			status: 403,
			payload: { ok: false, error: `Command is not allowed: ${command}` },
		};
	}
	const result = await acode.exec(command, body.argument);
	return {
		status: 200,
		payload: {
			ok: result !== false,
			command,
			result: result === undefined ? null : result,
		},
	};
}

async function notify(body) {
	const message = String(body.message || "").trim();
	if (!message)
		return {
			status: 400,
			payload: { ok: false, error: "message is required" },
		};
	if (String(body.level || "toast").toLowerCase() === "alert") {
		await alert("snapgent", message);
	} else {
		const duration = Number(body.duration);
		toast(message, Number.isFinite(duration) && duration > 0 ? duration : 4000);
	}
	return { status: 200, payload: { ok: true } };
}

async function handleRequest(server, state, request) {
	const requestId = request?.requestId;
	const path = String(request?.path || "/").replace(/\/+$/, "") || "/";
	const headers = request?.headers || {};

	if (!isLoopback(request?.remote)) {
		return reply(server, requestId, 403, { ok: false, error: "loopback only" });
	}
	if (!sameSecret(headers["x-snapgent-token"], state.token)) {
		return reply(server, requestId, 401, { ok: false, error: "bad token" });
	}

	let body = {};
	if (request?.body) {
		try {
			body = JSON.parse(request.body);
		} catch {
			return reply(server, requestId, 400, {
				ok: false,
				error: "body must be JSON",
			});
		}
	}

	try {
		switch (path) {
			case "/acode/ping":
				return reply(server, requestId, 200, {
					ok: true,
					app: "Acode",
					activeFile: activeFilePath(),
					openFiles: getEditorManager()?.files?.length || 0,
				});
			case "/acode/open": {
				const result = await openInEditor(body || {});
				return reply(server, requestId, result.status, result.payload);
			}
			case "/acode/command": {
				const result = await runCommand(body || {});
				return reply(server, requestId, result.status, result.payload);
			}
			case "/acode/notify": {
				const result = await notify(body || {});
				return reply(server, requestId, result.status, result.payload);
			}
			default:
				return reply(server, requestId, 404, {
					ok: false,
					error: `Unknown action: ${path}`,
				});
		}
	} catch (error) {
		return reply(server, requestId, 500, {
			ok: false,
			error: error?.message || String(error),
		});
	}
}

async function publishHandshake(state) {
	try {
		if (!(await fsOperation(CONTROL_DIR).exists())) {
			await fsOperation(PRIMARY_STORAGE).createDirectory(".snapgent");
		}
		const payload = JSON.stringify({
			port: state.port,
			token: state.token,
			app: "Acode",
			updatedAt: new Date().toISOString(),
		});
		const file = fsOperation(CONTROL_FILE);
		if (await file.exists()) await file.writeFile(payload);
		else await fsOperation(CONTROL_DIR).createFile(CONTROL_FILE_NAME, payload);
	} catch (error) {
		console.warn(
			"[snapgent] could not publish the control handshake file",
			error,
		);
	}
}

function attempt(port, state) {
	return new Promise((resolve, reject) => {
		let settled = false;
		let timer = 0;
		const done = (fn, value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			fn(value);
		};
		let server;
		try {
			server = CreateServer(
				port,
				() => done(resolve, server),
				(error) =>
					done(
						reject,
						new Error(String(error?.message || error || "server start failed")),
					),
			);
			server.setOnRequestHandler((request) => {
				handleRequest(server, state, request).catch((error) => {
					reply(server, request?.requestId, 500, {
						ok: false,
						error: error?.message || String(error),
					});
				});
			});
		} catch (error) {
			done(reject, error);
			return;
		}
		timer = setTimeout(
			() => done(reject, new Error("server start timed out")),
			5000,
		);
	});
}

/**
 * Start the control endpoint once. Safe to call from app startup: it is a no-op
 * when the Cordova server plugin is missing (e.g. the web build).
 */
export async function startSnapgentControl() {
	if (globalThis.__snapgentControl) return globalThis.__snapgentControl;
	if (typeof CreateServer !== "function") return null;

	const state = { token: randomToken(), port: 0, server: null };
	for (let index = 0; index < CONTROL_PORT_TRIES; index += 1) {
		const port = CONTROL_PORT + index;
		try {
			state.server = await attempt(port, state);
			state.port = port;
			break;
		} catch (error) {
			console.warn(
				`[snapgent] control port ${port} unavailable`,
				error?.message || error,
			);
		}
	}
	if (!state.server) return null;

	globalThis.__snapgentControl = state;
	await publishHandshake(state);
	return state;
}

export function stopSnapgentControl() {
	const state = globalThis.__snapgentControl;
	if (!state) return;
	try {
		state.server?.stop();
	} catch {}
	delete globalThis.__snapgentControl;
}

export { CONTROL_FILE, CONTROL_PORT };
