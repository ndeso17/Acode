/**
 * The app's own DocumentsProvider authority is `${applicationId}.documents`.
 * Hard-coding the upstream package made the fork misclassify its terminal
 * public SAF uris, so the authority is derived from the running package.
 */

export function getDocumentsAuthority(packageName) {
	const name =
		packageName ||
		globalThis.window?.BuildInfo?.packageName ||
		"com.foxdebug.acode";
	return `${name}.documents`;
}

export function isAcodeDocumentsUri(value, packageName) {
	const authority = getDocumentsAuthority(packageName);
	return String(value || "").startsWith(`content://${authority}/`);
}

/** True only for tree uris, which is what the file browser treats as folders. */
export function isAcodeDocumentsTreeUri(value, packageName) {
	return isAcodeDocumentsUri(value, packageName) && String(value).includes("/tree/");
}
