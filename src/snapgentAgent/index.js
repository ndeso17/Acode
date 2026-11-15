import "./style.scss";
import toast from "components/toast";
import confirm from "dialogs/confirm";
import generatePluginContext, {
	connect as connectPluginContext,
} from "lib/pluginContext";
import webview, { WebViewEvents } from "lib/webview";
import {
	clientServers,
	clientTools,
	createSnapgentBackground,
} from "./background";
import { SnapgentBridge } from "./bridge";
import { getProviderById, isTrustedProviderUrl, PROVIDERS } from "./providers";
import {
	DEFAULT_SETTINGS,
	loadPublicSettings,
	STORAGE_KEY,
	savePublicSettings,
} from "./settings";

const BUILTIN_ID = "com.snapgent.acode.agent";
const BRIDGE_TOKEN = "bridge_token";

function element(tagName, className, text) {
	const node = document.createElement(tagName);
	if (className) node.className = className;
	if (text != null) node.textContent = text;
	return node;
}

async function secretContext() {
	await connectPluginContext();
	return generatePluginContext(
		BUILTIN_ID,
		JSON.stringify({ id: BUILTIN_ID, permissions: [] }),
	);
}

export function initSnapgentAgent(container) {
	let settings = loadPublicSettings(localStorage.getItem(STORAGE_KEY));
	let ctx = null;
	let bridge = null;
	let providerView = null;
	let currentUrl = "";
	let disposed = false;

	container.classList.add("snapgent-agent-sidebar");
	const header = element("header", "snapgent-header");
	const status = element("span", "snapgent-status");
	const title = element("strong", "snapgent-title", "snapgent web agent");
	header.append(status, title);

	const body = element("div", "snapgent-body scroll");
	const intro = element(
		"p",
		"snapgent-intro",
		"Use your logged-in AI website as a coding agent. No AI API key is required.",
	);
	const providerLabel = element("label", "", "AI provider");
	const providerSelect = document.createElement("select");
	for (const provider of PROVIDERS) {
		const option = document.createElement("option");
		option.value = provider.id;
		option.textContent = provider.name;
		providerSelect.append(option);
	}
	providerSelect.value = settings.providerId;
	providerLabel.append(providerSelect);

	const openButton = element("button", "snapgent-primary", "Open web agent");
	const reconnectButton = element("button", "", "Reconnect bridge");
	const bridgeLabel = element("label", "", "Bridge WebSocket URL");
	const bridgeUrl = document.createElement("input");
	bridgeUrl.type = "url";
	bridgeUrl.value = settings.bridgeUrl;
	bridgeLabel.append(bridgeUrl);
	const tokenLabel = element("label", "", "Bridge token (encrypted)");
	const bridgeToken = document.createElement("input");
	bridgeToken.type = "password";
	bridgeToken.autocomplete = "off";
	tokenLabel.append(bridgeToken);
	const saveButton = element("button", "", "Save bridge settings");
	const note = element(
		"p",
		"snapgent-note",
		"Sign in inside the provider window. Mutating MCP tools still require your approval.",
	);
	body.append(
		intro,
		providerLabel,
		openButton,
		reconnectButton,
		bridgeLabel,
		tokenLabel,
		saveButton,
		note,
	);
	container.replaceChildren(header, body);

	function updateStatus(next) {
		status.classList.toggle("online", Boolean(next.connected));
		status.title = next.connected
			? `${next.bridgeVersion || "bridge"} · ${bridge?.catalogue.length || 0} tools`
			: next.error || "Bridge offline";
		pushStatus();
	}

	function statusObject() {
		return {
			connected: Boolean(bridge?.status.connected),
			hostReady: Boolean(bridge?.status.connected),
			transport: "websocket",
			mcpAlive: Boolean(bridge?.status.connected),
			bridgeVersion: bridge?.status.bridgeVersion || "",
			tools: clientTools(bridge?.catalogue),
			servers: clientServers(bridge?.status.servers),
			lastError: bridge?.status.error || "",
		};
	}

	function pushStatus() {
		const view = providerView;
		if (!view || view.isDestroyed) return;
		try {
			view
				.postMessage({ kind: "status", status: statusObject() })
				.catch(() => {});
		} catch {
			// The WebView went away between the check and the post.
		}
	}

	async function connectBridge() {
		bridge?.close();
		const token = ctx ? await ctx.getSecret(BRIDGE_TOKEN, "") : "";
		bridge = new SnapgentBridge({
			url: settings.bridgeUrl,
			token,
			onStatus: updateStatus,
		});
		try {
			await bridge.connect();
		} catch (error) {
			updateStatus({ connected: false, error: error.message });
		}
	}

	async function approveTool(name, args) {
		return confirm(
			"Allow snapgent tool?",
			`${name}\n\n${JSON.stringify(args, null, 2)}`,
		);
	}

	// The page handler is created once and reads the live bridge through this
	// proxy, so a reconnect does not leave it holding a closed socket.
	const bridgeProxy = {
		get catalogue() {
			return bridge?.catalogue || [];
		},
		get status() {
			return bridge?.status || { connected: false, servers: [] };
		},
		callTool: (...args) => bridge.callTool(...args),
		close: () => bridge?.close(),
		connect: () => bridge?.connect(),
	};
	const handlePageMessage = createSnapgentBackground({
		bridge: bridgeProxy,
		approveTool,
	});

	async function onProviderMessage(frame) {
		if (!providerView || providerView.isDestroyed) return;
		if (!isTrustedProviderUrl(currentUrl, settings.providerId)) return;
		let reply;
		try {
			reply = await handlePageMessage(frame);
		} catch (error) {
			// Never leave the page waiting: an unexpected host error still has to
			// produce a reply frame so the agent loop can continue.
			reply = { ok: false, error: error?.message || String(error) };
		}
		try {
			await providerView.postMessage({ cid: frame?.cid, ...reply });
		} catch {
			// The provider window was closed while the tool call was running.
		}
	}

	async function openProvider() {
		const provider = getProviderById(settings.providerId);
		if (providerView?.isDestroyed) providerView = null;
		if (!providerView) {
			providerView = await webview.create({
				mode: "fullscreen",
				title: `snapgent · ${provider.name}`,
				visible: false,
				profileName: "snapgent",
				allowNavigation: true,
				allowDownloads: false,
				javaScript: true,
				domStorage: true,
				databaseStorage: true,
				mixedContentMode: "never-allow",
				acceptThirdPartyCookies: true,
			});
			providerView.onMessage(onProviderMessage);
			providerView.on(WebViewEvents.PAGE_STARTED, ({ url }) => {
				currentUrl = url || "";
			});
			providerView.on(WebViewEvents.PAGE_FINISHED, ({ url }) => {
				currentUrl = url || "";
				pushStatus();
			});
		}
		await providerView.enableSnapgentProvider();
		await providerView.loadURL(provider.url);
		await providerView.show();
	}

	providerSelect.onchange = () => {
		settings = { ...settings, providerId: providerSelect.value };
		savePublicSettings(settings);
	};
	openButton.onclick = () =>
		openProvider().catch((error) =>
			toast(error.message || String(error), 4000),
		);
	reconnectButton.onclick = () => connectBridge();
	saveButton.onclick = async () => {
		settings = {
			...DEFAULT_SETTINGS,
			...settings,
			bridgeUrl: bridgeUrl.value.trim(),
		};
		savePublicSettings(settings);
		if (ctx) await ctx.setSecret(BRIDGE_TOKEN, bridgeToken.value.trim());
		await connectBridge();
		toast("snapgent bridge settings saved", 2500);
	};

	secretContext().then(async (value) => {
		if (disposed) return;
		ctx = value;
		bridgeToken.value = await ctx.getSecret(BRIDGE_TOKEN, "");
		await connectBridge();
	});

	return () => {
		disposed = true;
		bridge?.close();
		providerView?.destroy().catch(() => {});
	};
}

export function onSnapgentSelected() {
	// The sidebar app owns its UI; no independent header/dock panel is used.
}
