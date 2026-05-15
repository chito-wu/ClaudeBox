import { useEffect, useMemo, useState } from "react";
import { X, ChevronDown, ChevronRight, FileCode2, RefreshCw, Loader2 } from "lucide-react";
import { gitDiff } from "../lib/claude-ipc";
import { useT } from "../lib/i18n";

interface GitDiffDialogProps {
  open: boolean;
  projectPath: string | null;
  projectName?: string | null;
  onClose: () => void;
}

interface FileBlock {
  /** Display path (b/...) or rename target */
  path: string;
  /** Raw lines belonging to this file (excluding the leading `diff --git` line) */
  lines: string[];
  added: number;
  removed: number;
}

/** Parse a unified diff string (concatenated `git diff --cached` + `git diff`). */
function parseDiff(text: string): FileBlock[] {
  if (!text) return [];
  const lines = text.split("\n");
  const blocks: FileBlock[] = [];
  let current: FileBlock | null = null;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (current) blocks.push(current);
      // diff --git a/foo b/foo  → take b/foo (target)
      const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      const path = match ? match[2] : line.slice("diff --git ".length);
      current = { path, lines: [], added: 0, removed: 0 };
      continue;
    }
    if (!current) continue;
    current.lines.push(line);
    if (line.startsWith("+") && !line.startsWith("+++")) current.added += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) current.removed += 1;
  }
  if (current) blocks.push(current);
  return blocks;
}

type LineKind = "add" | "del" | "hunk" | "meta" | "ctx";

function classifyLine(line: string): LineKind {
  if (line.startsWith("@@")) return "hunk";
  if (
    line.startsWith("+++") ||
    line.startsWith("---") ||
    line.startsWith("index ") ||
    line.startsWith("new file") ||
    line.startsWith("deleted file") ||
    line.startsWith("similarity ") ||
    line.startsWith("rename ") ||
    line.startsWith("Binary ")
  )
    return "meta";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "ctx";
}

function lineClass(kind: LineKind): string {
  switch (kind) {
    case "add":
      return "bg-success/10 text-success/95";
    case "del":
      return "bg-error/10 text-error/95";
    case "hunk":
      return "bg-accent/10 text-accent/85";
    case "meta":
      return "text-text-muted/80";
    default:
      return "text-text-secondary";
  }
}

interface RenderedLine {
  key: number;
  kind: LineKind;
  oldNo: string;
  newNo: string;
  text: string;
}

/** Walk a file's diff lines and attach old/new line numbers using hunk headers.
 *  Also returns the widest digit count seen in either column so the gutter can
 *  size itself dynamically (avoids 6-digit numbers running into each other). */
function renderLinesWithNumbers(
  lines: string[]
): { rows: RenderedLine[]; oldDigits: number; newDigits: number } {
  let oldLine = 0;
  let newLine = 0;
  let maxOld = 0;
  let maxNew = 0;
  const rows = lines.map((line, i) => {
    const kind = classifyLine(line);
    let oldNo = "";
    let newNo = "";
    if (kind === "hunk") {
      const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) {
        oldLine = parseInt(m[1], 10);
        newLine = parseInt(m[2], 10);
      }
    } else if (kind === "ctx") {
      oldNo = String(oldLine);
      newNo = String(newLine);
      maxOld = Math.max(maxOld, oldLine);
      maxNew = Math.max(maxNew, newLine);
      oldLine++;
      newLine++;
    } else if (kind === "del") {
      oldNo = String(oldLine);
      maxOld = Math.max(maxOld, oldLine);
      oldLine++;
    } else if (kind === "add") {
      newNo = String(newLine);
      maxNew = Math.max(maxNew, newLine);
      newLine++;
    }
    return { key: i, kind, oldNo, newNo, text: line };
  });
  // Minimum 2 digits to avoid awkward narrow gutter on tiny files.
  const oldDigits = Math.max(2, String(maxOld).length);
  const newDigits = Math.max(2, String(maxNew).length);
  return { rows, oldDigits, newDigits };
}

