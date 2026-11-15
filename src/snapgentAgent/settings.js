import { DEFAULT_PROVIDER_ID, getProviderById } from "./providers";

export const STORAGE_KEY = "snapgentAgentSettings";
export const DEFAULT_SETTINGS = Object.freeze({
	providerId: DEFAULT_PROVIDER_ID,
	bridgeUrl: "ws://127.0.0.1:17613",
});

export function loadPublicSettings(raw) {
	let value = {};
	try {
		value = raw ? JSON.parse(raw) : {};
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
	const providerId = getProviderById(value?.providerId).id;
	return {
		...DEFAULT_SETTINGS,
		...(value && typeof value === "object" ? value : {}),
		providerId,
	};
}

export function savePublicSettings(value) {
	localStorage.setItem(
		STORAGE_KEY,
		JSON.stringify({
			...value,
			providerId: getProviderById(value?.providerId).id,
		}),
	);
}
