import { describe, expect, it } from "vitest";
import { SnapgentBridge } from "../../src/snapgentAgent/bridge";

class FakeSocket extends EventTarget {
	constructor() {
		super();
		this.sent = [];
		this.readyState = 0;
	}
	open() {
		this.readyState = 1;
		this.dispatchEvent(new Event("open"));
	}
	send(value) {
		this.sent.push(JSON.parse(value));
	}
	close() {
		this.readyState = 3;
		this.dispatchEvent(new Event("close"));
	}
	receive(frame) {
		this.dispatchEvent(
			new MessageEvent("message", { data: JSON.stringify(frame) }),
		);
	}
}

async function connectedBridge(socket) {
	const bridge = new SnapgentBridge({
		url: "ws://127.0.0.1:17613",
		token: "secret",
		connectSocket: async () => socket,
	});
	const connecting = bridge.connect();
	await Promise.resolve();
	socket.open();
	socket.receive({ type: "connected", tools: [], servers: [] });
	await connecting;
	return bridge;
}

describe("SnapgentBridge", () => {
	it("authenticates before requesting the tool catalogue", async () => {
		const socket = new FakeSocket();
		const bridge = new SnapgentBridge({
			url: "ws://127.0.0.1:17613",
			token: "secret",
			connectSocket: async () => socket,
		});
		const connecting = bridge.connect();
		await Promise.resolve();
		socket.open();
		socket.receive({
			type: "connected",
			bridge_version: "3.9.4",
			tools: [{ name: "read_file" }],
			servers: [{ id: "android", alive: true, tools: 36 }],
		});
		await connecting;

		expect(socket.sent[0]).toEqual({ type: "auth", token: "secret" });
		expect(bridge.catalogue).toEqual([{ name: "read_file" }]);
		expect(bridge.status.connected).toBe(true);
	});

	it("correlates a tool reply and normalizes successful content", async () => {
		const socket = new FakeSocket();
		const bridge = await connectedBridge(socket);

		const pending = bridge.callTool("read_file", { path: "README.md" });
		const request = socket.sent.at(-1);
		expect(request).toMatchObject({
			type: "call_tool",
			name: "read_file",
			arguments: { path: "README.md" },
		});
		socket.receive({
			type: "tool_result",
			id: request.id,
			ok: true,
			text: "hello",
			images: [],
		});

		await expect(pending).resolves.toEqual({
			ok: true,
			text: "hello",
			images: [],
		});
	});

	it("forwards the selected MCP server so a bare tool name is unambiguous", async () => {
		const socket = new FakeSocket();
		const bridge = await connectedBridge(socket);

		bridge.callTool("read_file", { path: "a" }, 1000, "android");
		expect(socket.sent.at(-1)).toMatchObject({
			type: "call_tool",
			name: "read_file",
			server: "android",
		});
	});

	it("rejects pending calls when the socket closes", async () => {
		const socket = new FakeSocket();
		const bridge = await connectedBridge(socket);
		const pending = bridge.callTool("read_file", { path: "README.md" });
		socket.close();
		await expect(pending).resolves.toMatchObject({ ok: false, kind: "disconnected" });
	});
});
