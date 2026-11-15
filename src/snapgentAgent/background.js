const STORAGE_KEY = "snapgentWebProviderStorage";

const READ_ONLY_TOOLS = new Set([
	"read_file",
	"read_multiple_files",
	"list_files",
	"list_directory",
	"directory_tree",
	"search_files",
	"grep_search",
	"get_file_info",
	"get_status",
]);

export function createMemoryStore() {
	let value = {};
	return {
		read: () => ({ ...value }),
		write: (next) => {
			value = { ...next };
		},
	};
}

function defaultStore() {
	return {
		read() {
			try {
				return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {};
			} catch {
				return {};
			}
		},
		write(value) {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
		},
	};
}

/**
 * Host side of the snapgent chrome.* shim. The provider page runs the real
 * snapgent scripts; this decides which bridge operations they may reach.
 */
export function createSnapgentBackground({ bridge, approveTool, store = defaultStore() }) {
	let storage = store.read();

	function persist() {
		store.write(storage);
	}

	function status() {
		return {
			connected: Boolean(bridge?.status?.connected),
			hostReady: Boolean(bridge?.status?.connected),
			transport: "websocket",
			mcpAlive: Boolean(bridge?.status?.connected),
			bridgeVersion: bridge?.status?.bridgeVersion || "",
			tools: bridge?.catalogue || [],
			servers: bridge?.status?.servers || [],
			lastError: bridge?.status?.error || "",
		};
	}

	async function runtime(msg = {}) {
		switch (msg.type) {
			case "status":
				return status();
			case "list_tools":
				return {
					ok: true,
					tools: bridge?.catalogue || [],
					servers: bridge?.status?.servers || [],
				};
			case "call_tool": {
				const name = String(msg.name || "");
				if (!(bridge?.catalogue || []).some((tool) => tool.name === name)) {
					return { ok: false, kind: "unknown_tool", error: `Unknown tool: ${name}` };
				}
				if (!READ_ONLY_TOOLS.has(name)) {
					const allowed = await approveTool(name, msg.arguments || {});
					if (!allowed) {
						return { ok: false, kind: "denied", error: "Tool call denied by user." };
					}
				}
				return bridge.callTool(name, msg.arguments || {}, msg.timeout, msg.server);
			}
			case "reconnect":
				bridge?.close?.();
				await bridge?.connect?.();
				return status();
			default:
				return { ok: false, error: "Unsupported snapgent request." };
		}
	}

	return async function handle(frame = {}) {
		switch (frame.kind) {
			case "runtime":
				return { ok: true, reply: await runtime(frame.msg) };
			case "storageGet": {
				const keys = frame.keys;
				if (!Array.isArray(keys)) return { ok: true, value: { ...storage } };
				const value = {};
				for (const key of keys) if (key in storage) value[key] = storage[key];
				return { ok: true, value };
			}
			case "storageSet":
				storage = { ...storage, ...(frame.items || {}) };
				persist();
				return { ok: true };
			case "storageRemove":
				for (const key of frame.keys || []) delete storage[key];
				persist();
				return { ok: true };
			default:
				return { ok: false, error: "Unsupported page message." };
		}
	};
}
