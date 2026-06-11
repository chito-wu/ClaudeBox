import { useState, useEffect, useCallback, useRef } from "react";
import { listDir, revealInFinder, type DirEntry } from "../../lib/claude-ipc";
import { useChatStore } from "../../stores/chatStore";
import { useT } from "../../lib/i18n";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FileText,
  FileCode,
  FileJson,
  Image,
  File,
  RefreshCw,
  GitBranch,
  MessageSquarePlus,
} from "lucide-react";

// ── File icons ───────────────────────────────────────────────────────

const EXT_ICONS: Record<string, React.ReactNode> = {
  ts: <FileCode size={14} className="text-blue-400" />,
  tsx: <FileCode size={14} className="text-blue-400" />,
  js: <FileCode size={14} className="text-yellow-400" />,
  jsx: <FileCode size={14} className="text-yellow-400" />,
  json: <FileJson size={14} className="text-yellow-600" />,
  md: <FileText size={14} className="text-text-muted" />,
  css: <FileCode size={14} className="text-purple-400" />,
  html: <FileCode size={14} className="text-orange-400" />,
  rs: <FileCode size={14} className="text-orange-500" />,
  go: <FileCode size={14} className="text-cyan-400" />,
  py: <FileCode size={14} className="text-green-400" />,
  png: <Image size={14} className="text-pink-400" />,
  jpg: <Image size={14} className="text-pink-400" />,
  svg: <Image size={14} className="text-pink-400" />,
};

function getFileIcon(name: string): React.ReactNode {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return EXT_ICONS[ext] || <File size={14} className="text-text-muted" />;
}

// ── Context menu ─────────────────────────────────────────────────────

interface ContextMenuState {
  x: number;
  y: number;
  entry: DirEntry;
}

