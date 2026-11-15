/**
 * Storage list helpers for the file browser.
 *
 * On Android 11+ a raw `file://` path under /storage/emulated/0 is only
 * readable when the app holds all-files access (MANAGE_EXTERNAL_STORAGE).
 * Without it the browser must fall back to the SAF url the user picked, so the
 * decision is kept in one place instead of inline in the UI.
 */

/**
 * @param {{path?: string, url?: string, uri?: string}} storage
 * @param {boolean} hasStorageManager
 * @returns {string} url for the storage entry, empty when it needs SAF picking
 */
export function resolveStorageUrl(storage, hasStorageManager) {
	const entry = storage || {};
	const path = String(entry.path || "");
	if (path && hasStorageManager) return `file://${path}`;
	return entry.url || entry.uri || "";
}

/** Trailing-slash-insensitive form used to detect duplicate storage entries. */
export function normalizeStorageUrl(url) {
	return String(url || "").replace(/\/+$/, "");
}

/**
 * Shared storage is hidden on Android 11+ unless all-files access was granted,
 * because a raw path would be unreadable and the SAF picker cannot grant the
 * root of /storage/emulated/0.
 *
 * @param {{sdkInt?: number, hasInternalStorage?: boolean, hasStorageManager?: boolean}} options
 * @returns {boolean}
 */
export function shouldShowInternalStorage({
	sdkInt,
	hasInternalStorage = false,
	hasStorageManager = false,
}) {
	const sdk = Number(sdkInt) || 0;
	if (sdk >= 30) return Boolean(hasStorageManager);
	if (sdk === 29) return Boolean(hasInternalStorage);
	return true;
}