export default function GitDiffDialog({ open, projectPath, projectName, onClose }: GitDiffDialogProps) {
  const t = useT();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diffText, setDiffText] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const load = async () => {
    if (!projectPath) return;
    setLoading(true);
    setError(null);
    try {
      const text = await gitDiff(projectPath);
      setDiffText(text);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && projectPath) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectPath]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  const blocks = useMemo(() => parseDiff(diffText), [diffText]);
  const totalAdded = blocks.reduce((sum, b) => sum + b.added, 0);
  const totalRemoved = blocks.reduce((sum, b) => sum + b.removed, 0);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-[88vw] max-w-[1280px] h-[85vh] flex flex-col rounded-2xl bg-bg-secondary border border-border shadow-2xl shadow-black/40 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between gap-3 px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <FileCode2 size={16} className="text-accent flex-shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-text-primary truncate">
                {projectName || projectPath || t("diff.title")}
              </div>
              {projectPath && (
                <div className="text-[11px] text-text-muted truncate font-mono">
                  {projectPath}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {!loading && !error && blocks.length > 0 && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-text-muted">
                  {t("diff.fileCount", { n: String(blocks.length) })}
                </span>
                <span className="text-success">+{totalAdded}</span>
                <span className="text-error">-{totalRemoved}</span>
              </div>
            )}
            <button
              onClick={load}
              disabled={loading}
              className="p-1.5 rounded-lg text-text-secondary hover:bg-bg-tertiary/50 hover:text-text-primary transition-colors disabled:opacity-50"
              title={t("diff.refresh")}
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-text-secondary hover:bg-bg-tertiary/50 hover:text-text-primary transition-colors"
              title={t("dialog.close")}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto bg-code-bg">
          {loading && (
            <div className="h-full flex items-center justify-center text-text-muted text-sm gap-2">
              <Loader2 size={14} className="animate-spin" />
              {t("diff.loading")}
            </div>
          )}
          {!loading && error && (
            <div className="h-full flex items-center justify-center text-error text-sm px-6">
              {error}
            </div>
          )}
          {!loading && !error && blocks.length === 0 && (
            <div className="h-full flex items-center justify-center text-text-muted text-sm">
              {t("diff.empty")}
            </div>
          )}
          {!loading && !error && blocks.length > 0 && (
            <div className="px-3 py-3 space-y-3">
              {blocks.map((block) => {
                const isCollapsed = collapsed[block.path];
                const { rows, oldDigits, newDigits } = renderLinesWithNumbers(block.lines);
                // Each digit is ~1ch in mono font; +1.25ch padding/visual breathing.
                const oldGutter = `${oldDigits + 1.5}ch`;
                const newGutter = `${newDigits + 1.5}ch`;
                return (
                  <div
                    key={block.path}
                    className="rounded-lg border border-border overflow-hidden bg-bg-secondary"
                  >
                    <button
                      onClick={() =>
                        setCollapsed((c) => ({ ...c, [block.path]: !c[block.path] }))
                      }
                      className="w-full flex items-center gap-2 px-3 py-2 text-left
                                 bg-bg-tertiary/40 hover:bg-bg-tertiary/60 transition-colors"
                    >
                      {isCollapsed ? (
                        <ChevronRight size={14} className="text-text-muted flex-shrink-0" />
                      ) : (
                        <ChevronDown size={14} className="text-text-muted flex-shrink-0" />
                      )}
                      <span className="font-mono text-[13px] text-text-primary truncate flex-1">
                        {block.path}
                      </span>
                      <span className="flex-shrink-0 text-xs text-success">
                        +{block.added}
                      </span>
                      <span className="flex-shrink-0 text-xs text-error">
                        -{block.removed}
                      </span>
                    </button>
                    {!isCollapsed && (
                      <pre
                        className="font-mono text-[13px] leading-[1.55] overflow-x-auto whitespace-pre tabular-nums"
                        style={{ tabSize: 4 }}
                      >
                        {rows.map((row) => (
                          <div key={row.key} className={`${lineClass(row.kind)} flex`}>
                            <span
                              className="select-none flex-shrink-0 pr-2 pl-3 text-right opacity-50 border-r border-border/40"
                              style={{ width: oldGutter }}
                            >
                              {row.oldNo}
                            </span>
                            <span
                              className="select-none flex-shrink-0 pr-2 pl-3 text-right opacity-50 border-r border-border/40"
                              style={{ width: newGutter }}
                            >
                              {row.newNo}
                            </span>
                            <span className="flex-1 px-3 whitespace-pre">
                              {row.text || " "}
                            </span>
                          </div>
                        ))}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