function ContextMenu({ menu, onClose, onShowDiff, onAddToChat }: {
  menu: ContextMenuState;
  onClose: () => void;
  onShowDiff: () => void;
  onAddToChat?: (path: string, isDir: boolean) => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const handleReveal = useCallback(() => {
    revealInFinder(menu.entry.path).catch(() => {});
    onClose();
  }, [menu.entry.path, onClose]);

  const handleShowDiff = useCallback(() => {
    onClose();
    onShowDiff();
  }, [onClose, onShowDiff]);

  const handleAddToChat = useCallback(() => {
    onAddToChat?.(menu.entry.path, menu.entry.is_dir);
    onClose();
  }, [onAddToChat, menu.entry.path, menu.entry.is_dir, onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[160px] rounded-lg border border-border bg-bg-secondary shadow-xl py-1 animate-fade-in"
      style={{ left: menu.x, top: menu.y }}
    >
      {onAddToChat && (
        <>
          <button
            onClick={handleAddToChat}
            className="w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:bg-accent/10 hover:text-text-primary transition-colors flex items-center gap-2"
          >
            <MessageSquarePlus size={11} />
            {t("files.addToChat")}
          </button>
          <div className="my-1 border-t border-border/50" />
        </>
      )}
      <button
        onClick={handleReveal}
        className="w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:bg-accent/10 hover:text-text-primary transition-colors"
      >
        {menu.entry.is_dir ? t("files.openInFinder") : t("files.revealInFinder")}
      </button>
      <div className="my-1 border-t border-border/50" />
      <button
        onClick={handleShowDiff}
        className="w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:bg-accent/10 hover:text-text-primary transition-colors flex items-center gap-2"
      >
        <GitBranch size={11} />
        {t("session.viewDiff")}
      </button>
    </div>
  );
}

// ── TreeNode ──────────────────────────────────────────────────────────

function TreeNode({
  entry,
  depth,
  changedFiles,
  onFileSelect,
  onContextMenu,
  onAddToChat,
}: {
  entry: DirEntry;
  depth: number;
  changedFiles: Set<string>;
  onFileSelect?: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, entry: DirEntry) => void;
  onAddToChat?: (path: string, isDir: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<DirEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const t = useT();

  const toggle = useCallback(async () => {
    if (!entry.is_dir) { onFileSelect?.(entry.path); return; }
    if (!expanded && children === null) {
      setLoading(true);
      try { setChildren(await listDir(entry.path)); }
      catch { setChildren([]); }
      setLoading(false);
    }
    setExpanded(!expanded);
  }, [entry, expanded, children, onFileSelect]);

  const isChanged = entry.is_dir
    ? [...changedFiles].some((f) => f.startsWith(entry.path + "/"))
    : changedFiles.has(entry.path);

  return (
    <div>
      <button
        onClick={toggle}
        onContextMenu={(e) => onContextMenu(e, entry)}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(
            "application/x-claudebox-file",
            JSON.stringify({ path: entry.path, isDir: entry.is_dir }),
          );
          e.dataTransfer.setData("text/plain", entry.path);
          e.dataTransfer.effectAllowed = "copy";
        }}
        className={`flex items-center gap-1.5 w-full text-left py-1 pr-2 text-xs
                    hover:bg-accent/10 active:bg-accent/15 transition-colors rounded-sm
                    ${entry.is_dir ? "text-text-primary" : "text-text-secondary hover:text-text-primary"}`}
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
      >
        {entry.is_dir ? (
          <>
            {expanded
              ? <ChevronDown size={12} className="text-text-muted flex-shrink-0" />
              : <ChevronRight size={12} className="text-text-muted flex-shrink-0" />}
            <Folder size={14} className="text-accent/70 flex-shrink-0" />
          </>
        ) : (
          <>
            <span className="w-3 flex-shrink-0" />
            {getFileIcon(entry.name)}
          </>
        )}
        <span className="flex items-center gap-1 min-w-0 flex-1">
          <span className="truncate">{entry.name}</span>
          {isChanged && (
            <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-emerald-400" title="Uncommitted changes" />
          )}
        </span>
      </button>
      {entry.is_dir && expanded && (
        <div>
          {loading && (
            <div className="flex items-center gap-1.5 py-1 text-xs text-text-muted" style={{ paddingLeft: `${(depth + 1) * 14 + 6}px` }}>
              <RefreshCw size={10} className="animate-spin" />
              {t("files.loading")}
            </div>
          )}
          {children?.map((child) => (
            <TreeNode key={child.path} entry={child} depth={depth + 1}
              changedFiles={changedFiles} onFileSelect={onFileSelect} onContextMenu={onContextMenu} onAddToChat={onAddToChat} />
          ))}
          {children?.length === 0 && !loading && (
            <div className="py-1 text-xs text-text-muted italic" style={{ paddingLeft: `${(depth + 1) * 14 + 6}px` }}>
              {t("files.empty")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── FileTree ──────────────────────────────────────────────────────────

interface FileTreeProps {
  rootPath: string;
  changedFiles?: Set<string>;
  onFileSelect?: (path: string) => void;
  refreshKey?: number;
  /** Add a file or folder to the chat input as an attachment (right-click menu). */
  onAddToChat?: (path: string, isDir: boolean) => void;
}

export default function FileTree({ rootPath, changedFiles = new Set(), onFileSelect, refreshKey, onAddToChat }: FileTreeProps) {
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const t = useT();
  const openDiffDialog = useChatStore((s) => s.openDiffDialog);
  const currentSessionId = useChatStore((s) => s.currentSessionId);

  const handleShowDiff = useCallback(() => {
    if (currentSessionId) openDiffDialog(currentSessionId);
  }, [currentSessionId, openDiffDialog]);

  const loadRoot = useCallback(async () => {
    setLoading(true);
    try { setEntries(await listDir(rootPath)); }
    catch { setEntries([]); }
    setLoading(false);
  }, [rootPath]);

  useEffect(() => { loadRoot(); }, [loadRoot, refreshKey]);

  const handleContextMenu = useCallback((e: React.MouseEvent, entry: DirEntry) => {
    e.preventDefault();
    e.stopPropagation();
    const x = Math.min(e.clientX, window.innerWidth - 180);
    const y = Math.min(e.clientY, window.innerHeight - 100);
    setContextMenu({ x, y, entry });
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-medium text-text-secondary">{t("files.title")}</span>
        <button onClick={loadRoot} className="p-1 rounded hover:bg-bg-tertiary/50 text-text-muted hover:text-text-primary transition-colors" title={t("files.refresh")}>
          <RefreshCw size={12} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {loading ? (
          <div className="flex items-center gap-2 px-3 py-4 text-xs text-text-muted">
            <RefreshCw size={12} className="animate-spin" />{t("files.loading")}
          </div>
        ) : entries.length === 0 ? (
          <div className="px-3 py-4 text-xs text-text-muted">{t("files.noFiles")}</div>
        ) : (
          entries.map((entry) => (
            <TreeNode key={entry.path} entry={entry} depth={0}
              changedFiles={changedFiles} onFileSelect={onFileSelect} onContextMenu={handleContextMenu} onAddToChat={onAddToChat} />
          ))
        )}
      </div>
      {contextMenu && (
        <ContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onShowDiff={handleShowDiff}
          onAddToChat={onAddToChat}
        />
      )}
    </div>
  );
}
