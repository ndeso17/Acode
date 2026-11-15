import { describe, expect, it, vi } from "vitest";
import {
	createMemoryStore,
	createSnapgentBackground,
} from "../../src/snapgentAgent/background";

describe("snapgent provider background", () => {
	it("mediates mutating tools through user approval", async () => {
		const bridge = {
			catalogue: [{ name: "write_file" }],
			status: { connected: true, bridgeVersion: "3.9.5", servers: [] },
			callTool: vi.fn(),
		};
		const approveTool = vi.fn().mockResolvedValue(false);
		const handle = createSnapgentBackground({
			bridge,
			approveTool,
			store: createMemoryStore(),
		});
		const result = await handle({
			kind: "runtime",
			msg: { type: "call_tool", name: "write_file", arguments: { path: "x" } },
		});

		expect(approveTool).toHaveBeenCalledWith("write_file", { path: "x" });
		expect(bridge.callTool).not.toHaveBeenCalled();
		expect(result.reply.kind).toBe("denied");
	});

	it("runs read-only tools without prompting", async () => {
		const bridge = {
			catalogue: [{ name: "read_file" }],
			status: { connected: true, bridgeVersion: "3.9.5", servers: [] },
			callTool: vi.fn().mockResolvedValue({ ok: true, text: "hi" }),
		};
		const approveTool = vi.fn();
		const handle = createSnapgentBackground({
			bridge,
			approveTool,
			store: createMemoryStore(),
		});
		const result = await handle({
			kind: "runtime",
			msg: { type: "call_tool", name: "read_file", arguments: { path: "a" } },
		});

		expect(approveTool).not.toHaveBeenCalled();
		expect(result.reply).toEqual({ ok: true, text: "hi" });
	});

	it("exposes the Android MCP server as the Acode target and maps calls back", async () => {
		const bridge = {
			catalogue: [{ name: "read_file", server: "android" }],
			status: {
				connected: true,
				servers: [{ id: "android", alive: true, tools: 40 }],
			},
			callTool: vi.fn().mockResolvedValue({ ok: true, text: "ok" }),
		};
		const handle = createSnapgentBackground({
			bridge,
			approveTool: vi.fn(),
			store: createMemoryStore(),
		});

		const listed = await handle({
			kind: "runtime",
			msg: { type: "list_tools" },
		});
		expect(listed.reply.servers).toEqual([
			expect.objectContaining({ id: "acode", name: "Acode", tools: 40 }),
		]);
		expect(listed.reply.tools).toEqual([
			expect.objectContaining({ name: "read_file", server: "acode" }),
		]);

		await handle({
			kind: "runtime",
			msg: {
				type: "call_tool",
				name: "read_file",
				server: "acode",
				arguments: { path: "a" },
			},
		});
		expect(bridge.callTool).toHaveBeenCalledWith(
			"read_file",
			{ path: "a" },
			undefined,
			"android",
		);
	});

	it("never exposes arbitrary runtime operations", async () => {
		const bridge = {
			catalogue: [],
			status: { connected: false, servers: [] },
		};
		const handle = createSnapgentBackground({
			bridge,
			approveTool: vi.fn(),
			store: createMemoryStore(),
		});
		const result = await handle({
			kind: "runtime",
			msg: { type: "add_server" },
		});
		expect(result.reply).toMatchObject({
			ok: false,
			error: expect.stringMatching(/unsupported/i),
		});
	});

	it("persists page storage between handler calls", async () => {
		const store = createMemoryStore();
		const bridge = { catalogue: [], status: { connected: false, servers: [] } };
		const handle = createSnapgentBackground({
			bridge,
			approveTool: vi.fn(),
			store,
		});

		await handle({ kind: "storageSet", items: { target: "android" } });
		const result = await handle({ kind: "storageGet", keys: ["target"] });

		expect(result.value).toEqual({ target: "android" });
	});
});
