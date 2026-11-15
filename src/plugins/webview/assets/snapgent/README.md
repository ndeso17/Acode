# snapgent web-provider assets

These files are a verbatim copy of the snapgent browser extension. They are
injected into the provider WebView by `WebViewInstance` when
`enableSnapgentProvider()` was called, which lets a logged-in AI website drive
the MCP bridge without any API key.

| Path | Source |
| --- | --- |
| `shim.js` | Acode adaptation of `snapgent/android/.../assets/shim.js`; transport is `window.webview` instead of the native message listener |
| `overlay.css` | `snapgent-extension/overlay.css` |
| `core/config.js` | `snapgent-extension/core/config.js` |
| `core/parser.js` | `snapgent-extension/core/parser.js` |
| `core/main.js` | `snapgent-extension/core/main.js` |
| `providers/*.js` | `snapgent-extension/providers/*.js` |

Upstream version: 3.9.5.

## Refreshing

Re-copy everything except `shim.js` from the snapgent connector checkout, then
keep the `shim.js` transport block intact:

```sh
SRC=/path/to/snapgent-connector/snapgent-extension
DST=src/plugins/webview/assets/snapgent
cp "$SRC"/core/*.js "$DST"/core/
cp "$SRC"/providers/*.js "$DST"/providers/
cp "$SRC"/overlay.css "$DST"/
```

Hosts are allow-listed in two places that must stay in sync:

- `src/plugins/webview/src/android/com/foxdebug/webview/SnapgentAssets.java`
  (which provider script to inject, and on which origins)
- `src/snapgentAgent/providers.js` (the provider picker and host validation)
