# Built-in snapgent web agent

This fork adds snapgent to Acode as a built-in **sidebar app**. It is part of the
app bundle, not an installable Acode plugin.

snapgent's premise is that you already pay for an AI website. The agent therefore
drives **your logged-in ChatGPT / Claude / DeepSeek / Gemini / Kimi / GLM / Qwen /
Arena / Meta AI / Ptero / Grok / Mistral session** instead of asking for an API
key. No AI API key is required at any point.

## UI

Open the sidebar (top-left menu icon) and tap the **chat bubble** icon. Snapgent
is a real sidebar app: it owns its panel, remembers the last selection, and
replaces the sidebar content like the Files or Extensions apps do. There is no
button in the editor header any more.

The panel contains:

- a provider picker (the twelve supported websites);
- **Open web agent**, which launches the provider in a fullscreen WebView;
- bridge status, bridge URL, and the encrypted bridge token;
- a note that mutating MCP tools still ask for approval.

## Data flow

```text
Acode sidebar (provider picker, bridge settings)
  -> fullscreen managed WebView, profile "snapgent" (persistent cookies)
  -> snapgent extension scripts injected into the AI website
       shim.js (chrome.* over window.webview)
       overlay.css
       core/config.js -> core/parser.js -> providers/<site>.js -> core/main.js
  -> chrome.runtime messages routed back to the Acode host
  -> Acode host validates them (type allow-list, tool-name allow-list, approval)
  -> native Cordova WebSocket, authenticated with the bridge token
  -> snapgent bridge at ws://127.0.0.1:17613
  -> android_mcp.py workspace + Acode control tools
       -> authenticated loopback Acode control endpoint (interrupts)
       -> open/focus a changed file, run an allowed editor command, or notify
  -> tool result fed back into the website chat
```

The provider page never sees the bridge token. Only the Acode host owns the
socket, and it accepts only `status`, `list_tools`, `call_tool`, and `reconnect`
from the page.

### Acode target and interrupts

The Android bridge still calls its MCP process `android`, but the built-in host
presents it to the provider as the **Acode** target (`acode`). Tool calls are
mapped back to `android` before crossing the authenticated bridge. When an old
profile still has the desktop default `vscode` selected and the bridge reports
only the Android server, the target heals to Acode automatically. This prevents
the stale **VS Code unavailable** state without overriding a target the user
selected deliberately.

Acode starts an authenticated loopback control endpoint during app startup, even
if the snapgent sidebar has never been opened. It publishes a random per-launch
token and port in `/storage/emulated/0/.snapgent/acode-control.json`; the token is
required on every request. `android_mcp.py` exposes four editor-facing tools:

- `acode_status` checks that the running editor can receive an interrupt;
- `acode_open_file` opens/focuses a workspace file, optionally at a line/column;
- `acode_run_command` runs a small allow-list of editor commands;
- `acode_notify` shows a toast or alert inside Acode.

The control endpoint accepts loopback callers only. File paths are validated by
the MCP workspace guard before Acode receives them, and an open tab with unsaved
changes is never discarded by `acode_open_file`.

### Script injection

`WebViewInstance.enableSnapgentProvider()` registers the bundled scripts with
`WebViewCompat.addDocumentStartJavaScript`, restricted to the allow-listed
provider origins:

- the `chrome.*` shim and `overlay.css` run at document start on every provider
  host (the CSS is functional: it hides the system prompt and raw tool JSON);
- `chatgpt-cm.js` and `qwen-net.js` run at document start on their own host only;
- the agent core is injected on page finished, once per page, after the shim is
  prepended again. The shim keeps its state on `window.__zsShimState` and
  rebinds the transport instead of returning early, so the second install is
  harmless but guarantees the core finds `chrome.*` in the world it runs in.

Assets live in `src/plugins/webview/assets/snapgent/`; see the README there for
how to refresh them from the snapgent checkout.

## Settings

| Setting | Default | Where |
|---|---|---|
| Provider | ChatGPT | `localStorage.snapgentAgentSettings` |
| Bridge URL | `ws://127.0.0.1:17613` | `localStorage.snapgentAgentSettings` |
| Bridge token | empty | native `EncryptedPreferenceManager` under `com.snapgent.acode.agent` |

## Safety

- Provider navigation is allow-listed per host; the host router ignores page
  messages unless the current top-level URL is an HTTPS page on the selected
  provider's host.
- The runtime message allow-list rejects anything else, including MCP server
  management (`add_server`, `remove_server`).
- Every `call_tool` name must exist in the live bridge catalogue.
- Read-only tools (`read_file`, `list_dir`, `search_files`, `acode_status`, …)
  run directly. Mutating, device-control, and active Acode interrupt tools ask
  for confirmation first.
- The bridge remains the workspace security boundary: its `ZS_WORKSPACE` setting
  controls which files the agent can reach.

## Provider caveats

- Google blocks OAuth in embedded WebViews, so Gemini sign-in may fail. Prefer
  email/password login, or a different provider.
- The provider DOM selectors were tuned against desktop layouts; mobile layouts
  may need provider-specific fixes.
- ChatGPT's long CodeMirror replies rely on the document-start helper; on
  WebView providers without `DOCUMENT_START_SCRIPT` the shim is re-installed
  from the page-finished injection instead (it is idempotent), and long edits
  may truncate.

See `docs/SNAPGENT_MANUAL_TEST.md` for the on-device checklist that covers
login, a full tool loop, approval, and the storage prompts.

## Build

Initialize the submodule before installing dependencies:

```sh
git submodule update --init --depth 1
npm ci --no-audit --no-fund
export ANDROID_HOME=/root/android-sdk
export ANDROID_SDK_ROOT=/root/android-sdk
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-arm64
npm run build -- paid d
```

The fork uses package id `com.snapgent.acode`, so it can coexist with the
upstream `com.foxdebug.acode` app.

## Tests

```sh
VITE_CONFIG_NATIVE_IGNORE_WARNING=true npx vitest run \
  tests/unit/snapgentWebProvider.test.js \
  tests/unit/snapgentBackground.test.js \
  tests/unit/snapgentBridge.test.js \
  tests/unit/fileBrowserStorage.test.js \
  tests/unit/documentsAuthority.test.js
```

## Storage access on Android 11+

Acode manages `/storage/emulated/0` through SAF plus optional all-files access:

- `MANAGE_EXTERNAL_STORAGE` is declared in `config.xml`, so the "All File
  Access" item in terminal settings works and the file browser can show a
  **Allow access to /storage/emulated/0** entry when it is not granted;
- the file browser lists primary shared storage even though Android reports a
  null `StorageVolume` UUID (`SDcard.java` uses a synthetic `primary` id);
- raw `file://` paths are only used when all-files access is actually granted,
  otherwise the entry falls back to a SAF picker;
- the primary volume is skipped when its path matches the synthetic
  `Internal storage` entry, so the root is not listed twice;
- SAF cannot grant the root of shared storage on Android 11+; select a project
  subfolder, or grant all-files access.
