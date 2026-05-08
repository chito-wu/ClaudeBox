import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

const DEBUG_LABEL = "debug";

/**
 * Open the standalone debug-log window. Reuses an existing window if it's
 * already open (focuses it instead of spawning a duplicate).
 *
 * The new window loads the same React entry with a `#debug` hash so App.tsx
 * routes it to a full-screen DebugPanel without booting the rest of the app.
 */
export async function openDebugWindow(): Promise<void> {
  const existing = await WebviewWindow.getByLabel(DEBUG_LABEL);
  if (existing) {
    try {
      await existing.unminimize();
      await existing.show();
      await existing.setFocus();
      return;
    } catch {
      // Existing handle might be stale (window destroyed mid-flight) — fall through
    }
  }
  const win = new WebviewWindow(DEBUG_LABEL, {
    url: "index.html#debug",
    title: "ClaudeBox 日志",
    width: 900,
    height: 600,
    minWidth: 480,
    minHeight: 320,
    resizable: true,
    decorations: true,
    center: true,
  });
  win.once("tauri://error", (e) => console.error("[debug-window]", e));
}
