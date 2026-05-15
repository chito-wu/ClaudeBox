import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useChatStore } from "../../stores/chatStore";
import { stopSession } from "../../lib/claude-ipc";
import { formatRelativeDate } from "../../lib/utils";
import {
  FolderOpen,
  Trash2,
  Pin,
  PinOff,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { useT } from "../../lib/i18n";

interface ContextMenu {
  x: number;
  y: number;
  sessionId: string;
  projectPath: string;
  pinned: boolean;
}

interface SessionListProps {
  searchQuery?: string;
}

export default function SessionList({ searchQuery = "" }: SessionListProps) {
  const {
    sessions,
    currentSessionId,
    streamingSessions,
    switchSession,
    removeSession,
    reorderPinned,
    togglePinned,
  } = useChatStore();
  const t = useT();
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Drag-and-drop only operates on the pinned section. Indices refer to
  // positions in the pinned-only array (kept in a ref to avoid stale-closure
  // issues with onDragOver firing before the React state from onDragStart commits).
  const dragFromPinnedIdxRef = useRef<number | null>(null);
  const [dragOverPinnedIdx, setDragOverPinnedIdx] = useState<number | null>(null);
  const [dragFromPinnedIdx, setDragFromPinnedIdx] = useState<number | null>(null);

  const [pinnedCollapsed, setPinnedCollapsed] = useState(false);
  const [recentCollapsed, setRecentCollapsed] = useState(false);

  const isSearching = searchQuery.trim().length > 0;
  const matchSearch = useCallback(
    (s: { projectName: string; projectPath: string }) => {
      if (!isSearching) return true;
      const q = searchQuery.trim().toLowerCase();
      return (
        (s.projectName || "").toLowerCase().includes(q) ||
        (s.projectPath || "").toLowerCase().includes(q)
      );
    },
    [searchQuery, isSearching]
  );

  // Pinned: keep array order (manual). Recent: sort by updatedAt desc.
  const pinnedAll = useMemo(() => sessions.filter((s) => s.pinned), [sessions]);
  const recentAll = useMemo(
    () =>
      [...sessions.filter((s) => !s.pinned)].sort(
        (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
      ),
    [sessions]
  );
  const visiblePinned = useMemo(
    () => pinnedAll.filter(matchSearch),
    [pinnedAll, matchSearch]
  );
  const visibleRecent = useMemo(
    () => recentAll.filter(matchSearch),
    [recentAll, matchSearch]
  );

  // Close context menu on click outside or Escape
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [contextMenu]);

  const handleContextMenu = useCallback(
    (
      e: React.MouseEvent,
      sessionId: string,
      projectPath: string,
      pinned: boolean
    ) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY, sessionId, projectPath, pinned });
    },
    []
  );

  const handleDelete = useCallback(
    async (sessionId: string) => {
      setContextMenu(null);
      try {
        await stopSession(sessionId);
      } catch {
        // ignore
      }
      removeSession(sessionId);
    },
    [removeSession]
  );

  const handleOpenFolder = useCallback((projectPath: string) => {
    setContextMenu(null);
    shellOpen(projectPath);
  }, []);

  const handleTogglePinned = useCallback(
    (sessionId: string) => {
      setContextMenu(null);
      togglePinned(sessionId);
    },
    [togglePinned]
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent, pinnedIdx: number) => {
      if (isSearching) return;
      dragFromPinnedIdxRef.current = pinnedIdx;
      setDragFromPinnedIdx(pinnedIdx);
      e.dataTransfer.effectAllowed = "move";
      try {
        e.dataTransfer.setData("text/plain", String(pinnedIdx));
      } catch {
        // ignore
      }
    },
    [isSearching]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, pinnedIdx: number) => {
      if (isSearching) return;
      // Always preventDefault — without it the browser refuses the drop. We
      // can't gate on dragFromIdx because state from onDragStart may not have
      // committed by the first onDragOver.
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dragOverPinnedIdx !== pinnedIdx) setDragOverPinnedIdx(pinnedIdx);
    },
    [isSearching, dragOverPinnedIdx]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent, pinnedIdx: number) => {
      e.preventDefault();
      const from = dragFromPinnedIdxRef.current;
      if (from !== null && from !== pinnedIdx) {
        reorderPinned(from, pinnedIdx);
      }
      dragFromPinnedIdxRef.current = null;
      setDragFromPinnedIdx(null);
      setDragOverPinnedIdx(null);
    },
    [reorderPinned]
  );

  const handleDragEnd = useCallback(() => {
    dragFromPinnedIdxRef.current = null;
    setDragFromPinnedIdx(null);
    setDragOverPinnedIdx(null);
  }, []);

  if (sessions.length === 0) {
    return (
      <div className="flex-1 px-3 py-8 text-center text-text-muted text-sm">
        {t("session.empty")}
        <br />
        {t("session.emptyHint")}
      </div>
    );
  }

  if (visiblePinned.length === 0 && visibleRecent.length === 0) {
    return (
      <div className="flex-1 px-3 py-8 text-center text-text-muted text-sm">
        {t("session.noMatch")}
      </div>
    );
  }

  const renderItem = (
    session: typeof sessions[number],
    /** Index inside pinnedAll (used for drag), or null for recent items */
    pinnedIdx: number | null
  ) => {
    const isActive = session.id === currentSessionId;
    const isRunning = !!streamingSessions[session.id];
    const isUnread = !!session.unread && !isActive;
    const isDragging = pinnedIdx !== null && dragFromPinnedIdx === pinnedIdx;
    const isDropTarget =
      pinnedIdx !== null &&
      dragFromPinnedIdx !== null &&
      dragOverPinnedIdx === pinnedIdx &&
      dragFromPinnedIdx !== pinnedIdx;
    const draggable = pinnedIdx !== null && !isSearching;

    return (
      <div
        key={session.id}
        draggable={draggable}
        onDragStart={
          draggable ? (e) => handleDragStart(e, pinnedIdx!) : undefined
        }
        onDragOver={
          pinnedIdx !== null ? (e) => handleDragOver(e, pinnedIdx) : undefined
        }
        onDrop={pinnedIdx !== null ? (e) => handleDrop(e, pinnedIdx) : undefined}
        onDragEnd={pinnedIdx !== null ? handleDragEnd : undefined}
        onClick={() => switchSession(session.id)}
        onContextMenu={(e) =>
          handleContextMenu(e, session.id, session.projectPath, !!session.pinned)
        }
        className={`group relative flex items-center gap-2 pl-3 pr-3 py-2.5 rounded-lg mb-0.5 cursor-pointer transition-colors ${
          isActive
            ? "bg-bg-tertiary/50 text-text-primary"
            : "text-text-secondary hover:bg-bg-secondary/50 hover:text-text-primary"
        } ${isDragging ? "opacity-40" : ""} ${
          isDropTarget ? "ring-1 ring-accent/60" : ""
        }`}
      >
        {isRunning && (
          <span className="absolute left-0 top-2 bottom-2 w-[2px] bg-accent rounded-r animate-pulse" />
        )}
        <FolderOpen size={14} className="flex-shrink-0 opacity-60" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm truncate" title={session.projectPath}>
              {session.projectName}
            </span>
            {isUnread && (
              <span
                className="flex-shrink-0 w-2 h-2 rounded-full bg-warning"
                title={t("session.unread")}
              />
            )}
          </div>
          <div className="text-xs text-text-muted mt-0.5">
            <span>{formatRelativeDate(session.updatedAt)}</span>
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleDelete(session.id);
          }}
          className="flex-shrink-0 opacity-0 group-hover:opacity-100 p-1 hover:text-error transition-all"
          title={t("session.delete")}
        >
          <Trash2 size={12} />
        </button>
      </div>
    );
  };

  const sectionHeader = (
    label: string,
    count: number,
    collapsed: boolean,
    onToggle: () => void
  ) => (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-1 px-2 py-1.5 mt-1 mb-0.5 rounded
                 text-text-muted hover:text-text-secondary transition-colors select-none"
    >
      {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
      <span className="text-[11px] uppercase tracking-wider font-semibold">
        {label}
      </span>
      <span className="text-[11px] opacity-60">{count}</span>
    </button>
  );

  // Search mode forces both sections expanded so results aren't hidden.
  const showPinnedItems = isSearching || !pinnedCollapsed;
  const showRecentItems = isSearching || !recentCollapsed;

  return (
    <div className="flex-1 overflow-y-auto px-2 py-1">
      {pinnedAll.length > 0 && (
        <>
          {sectionHeader(
            t("session.section.pinned"),
            visiblePinned.length,
            pinnedCollapsed && !isSearching,
            () => setPinnedCollapsed((c) => !c)
          )}
          {showPinnedItems &&
            visiblePinned.map((session) => {
              const pinnedIdx = pinnedAll.indexOf(session);
              return renderItem(session, pinnedIdx);
            })}
        </>
      )}

      {recentAll.length > 0 && (
        <>
          {sectionHeader(
            t("session.section.recent"),
            visibleRecent.length,
            recentCollapsed && !isSearching,
            () => setRecentCollapsed((c) => !c)
          )}
          {showRecentItems && visibleRecent.map((session) => renderItem(session, null))}
        </>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[160px] py-1 rounded-lg bg-bg-secondary border border-border shadow-xl shadow-black/20 animate-fade-in"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => handleTogglePinned(contextMenu.sessionId)}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-text-secondary hover:bg-bg-tertiary/50 hover:text-text-primary transition-colors"
          >
            {contextMenu.pinned ? <PinOff size={14} /> : <Pin size={14} />}
            {contextMenu.pinned ? t("session.unpin") : t("session.pin")}
          </button>
          <button
            onClick={() => handleOpenFolder(contextMenu.projectPath)}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-text-secondary hover:bg-bg-tertiary/50 hover:text-text-primary transition-colors"
          >
            <FolderOpen size={14} />
            {t("session.openFolder")}
          </button>
          <div className="my-1 border-t border-border" />
          <button
            onClick={() => handleDelete(contextMenu.sessionId)}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-error/80 hover:bg-error/10 hover:text-error transition-colors"
          >
            <Trash2 size={14} />
            {t("session.delete")}
          </button>
        </div>
      )}
    </div>
  );
}
