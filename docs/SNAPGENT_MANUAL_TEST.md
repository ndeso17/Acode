# snapgent Acode — manual test on the phone

Everything below needs a real device: provider login, the Android SAF picker and
the WebView DOM all behave differently from a desktop browser. The debug APK is
`platforms/android/app/build/outputs/apk/debug/app-debug.apk`
(package `com.snapgent.acode`, label `Acode + snapgent`), so it installs next to
the official `com.foxdebug.acode`.

## 0. Before installing

1. Start the bridge on the phone (Termux):

   ```sh
   cd ~/snapgent-connector
   python3 bridge.py            # prints the token, listens on 127.0.0.1:17613
   ```

   Keep `ZS_WORKSPACE` pointed at the folder the agent may edit.

2. Install the APK:

   ```sh
   adb install -r app-debug.apk
   ```

## 1. Sidebar entry point

- [ ] Open Acode. The header shows `Acode + snapgent` with **only** the menu
      button on the right — there is no chat icon in the header.
- [ ] Tap the menu icon (top-left) to open the sidebar.
- [ ] A **chat bubble** icon is present at the bottom of the sidebar rail.
- [ ] Tap it: the panel shows the provider picker, *Open web agent*, *Reconnect
      bridge*, the bridge URL and token fields, and the approval note.
- [ ] Kill and reopen the app: the sidebar reopens on the snapgent panel
      (last section is remembered).

## 2. Bridge settings

- [ ] Paste the bridge token from `bridge.py`, tap **Save bridge settings**.
- [ ] The dot in the panel header turns green and the tooltip shows the bridge
      version and tool count (36 tools for the `android` server).
- [ ] Stop `bridge.py`, tap **Reconnect bridge**: the dot turns red and the
      tooltip shows the connection error. Restart the bridge and reconnect
      again — green.

## 3. Provider login

- [ ] Pick a provider, tap **Open web agent**. The site opens fullscreen with
      the normal mobile layout.
- [ ] Sign in. The `snapgent` WebView profile keeps the cookie, so reopening the
      agent stays logged in.
- [ ] The snapgent bar appears in the page and reports `ext v3.9.5`.
- [ ] Repeat for at least one second provider (e.g. DeepSeek, Kimi, GLM).
- [ ] Known failure: Gemini's Google OAuth usually refuses an embedded WebView.
      Use email/password if offered, otherwise test with another provider.

## 4. One full tool loop

- [ ] In the agent bar, ask something that needs a read, e.g.
      *"list the files in the workspace and read README.md"*.
- [ ] `list_files` / `read_file` run without a prompt (read-only allow-list).
- [ ] Ask for a write, e.g. *"create notes/snapgent-test.txt with the word ok"*.
      Acode shows an **Allow snapgent tool?** dialog with the tool name and its
      arguments. Deny once: the page reports the denial and the model adapts.
- [ ] Approve on the retry: the file appears on disk.
- [ ] Confirm the system prompt and raw tool JSON never appear as visible chat
      text (the overlay CSS hides them behind the chips).

## 5. Storage access

- [ ] Open the file browser. On Android 11+ without all-files access, the list
      shows **Allow access to /storage/emulated/0** instead of *Internal
      storage*.
- [ ] Tap it: Android's *All files access* screen opens for
      `Acode + snapgent`. Enable it and come back — the file browser reloads on
      `resume` and now lists **Internal storage** once (no duplicate entry).
- [ ] Browse `/storage/emulated/0`, open a folder, create/rename/delete a file.
- [ ] With all-files access **revoked** in system settings, the entry disappears
      again and no raw `file://` path is used.

## 6. Folder picker (SAF)

- [ ] Add a folder via *Add path* / the folder picker, choose a project
      subfolder (e.g. `Download/project`).
- [ ] The folder opens and files are listed.
- [ ] Picking the storage root `/storage/emulated/0` itself is refused by
      Android on 11+ — that is expected; use all-files access for the root.

## 7. Coexistence

- [ ] The official Acode (`com.foxdebug.acode`) is still installed and launches.
- [ ] Both apps keep separate settings, sidebars and WebView profiles.

## What to report if something fails

- Which provider, and whether the snapgent bar (`ext v3.9.5`) appeared at all.
- Whether the green dot was online before the failing step.
- `adb logcat -s chromium AcodeWebView SnapgentAssets` output for injection
  problems, and `adb logcat | grep -i snapgent` for the page-side messages.
- A screenshot of the agent bar and of the file browser storage list.
