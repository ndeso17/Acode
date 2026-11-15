export const PROVIDERS = Object.freeze([
	{ id: "chatgpt", name: "ChatGPT", url: "https://chatgpt.com/", hosts: ["chatgpt.com", "chat.openai.com"], script: "chatgpt" },
	{ id: "claude", name: "Claude", url: "https://claude.ai/", hosts: ["claude.ai"], script: "claude" },
	{ id: "deepseek", name: "DeepSeek", url: "https://chat.deepseek.com/", hosts: ["chat.deepseek.com"], script: "deepseek" },
	{ id: "gemini", name: "Gemini", url: "https://gemini.google.com/", hosts: ["gemini.google.com"], script: "gemini" },
	{ id: "kimi", name: "Kimi", url: "https://www.kimi.ai/", hosts: ["www.kimi.ai", "kimi.ai"], script: "kimi" },
	{ id: "glm", name: "GLM", url: "https://chat.z.ai/", hosts: ["chat.z.ai"], script: "glm" },
	{ id: "qwen", name: "Qwen", url: "https://chat.qwen.ai/", hosts: ["chat.qwen.ai"], script: "qwen" },
	{ id: "arena", name: "Arena", url: "https://arena.ai/", hosts: ["arena.ai"], script: "arena" },
	{ id: "meta", name: "Meta AI", url: "https://www.meta.ai/", hosts: ["www.meta.ai", "meta.ai"], script: "meta" },
	{ id: "ptero", name: "Ptero", url: "https://ptero.pro/", hosts: ["ptero.pro"], script: "ptero" },
	{ id: "grok", name: "Grok", url: "https://grok.com/", hosts: ["grok.com"], script: "grok" },
	{ id: "mistral", name: "Mistral", url: "https://chat.mistral.ai/", hosts: ["chat.mistral.ai"], script: "mistral" },
]);

export const DEFAULT_PROVIDER_ID = "chatgpt";

export function getProviderById(id) {
	return PROVIDERS.find((provider) => provider.id === id) || PROVIDERS[0];
}

export function isTrustedProviderUrl(value, providerId) {
	try {
		const url = new URL(value);
		const provider = getProviderById(providerId);
		return url.protocol === "https:" && provider.hosts.includes(url.hostname);
	} catch {
		return false;
	}
}
