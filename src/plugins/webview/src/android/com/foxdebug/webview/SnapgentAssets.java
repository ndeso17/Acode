package com.foxdebug.webview;

import android.content.Context;
import android.util.Log;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.json.JSONObject;

/**
 * Loads the bundled snapgent extension scripts out of assets/snapgent.
 *
 * <p>The provider table mirrors snapgent's manifest.json content scripts: a
 * site provider plus the optional document-start helpers that must patch the
 * page's own globals before the site boots.
 */
final class SnapgentAssets {

  private static final String TAG = "SnapgentAssets";
  private static final String ROOT = "snapgent/";

  /** host -> provider script name (without .js). */
  private static final Map<String, String> PROVIDERS = new LinkedHashMap<>();
  /** provider script name -> document-start helpers that run in the page world. */
  private static final Map<String, List<String>> MAIN_WORLD = new HashMap<>();

  static {
    PROVIDERS.put("chat.deepseek.com", "deepseek");
    PROVIDERS.put("chatgpt.com", "chatgpt");
    PROVIDERS.put("chat.openai.com", "chatgpt");
    PROVIDERS.put("claude.ai", "claude");
    PROVIDERS.put("gemini.google.com", "gemini");
    PROVIDERS.put("www.kimi.ai", "kimi");
    PROVIDERS.put("kimi.ai", "kimi");
    PROVIDERS.put("chat.z.ai", "glm");
    PROVIDERS.put("chat.qwen.ai", "qwen");
    PROVIDERS.put("arena.ai", "arena");
    PROVIDERS.put("www.meta.ai", "meta");
    PROVIDERS.put("meta.ai", "meta");
    PROVIDERS.put("ptero.pro", "ptero");
    PROVIDERS.put("grok.com", "grok");
    PROVIDERS.put("chat.mistral.ai", "mistral");

    MAIN_WORLD.put("chatgpt", Collections.singletonList("chatgpt-cm"));
    MAIN_WORLD.put("qwen", Collections.singletonList("qwen-net"));
  }

  private static final Map<String, String> cache = new HashMap<>();

  private SnapgentAssets() {}

  static Set<String> hosts() {
    return Collections.unmodifiableSet(new LinkedHashSet<>(PROVIDERS.keySet()));
  }

  /** Distinct provider script names, in manifest order. */
  static Set<String> providers() {
    return Collections.unmodifiableSet(new LinkedHashSet<>(PROVIDERS.values()));
  }

  /** Origins for one provider, used to scope document-start registration. */
  static Set<String> originsFor(String provider) {
    Set<String> origins = new LinkedHashSet<>();
    for (Map.Entry<String, String> entry : PROVIDERS.entrySet()) {
      if (entry.getValue().equals(provider)) {
        origins.add("https://" + entry.getKey());
      }
    }
    return origins;
  }

  static Set<String> allOrigins() {
    Set<String> origins = new LinkedHashSet<>();
    for (String host : PROVIDERS.keySet()) origins.add("https://" + host);
    return origins;
  }

  /** Provider name for a page url, or null when the host is not supported. */
  static String providerForUrl(String url) {
    if (url == null) return null;
    try {
      String host = android.net.Uri.parse(url).getHost();
      return host != null ? PROVIDERS.get(host) : null;
    } catch (Exception e) {
      return null;
    }
  }

  /**
   * The document-start payload shared by every provider: the chrome.* shim and
   * overlay.css. The CSS is functional, not cosmetic: its .zs-hidden and
   * .zs-tool-hide rules are what keep the system prompt and raw tool JSON out
   * of the visible chat.
   */
  static String commonScript(Context context) {
    StringBuilder builder = new StringBuilder();
    builder.append(read(context, "shim.js"));
    String css = read(context, "overlay.css");
    if (!css.isEmpty()) {
      builder.append("\n;\n").append(styleTag(css));
    }
    return builder.toString();
  }

  /** Document-start helpers for one provider (chatgpt-cm.js, qwen-net.js). */
  static String documentStartProviderScript(Context context, String provider) {
    StringBuilder builder = new StringBuilder();
    for (String name : MAIN_WORLD.getOrDefault(provider, Collections.emptyList())) {
      String script = read(context, "providers/" + name + ".js");
      if (!script.isEmpty()) builder.append("\n;\n").append(script);
    }
    return builder.toString();
  }

  /**
   * document_idle payload: config -> parser -> provider -> main, the same order
   * snapgent's manifest lists them. The whole payload is wrapped in a once-only
   * guard because main.js installs timers and a UI bar.
   */
  static String documentIdleScript(Context context, String provider) {
    List<String> parts = new ArrayList<>();
    for (String rel : Arrays.asList(
      "core/config.js",
      "core/parser.js",
      "providers/" + provider + ".js",
      "core/main.js"
    )) {
      String script = read(context, rel);
      if (script.isEmpty()) {
        Log.w(TAG, "Missing snapgent asset: " + rel);
        return "";
      }
      parts.add(script);
    }

    StringBuilder builder = new StringBuilder();
    builder.append("(function(){");
    builder.append("if(window.__zsInjected){return;}window.__zsInjected=true;");
    builder.append("try{");
    for (String part : parts) builder.append(part).append("\n;\n");
    builder.append("}catch(e){window.__zsInjected=false;");
    builder.append("console.error('[snapgent] inject failed',e);}");
    builder.append("})();");
    return builder.toString();
  }

  static String read(Context context, String path) {
    String key = ROOT + path;
    synchronized (cache) {
      String cached = cache.get(key);
      if (cached != null) return cached;
    }

    StringBuilder builder = new StringBuilder();
    try (
      BufferedReader reader = new BufferedReader(
        new InputStreamReader(context.getAssets().open(key), "UTF-8")
      )
    ) {
      char[] buffer = new char[8192];
      int read;
      while ((read = reader.read(buffer)) != -1) {
        builder.append(buffer, 0, read);
      }
    } catch (Exception e) {
      Log.w(TAG, "Could not read asset " + key + ": " + e.getMessage());
    }

    String value = builder.toString();
    synchronized (cache) {
      cache.put(key, value);
    }
    return value;
  }

  /**
   * overlay.css is 55 KB and contains backticks, so it is embedded through a
   * JSON-quoted string. The install is retried because document_start runs
   * before the parser has necessarily created <head>.
   */
  private static String styleTag(String css) {
    StringBuilder builder = new StringBuilder();
    builder.append("(function(){");
    builder.append("var css=").append(JSONObject.quote(css)).append(";");
    builder.append("function install(){try{");
    builder.append("if(document.querySelector('style[data-zs=\"overlay\"]'))return true;");
    builder.append("var root=document.head||document.documentElement;");
    builder.append("if(!root)return false;");
    builder.append("var s=document.createElement('style');");
    builder.append("s.setAttribute('data-zs','overlay');");
    builder.append("s.textContent=css;");
    builder.append("root.appendChild(s);return true;");
    builder.append("}catch(e){return false;}}");
    builder.append("if(!install()){");
    builder.append("var n=0;var t=setInterval(function(){if(install()||++n>200)clearInterval(t);},10);");
    builder.append("try{document.addEventListener('DOMContentLoaded',install,{once:true});}catch(e){}");
    builder.append("}");
    builder.append("})();");
    return builder.toString();
  }
}
