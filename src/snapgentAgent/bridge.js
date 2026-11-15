const REQUEST_TIMEOUT_MS = 130_000;

function nativeSocket(url) {
	if (globalThis.cordova?.websocket?.connect) {
		return globalThis.cordova.websocket.connect(url);
	}
	return Promise.resolve(new WebSocket(url));
}

export class SnapgentBridge {
	constructor({ url, token, connectSocket = nativeSocket, onStatus = () => {} }) {
		this.url = url;
		this.token = token;
		this.connectSocket = connectSocket;
		this.onStatus = onStatus;
		this.socket = null;
		this.nextId = 1;
		this.pending = new Map();
		this.catalogue = [];
		this.status = { connected: false, bridgeVersion: "", servers: [], error: "" };
	}

	async connect() {
		if (this.status.connected) return this.status;
		const socket = await this.connectSocket(this.url);
		this.socket = socket;
		return new Promise((resolve, reject) => {
			let settled = false;
			const fail = (error) => {
				this.publish({ connected: false, error: error?.message || "Bridge offline." });
				this.failPending(this.status.error);
				if (!settled) {
					settled = true;
					reject(new Error(this.status.error));
				}
			};
			socket.addEventListener("open", () => {
				socket.send(JSON.stringify({ type: "auth", token: this.token || "" }));
			});
			socket.addEventListener("message", (event) => {
				let frame;
				try {
					frame = JSON.parse(event.data);
				} catch {
					return;
				}
				if (frame.type === "error" && frame.id == null) {
					fail(new Error(frame.error || "Bridge rejected the connection."));
					return;
				}
				if (frame.id != null && this.pending.has(frame.id)) {
					const entry = this.pending.get(frame.id);
					this.pending.delete(frame.id);
					clearTimeout(entry.timer);
					entry.resolve(this.normalizeReply(frame));
					return;
				}
				if (["connected", "tools", "mcp_status"].includes(frame.type)) {
					if (Array.isArray(frame.tools)) this.catalogue = frame.tools;
					this.publish({
						connected: true,
						bridgeVersion: frame.bridge_version || this.status.bridgeVersion,
						servers: frame.servers || this.status.servers,
						error: "",
					});
					if (!settled) {
						settled = true;
						resolve(this.status);
					}
				}
			});
			socket.addEventListener("error", (event) => fail(event));
			socket.addEventListener("close", () => {
				this.publish({ connected: false, error: "Bridge connection closed." });
				this.failPending(this.status.error);
				if (!settled) {
					settled = true;
					reject(new Error(this.status.error));
				}
			});
		});
	}

	callTool(name, args, timeout = 120_000, server) {
		if (!this.socket || !this.status.connected) {
			return Promise.resolve({
				ok: false,
				kind: "disconnected",
				error: this.status.error || "Bridge offline.",
			});
		}
		const id = this.nextId++;
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				resolve({ ok: false, kind: "timeout", error: "Bridge did not respond in time." });
			}, REQUEST_TIMEOUT_MS);
			this.pending.set(id, { resolve, timer });
			this.socket.send(
				JSON.stringify({
					id,
					type: "call_tool",
					name,
					arguments: args || {},
					timeout,
					...(server ? { server } : {}),
				}),
			);
		});
	}

	close() {
		this.socket?.close(1000, "bye");
		this.socket = null;
		this.publish({ connected: false, error: "" });
		this.failPending("Bridge closed.");
	}

	normalizeReply(frame) {
		if (frame.type !== "tool_result") return frame;
		return frame.ok
			? { ok: true, text: frame.text || "", images: frame.images || [] }
			: {
					ok: false,
					kind: frame.kind || "tool_error",
					error: frame.error || "Tool failed.",
				};
	}

	failPending(reason) {
		for (const { resolve, timer } of this.pending.values()) {
			clearTimeout(timer);
			resolve({ ok: false, kind: "disconnected", error: reason });
		}
		this.pending.clear();
	}

	publish(update) {
		this.status = { ...this.status, ...update };
		this.onStatus(this.status);
	}
}
