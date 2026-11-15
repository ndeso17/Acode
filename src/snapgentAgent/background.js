const STORAGE_KEY = "snapgentWebProviderStorage";

// The phone's MCP server is declared as "android" in the bridge config, but
// inside Acode that same server IS the Acode editor target. Expose it under the
// id the extension's target list knows, so the bar can say "Acode" and select it
// instead of showing an opaque addon called "android". The bridge still receives
// its own id back (see toBridgeServerId) - only the wire to the provider page is
// translated.
const SERVER_ID_ALIASES = { android: "acode" };

function toExtensionServerId(id) {
	return SERVER_ID_ALIASES[id] || id;
}

function toBridgeServerId(id) {
	for (const [bridgeId, extensionId] of Object.entries(SERVER_ID_ALIASES)) {
		if (extensionId === id) return bridgeId;
	}
	return id;
}

function clientServer(server) {
	if (!server || !server.id) return server;
	const id = toExtensionServerId(server.id);
	return {
		...server,
		id,
		name: server.name || (id === "acode" ? "Acode" : id),
	};
}

function clientTool(tool) {
	if (!tool || !tool.server) return tool;
	const server = toExtensionServerId(tool.server);
	return server === tool.server ? tool : { ...tool, server };
}

function clientServers(servers) {
	return Array.isArray(servers) ? servers.map(clientServer) : [];
}

function clientTools(tools) {
	return Array.isArray(tools) ? tools.map(clientTool) : [];
}

export { clientServers, clientTools, toBridgeServerId, toExtensionServerId };

const READ_ONLY_TOOLS = new Set([
	// Canonical/desktop names.
	"read_file",
	"read_multiple_files",
	"list_files",
	"list_directory",
	"directory_tree",
	"search_files",
	"grep_search",
	"get_file_info",
	"get_status",
	// Android MCP names. Only genuinely mutating or device-control tools should
	// trigger approval; workspace probes and reads must be able to run while the
	// session is starting.
	"get_workspace_info",
	"get_project_info",
	"list_dir",
	"list_tree",
	"find_files",
	"read_files",
	"read_file_lines",
	"get_file_outline",
	"git_status",
	"git_diff",
	"git_log",
	"git_branches",
	"device_info",
	"list_packages",
	"read_logcat",
	"dumpsys",
	"acode_status",
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
export function createSnapgentBackground({
	bridge,
	approveTool,
	store = defaultStore(),
}) {
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
			tools: clientTools(bridge?.catalogue),
			servers: clientServers(bridge?.status?.servers),
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
					tools: clientTools(bridge?.catalogue),
					servers: clientServers(bridge?.status?.servers),
				};
			case "call_tool": {
				const name = String(msg.name || "");
				if (!(bridge?.catalogue || []).some((tool) => tool.name === name)) {
					return {
						ok: false,
						kind: "unknown_tool",
						error: `Unknown tool: ${name}`,
					};
				}
				if (!READ_ONLY_TOOLS.has(name)) {
					const allowed = await approveTool(name, msg.arguments || {});
					if (!allowed) {
						return {
							ok: false,
							kind: "denied",
							error: "Tool call denied by user.",
						};
					}
				}
				return bridge.callTool(
					name,
					msg.arguments || {},
					msg.timeout,
					toBridgeServerId(msg.server),
				);
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
