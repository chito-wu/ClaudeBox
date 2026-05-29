import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  Send, Square, AlertCircle, ChevronDown, ChevronUp,
  Wrench, Check, Plus, X, FileCode2, FileText,
  Image, FileType, Terminal, Globe, Settings2, Cpu, Eraser,
  Loader2, SquareTerminal, Zap, Search, RefreshCw,
  Presentation, FileSpreadsheet, ListPlus,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { readImageBase64, saveClipboardImage, getFileSize } from "../../lib/claude-ipc";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { useT } from "../../lib/i18n";
import { parseSkills } from "../../lib/skills";
import { useSkillsStore } from "../../stores/skillsStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useImageViewerStore } from "../../stores/imageViewerStore";
import { formatDuration, formatFileSize } from "../../lib/utils";

export interface Attachment {
  path: string;
  name: string;
  type: "text" | "image" | "document";
  /** Base64 data URL for image preview */
  dataUrl?: string;
  /** File size in bytes (for chip display on non-image attachments) */
  size?: number;
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"]);
const DOCUMENT_EXTENSIONS = new Set([
  "pdf", "pptx", "ppt", "docx", "doc", "xlsx", "xls", "xlsm", "csv",
]);

function getAttachmentType(filename: string): "text" | "image" | "document" {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (DOCUMENT_EXTENSIONS.has(ext)) return "document";
  return "text";
}

/** File category for visual styling */
type FileCategory = "code" | "config" | "doc" | "web" | "shell" | "image" | "office" | "other";

const EXT_CATEGORY: Record<string, FileCategory> = {
  ts: "code", tsx: "code", js: "code", jsx: "code", py: "code",
  rs: "code", go: "code", java: "code", rb: "code", php: "code",
  c: "code", cpp: "code", h: "code", lua: "code",
  json: "config", yaml: "config", yml: "config", toml: "config",
  ini: "config", cfg: "config", conf: "config",
  md: "doc", txt: "doc", log: "doc",
  html: "web", css: "web", xml: "web", svg: "web",
  sh: "shell", sql: "shell",
  png: "image", jpg: "image", jpeg: "image", gif: "image",
  webp: "image", bmp: "image",
  pdf: "office", pptx: "office", ppt: "office",
  docx: "office", doc: "office",
  xlsx: "office", xls: "office", xlsm: "office", csv: "office",
};

const CATEGORY_STYLE: Record<FileCategory, { bg: string; text: string; border: string }> = {
  code:   { bg: "bg-blue-500/10",   text: "text-blue-400",   border: "border-blue-500/20" },
  config: { bg: "bg-amber-500/10",  text: "text-amber-400",  border: "border-amber-500/20" },
  doc:    { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20" },
  web:    { bg: "bg-purple-500/10", text: "text-purple-400", border: "border-purple-500/20" },
  shell:  { bg: "bg-orange-500/10", text: "text-orange-400", border: "border-orange-500/20" },
  image:  { bg: "bg-rose-500/10",   text: "text-rose-400",   border: "border-rose-500/20" },
  office: { bg: "bg-sky-500/10",    text: "text-sky-400",    border: "border-sky-500/20" },
  other:  { bg: "bg-zinc-500/10",   text: "text-zinc-400",   border: "border-zinc-500/20" },
};

/** Office/PDF per-extension palette (overrides `office` category color). */
const OFFICE_EXT_STYLE: Record<string, { bg: string; text: string; border: string }> = {
  pdf:  { bg: "bg-red-500/10",     text: "text-red-400",     border: "border-red-500/20" },
  pptx: { bg: "bg-orange-500/10",  text: "text-orange-400",  border: "border-orange-500/20" },
  ppt:  { bg: "bg-orange-500/10",  text: "text-orange-400",  border: "border-orange-500/20" },
  docx: { bg: "bg-sky-500/10",     text: "text-sky-400",     border: "border-sky-500/20" },
  doc:  { bg: "bg-sky-500/10",     text: "text-sky-400",     border: "border-sky-500/20" },
  xlsx: { bg: "bg-green-500/10",   text: "text-green-400",   border: "border-green-500/20" },
  xls:  { bg: "bg-green-500/10",   text: "text-green-400",   border: "border-green-500/20" },
  xlsm: { bg: "bg-green-500/10",   text: "text-green-400",   border: "border-green-500/20" },
  csv:  { bg: "bg-green-500/10",   text: "text-green-400",   border: "border-green-500/20" },
};

function getCategoryIcon(cat: FileCategory, ext?: string) {
  switch (cat) {
    case "code":   return FileCode2;
    case "config": return Settings2;
    case "doc":    return FileText;
    case "web":    return Globe;
    case "shell":  return Terminal;
    case "image":  return Image;
    case "office":
      if (ext === "pptx" || ext === "ppt") return Presentation;
      if (ext === "xlsx" || ext === "xls" || ext === "xlsm" || ext === "csv") return FileSpreadsheet;
      return FileText;
    default:       return FileType;
  }
}

function getFileCategory(filename: string): FileCategory {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return EXT_CATEGORY[ext] || "other";
}

interface InputAreaProps {
  onSend: (message: string, attachments?: Attachment[]) => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled?: boolean;
  model?: string;
  models?: string[];
  onModelChange?: (model: string) => void;
  projectPath?: string;
  onOpenTerminal?: () => void;
  allowedTools?: string[];
  onAllowedToolsChange?: (tools: string[]) => void;
  /** Whether session has a resumable claude session id */
  hasClaudeSession?: boolean;
  /** Callback to clear the session memory */
  onClearSession?: () => void;
  /** Current context token count for progress bar */
  contextTokens?: number;
  /** Actual context window size from SDK (e.g. 200000 or 1000000) */
  contextWindow?: number;
  /** Timestamp when current stream started — drives the elapsed counter in placeholder */
  streamStartTime?: number;
  /** Pending queue (only meaningful when isStreaming, but kept for delete-after-stop UX) */
  queue?: { id: string; content: string; enqueuedAt: number }[];
  /** Remove a queued message by id */
  onRemoveQueued?: (id: string) => void;
  /** Identifier of the active session — when this changes the local draft is swapped */
  sessionKey?: string | null;
  /** Initial draft to load when the active session changes */
  initialDraft?: { content: string; attachments: Attachment[] };
  /** Persist the current draft for a session (called on session switch and on send-clear) */
  onPersistDraft?: (sessionId: string, draft: { content: string; attachments: Attachment[] }) => void;
  /** External signal to overwrite the textarea (e.g. "re-input" from a past user bubble).
   *  Bumping the nonce triggers a load + focus regardless of whether content is identical. */
  injectedDraft?: { content: string; nonce: number } | null;
}

const USER_TOOLS = [
  { value: "Write", label: "Write" },
  { value: "Edit", label: "Edit" },
  { value: "Bash", label: "Bash" },
  { value: "WebFetch", label: "WebFetch" },
  { value: "WebSearch", label: "WebSearch" },
  { value: "NotebookEdit", label: "NotebookEdit" },
  { value: "Agent", label: "Agent" },
  { value: "MCP", label: "MCP" },
];

function ToolsSelector({
  selected,
  onChange,
  t,
}: {
  selected: string[];
  onChange: (tools: string[]) => void;
  t: (key: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const userToolValues = USER_TOOLS.map((t) => t.value);
  const userSelected = selected.filter((t) => userToolValues.includes(t));
  const allUserSelected = userSelected.length === USER_TOOLS.length;

  const toggle = (tool: string) => {
    if (selected.includes(tool)) {
      onChange(selected.filter((t) => t !== tool));
    } else {
      onChange([...selected, tool]);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2 py-1 rounded-md text-xs
                   text-text-secondary hover:text-text-primary hover:bg-bg-tertiary/50
                   transition-colors"
      >
        <Wrench size={11} />
        <span>{t("input.tools")} ({userSelected.length})</span>
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 min-w-[150px] rounded-lg
                        bg-bg-secondary border border-border shadow-xl z-50 py-1">
          <p className="px-3 py-1.5 text-[10px] text-text-muted">{t("input.toolsHint")}</p>
          <button
            onClick={() => onChange(allUserSelected ? selected.filter((t) => !userToolValues.includes(t)) : [...selected.filter((t) => !userToolValues.includes(t)), ...userToolValues])}
            className="block w-full text-left px-3 py-1.5 text-xs text-text-muted
                       hover:text-text-primary hover:bg-bg-tertiary/50 transition-colors border-b border-border"
          >
            {allUserSelected ? t("input.deselectAll") : t("input.selectAll")}
          </button>
          {USER_TOOLS.map((tool) => {
            const isSelected = selected.includes(tool.value);
            return (
              <button
                key={tool.value}
                onClick={() => toggle(tool.value)}
                className={`flex items-center gap-2 w-full text-left px-3 py-1.5 text-xs transition-colors
                  ${isSelected
                    ? "text-text-primary"
                    : "text-text-muted hover:text-text-secondary"
                  } hover:bg-bg-tertiary/50`}
              >
                <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0
                  ${isSelected
                    ? "bg-accent border-accent"
                    : "border-border"
                  }`}>
                  {isSelected && <Check size={10} className="text-white" />}
                </span>
                <span>{tool.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const EFFORT_LEVELS = ["low", "medium", "high", "max"] as const;

function ModelPanel({
  model,
  models,
  onModelChange,
}: {
  model: string;
  models: string[];
  onModelChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();
  const effort = useSettingsStore((s) => s.settings.effort) || "high";
  const updateSettings = useSettingsStore((s) => s.updateSettings);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const shortModel = model ? model.replace(/^claude-/, "").replace(/-\d{8}$/, "") : "";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2 py-1 rounded-md text-xs
                   text-text-secondary hover:text-text-primary hover:bg-bg-tertiary/50
                   transition-colors"
        title={t("input.model")}
      >
        <Cpu size={11} className="flex-shrink-0" />
        <span className="truncate max-w-[140px]">{shortModel || model || t("input.addModelsHint")}</span>
        <span className="text-text-muted/60 capitalize">{effort}</span>
        {open ? <ChevronUp size={12} className="flex-shrink-0" /> : <ChevronDown size={12} className="flex-shrink-0" />}
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-[240px] rounded-lg
                        bg-bg-secondary border border-border shadow-xl z-50 py-1">
          {/* Model list */}
          {models.length > 0 && (
            <div className="px-2 pt-1 pb-1.5">
              <p className="text-[10px] text-text-muted uppercase tracking-wider mb-1 px-1">{t("input.model")}</p>
              {models.map((m) => (
                <button
                  key={m}
                  onClick={() => { onModelChange(m); }}
                  className={`block w-full text-left px-2 py-1.5 text-xs rounded-md transition-colors truncate ${
                    m === model
                      ? "text-accent bg-accent/10"
                      : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary/50"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
          {/* Effort */}
          <div className="border-t border-border px-2 pt-1.5 pb-1">
            <p className="text-[10px] text-text-muted uppercase tracking-wider mb-1 px-1">{t("input.effort")}</p>
            <div className="flex gap-0.5">
              {EFFORT_LEVELS.map((level) => (
                <button
                  key={level}
                  onClick={() => { updateSettings({ effort: level }); }}
                  className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    level === effort
                      ? "bg-accent text-white"
                      : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary/50"
                  }`}
                >
                  {t(`effort.${level}`)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SkillsPopover({
  onSelect,
  projectPath,
}: {
  onSelect: (skillName: string) => void;
  projectPath?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const t = useT();

  const { globalSkills, globalSources, projectSkills, loading, refresh, scanProject } = useSkillsStore();

  useEffect(() => {
    if (open && projectPath) scanProject(projectPath);
  }, [open, projectPath]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  const mergedSkills = useMemo(() => {
    const allSkills = [...globalSkills];
    const sources = { ...globalSources };
    const pNames = projectPath ? (projectSkills[projectPath] || []) : [];
    const existingNames = new Set(allSkills.map((s) => s.name));
    for (const name of pNames) {
      if (!existingNames.has(name)) {
        allSkills.push({ name, desc: name });
      }
      sources[name] = "project";
    }
    return { skills: allSkills, sources };
  }, [globalSkills, globalSources, projectSkills, projectPath]);

  const categories = useMemo(
    () => parseSkills(mergedSkills.skills, mergedSkills.sources),
    [mergedSkills],
  );

  const query = search.toLowerCase().trim();
  const filtered = useMemo(() => {
    if (!query) return categories;
    return categories.map((cat) => ({
      ...cat,
      skills: cat.skills.filter(
        (s) => s.name.toLowerCase().includes(query) || s.desc.toLowerCase().includes(query)
      ),
    })).filter((cat) => cat.skills.length > 0);
  }, [query, categories]);

  const totalCount = filtered.reduce((n, c) => n + c.skills.length, 0);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2 py-1 rounded-md text-xs
                   text-text-secondary hover:text-text-primary hover:bg-bg-tertiary/50
                   transition-colors"
        title={t("input.skills")}
      >
        <Zap size={11} />
        <span>{t("input.skills")}</span>
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-[280px] max-h-[min(400px,70vh)]
                        rounded-lg bg-bg-secondary border border-border shadow-xl z-50
                        flex flex-col overflow-hidden">
          {/* Search */}
          <div className="px-2 pt-2 pb-1.5 border-b border-border flex-shrink-0">
            <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-bg-primary border border-border">
              <Search size={12} className="text-text-muted flex-shrink-0" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("skill.search")}
                className="flex-1 text-xs bg-transparent text-text-primary placeholder:text-text-muted
                           focus:outline-none"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="text-text-muted hover:text-text-primary"
                >
                  <X size={10} />
                </button>
              )}
              <button
                onClick={() => refresh(projectPath)}
                disabled={loading}
                className="text-text-muted hover:text-text-primary transition-colors disabled:opacity-50"
                title={t("skill.refresh")}
              >
                {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              </button>
            </div>
          </div>
          {/* Skill list */}
          <div className="overflow-y-auto flex-1 py-1">
            {loading && totalCount === 0 && (
              <div className="px-3 py-4 text-center text-xs text-text-muted flex items-center justify-center gap-1.5">
                <Loader2 size={12} className="animate-spin" />
                {t("skill.loading")}
              </div>
            )}
            {!loading && totalCount === 0 && (
              <div className="px-3 py-4 text-center text-xs text-text-muted">
                {t("skill.empty")}
              </div>
            )}
            {filtered.map((cat) => (
              <div key={cat.key}>
                <div className="px-3 pt-2 pb-1 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                  {cat.label}
                </div>
                {cat.skills.map((skill) => (
                  <button
                    key={skill.name}
                    onClick={() => {
                      onSelect(skill.name);
                      setOpen(false);
                      setSearch("");
                    }}
                    className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-xs
                               text-text-secondary hover:text-text-primary hover:bg-bg-tertiary/50
                               transition-colors"
                  >
                    <span className="text-accent font-mono flex-shrink-0">/{skill.name.split(":").pop()}</span>
                    <span className="text-text-muted truncate">{skill.desc}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Single attachment chip */
function AttachmentChip({
  att,
  onRemove,
  onOpen,
}: {
  att: Attachment;
  onRemove: () => void;
  onOpen: () => void;
}) {
  const cat = getFileCategory(att.name);
  const ext = att.name.split(".").pop()?.toLowerCase() || "";
  const style = OFFICE_EXT_STYLE[ext] || CATEGORY_STYLE[cat];
  const Icon = getCategoryIcon(cat, ext);
  const extLabel = ext.length > 4 ? ext.slice(0, 4).toUpperCase() : ext.toUpperCase();
  const sizeStr = formatFileSize(att.size);

  if (att.type === "image") {
    return (
      <div
        className={`relative group rounded-lg overflow-hidden border ${style.border} flex-shrink-0 cursor-pointer`}
        onClick={onOpen}
        title={`${att.name}\n点击查看`}
      >
        {att.dataUrl ? (
          <img src={att.dataUrl} alt={att.name} className="w-16 h-16 object-cover" />
        ) : (
          <div className="w-16 h-16 flex items-center justify-center bg-rose-500/5">
            <Image size={20} className="text-rose-400/50" />
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1">
          <span className="text-[10px] text-white/90 truncate block">{att.name}</span>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 flex items-center justify-center
                     opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80"
        >
          <X size={10} className="text-white" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`relative flex items-center gap-2 pl-1 pr-6 py-1 rounded-lg border border-border
                   bg-bg-secondary group flex-shrink-0 cursor-pointer hover:brightness-110 transition-all`}
      onDoubleClick={onOpen}
      title={att.path}
    >
      <div
        className={`flex-shrink-0 w-10 h-10 rounded-md flex items-center justify-center
                    ${style.bg} border ${style.border}`}
      >
        {extLabel ? (
          <span
            className={`font-bold tracking-wider uppercase ${style.text}
                        ${extLabel.length >= 4 ? "text-[9px]" : "text-[11px]"}`}
          >
            {extLabel}
          </span>
        ) : (
          <Icon size={18} className={style.text} />
        )}
      </div>
      <div className="flex flex-col min-w-0 leading-tight">
        <span className="text-[12px] font-medium text-text-primary truncate max-w-[150px]">
          {att.name}
        </span>
        {sizeStr && (
          <span className="text-[10px] text-text-muted mt-0.5">{sizeStr}</span>
        )}
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center
                   text-text-muted opacity-0 group-hover:opacity-100 hover:text-error hover:bg-error/10
                   transition-all"
      >
        <X size={10} />
      </button>
    </div>
  );
}

const CONTEXT_WINDOW_SIZES: Record<string, number> = {
  "200k": 200_000,
  "1m": 1_000_000,
};
const DEFAULT_CONTEXT_WINDOW = 200_000;

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

const CONTEXT_WINDOW_OPTIONS = [
  { key: "200k" as const, size: 200_000 },
  { key: "1m" as const, size: 1_000_000 },
];

function ContextProgressBar({ tokens, contextWindow, label }: { tokens?: number; contextWindow?: number; label: string }) {
  if (!tokens) return null;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();
  const contextWindowSetting = useSettingsStore((s) => s.settings.contextWindow);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const settingSize = CONTEXT_WINDOW_SIZES[contextWindowSetting] || DEFAULT_CONTEXT_WINDOW;
  const windowSize = contextWindow || settingSize;
  const ratio = Math.min(1, tokens / windowSize);
  const pct = Math.round(ratio * 100);
  const fillColor =
    ratio > 0.8
      ? "bg-error"
      : ratio > 0.6
        ? "bg-warning"
        : "bg-success";
  const pctColor =
    ratio > 0.8
      ? "text-error"
      : ratio > 0.6
        ? "text-warning"
        : "text-success";
  const statusColor =
    ratio > 0.8
      ? "text-error"
      : ratio > 0.6
        ? "text-warning"
        : "text-success";

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const remaining = Math.max(0, windowSize - tokens);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 flex-shrink-0 cursor-pointer rounded-md px-1 py-0.5
                   hover:bg-bg-tertiary/50 transition-colors"
      >
        <div className="relative w-12 h-2 rounded-sm bg-text-muted/15 overflow-hidden pointer-events-none">
          <div
            className={`absolute top-0 left-0 h-full ${fillColor} transition-all duration-500`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className={`text-[10px] tabular-nums leading-none font-medium pointer-events-none ${pctColor}`}>{pct}%</span>
      </button>
      {open && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-[220px] rounded-lg
                        bg-bg-secondary border border-border shadow-xl z-50 overflow-hidden">
          {/* Header */}
          <div className="px-3 pt-2.5 pb-2">
            <p className="text-[10px] text-text-muted uppercase tracking-wider mb-2">{label}</p>
            {/* Large progress bar */}
            <div className="relative w-full h-2.5 rounded-full bg-text-muted/10 overflow-hidden">
              <div
                className={`absolute top-0 left-0 h-full rounded-full ${fillColor} transition-all duration-500`}
                style={{ width: `${pct}%` }}
              />
            </div>
            {/* Stats */}
            <div className="flex justify-between items-baseline mt-2">
              <span className="text-xs font-medium text-text-primary tabular-nums">
                {formatTokenCount(tokens)}
              </span>
              <span className="text-[10px] text-text-muted tabular-nums">
                / {formatTokenCount(windowSize)}
              </span>
            </div>
            <div className="flex justify-between items-baseline mt-0.5">
              <span className="text-[10px] text-text-muted">{t("contextWindow.remaining")}</span>
              <span className={`text-[10px] font-medium tabular-nums ${statusColor}`}>
                {formatTokenCount(remaining)}
              </span>
            </div>
          </div>
          {/* Context window size picker */}
          <div className="border-t border-border px-3 pt-2 pb-2.5">
            <p className="text-[10px] text-text-muted uppercase tracking-wider mb-1.5">{t("contextWindow.size")}</p>
            <div className="flex gap-1">
              {CONTEXT_WINDOW_OPTIONS.map(({ key }) => (
                <button
                  key={key}
                  onClick={() => updateSettings({ contextWindow: key })}
                  className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    (contextWindowSetting || "200k") === key
                      ? "bg-accent text-white"
                      : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary/50"
                  }`}
                >
                  {t(`contextWindow.${key}`)}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-text-muted mt-1.5 leading-snug">
              {t("contextWindow.hint")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function InputArea({
  onSend,
  onStop,
  isStreaming,
  disabled,
  model = "",
  models = [],
  onModelChange,
  projectPath,
  onOpenTerminal,
  allowedTools = [],
  onAllowedToolsChange,
  onClearSession,
  contextTokens,
  contextWindow,
  streamStartTime,
  queue = [],
  onRemoveQueued,
  sessionKey,
  initialDraft,
  onPersistDraft,
  injectedDraft,
}: InputAreaProps) {
  const [input, setInput] = useState(initialDraft?.content ?? "");
  const [attachments, setAttachments] = useState<Attachment[]>(initialDraft?.attachments ?? []);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const t = useT();
  const openImage = useImageViewerStore((s) => s.openImage);

  // Tick every second while streaming so the placeholder shows elapsed time.
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (!isStreaming || !streamStartTime) {
      setElapsedMs(0);
      return;
    }
    setElapsedMs(Date.now() - streamStartTime);
    const id = window.setInterval(() => {
      setElapsedMs(Date.now() - streamStartTime);
    }, 1000);
    return () => window.clearInterval(id);
  }, [isStreaming, streamStartTime]);

  const handleSkillSelect = useCallback((skillName: string) => {
    setInput(`/${skillName} `);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  const handleAttach = useCallback(async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: "All Supported",
            extensions: [
              "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp",
              "pdf", "pptx", "ppt", "docx", "doc", "xlsx", "xls", "xlsm", "csv",
              "ts", "tsx", "js", "jsx", "json", "md", "txt", "rs", "py", "go",
              "html", "css", "yaml", "yml", "toml", "sh", "sql", "xml", "c",
              "cpp", "h", "java", "rb", "php", "lua", "log", "conf", "cfg", "ini",
            ],
          },
          {
            name: "Images",
            extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"],
          },
          {
            name: "Documents",
            extensions: ["pdf", "pptx", "ppt", "docx", "doc", "xlsx", "xls", "xlsm", "csv"],
          },
          {
            name: "Code & Text",
            extensions: [
              "ts", "tsx", "js", "jsx", "json", "md", "txt", "rs", "py", "go",
              "html", "css", "yaml", "yml", "toml", "sh", "sql", "xml", "c",
              "cpp", "h", "java", "rb", "php", "lua", "log", "conf", "cfg", "ini",
            ],
          },
        ],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      const newAttachments: Attachment[] = [];
      for (const p of paths) {
        const name = p.split(/[\\/]/).pop() || p;
        const type = getAttachmentType(name);
        let dataUrl: string | undefined;
        if (type === "image") {
          try {
            dataUrl = await readImageBase64(p);
          } catch (e) {
            console.error("Failed to read image:", e);
          }
        }
        let size: number | undefined;
        try {
          size = await getFileSize(p);
        } catch (e) {
          console.error("Failed to stat file:", e);
        }
        newAttachments.push({ path: p, name, type, dataUrl, size });
      }
      setAttachments((prev) => [...prev, ...newAttachments]);
    } catch (e) {
      console.error("File dialog error:", e);
    }
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  /** Handle clipboard paste – intercept images, let text pass through */
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }

    // No images → let the default text-paste behaviour through
    if (imageFiles.length === 0) return;
    e.preventDefault();

    for (const file of imageFiles) {
      try {
        // Read the blob as raw base64
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = "";
        for (let j = 0; j < bytes.length; j++) {
          binary += String.fromCharCode(bytes[j]);
        }
        const base64 = btoa(binary);

        // Derive a sensible filename
        const ext = file.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
        const name =
          file.name && file.name !== "image.png"
            ? file.name
            : `clipboard-${Date.now()}.${ext}`;

        // Persist to disk via Rust so the sidecar can read it by path
        const savedPath = await saveClipboardImage(base64, name);

        // Build a data-URL for the inline preview
        const dataUrl = `data:${file.type};base64,${base64}`;

        setAttachments((prev) => [
          ...prev,
          { path: savedPath, name, type: "image" as const, dataUrl, size: file.size },
        ]);
      } catch (err) {
        console.error("Failed to paste image:", err);
      }
    }
  }, []);

  const openAttachment = useCallback((att: Attachment) => {
    if (att.type === "image" && att.dataUrl) {
      openImage(att.dataUrl, att.name, att.path);
    } else {
      shellOpen(att.path).catch(() => {});
    }
  }, [openImage]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed, attachments.length > 0 ? attachments : undefined);
    setInput("");
    setAttachments([]);
    if (sessionKey && onPersistDraft) {
      onPersistDraft(sessionKey, { content: "", attachments: [] });
    }
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input, attachments, disabled, onSend, sessionKey, onPersistDraft]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Track latest input/attachments in refs so the session-swap effect can
  // persist them without re-running on every keystroke.
  const inputRef = useRef(input);
  const attachmentsRef = useRef(attachments);
  useEffect(() => { inputRef.current = input; }, [input]);
  useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);

  // Swap the local draft when the active session changes:
  //  1. Persist the current input/attachments for the *previous* session
  //  2. Load the new session's saved draft (or clear)
  const prevSessionKeyRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const prev = prevSessionKeyRef.current;
    prevSessionKeyRef.current = sessionKey ?? null;
    if (prev === undefined) return;            // first mount — initial state already set
    if (prev === (sessionKey ?? null)) return; // no real change

    if (prev && onPersistDraft) {
      onPersistDraft(prev, {
        content: inputRef.current,
        attachments: attachmentsRef.current,
      });
    }
    setInput(initialDraft?.content ?? "");
    setAttachments(initialDraft?.attachments ?? []);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [sessionKey, initialDraft, onPersistDraft]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    // Cap at ~8 lines (8 × line-height 1.5 × 15px font ≈ 180px)
    const maxH = 180;
    const scrollH = textarea.scrollHeight;
    textarea.style.height = Math.min(scrollH, maxH) + "px";
    textarea.style.overflowY = scrollH > maxH ? "auto" : "hidden";
  }, [input]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // External "re-input" — bumping nonce overwrites whatever's in the textarea.
  const lastInjectedNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!injectedDraft) return;
    if (lastInjectedNonce.current === injectedDraft.nonce) return;
    lastInjectedNonce.current = injectedDraft.nonce;
    setInput(injectedDraft.content);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    });
  }, [injectedDraft]);

  const hasContent = input.trim();

  return (
    <div className="px-4 pt-1 pb-4">
      <div className="max-w-3xl mx-auto">
        {/* Unified input container */}
        <div className={`input-glow rounded-2xl border overflow-visible
          ${disabled ? "opacity-50 border-border bg-input-bg" : "border-border bg-input-bg focus-within:border-accent/40"}`}
        >
          {/* Pending queue */}
          {queue.length > 0 && (
            <div className="px-3 pt-2.5 pb-1.5 border-b border-border/40">
              <div className="flex items-center gap-1.5 mb-1.5">
                <ListPlus size={11} className="text-accent" />
                <span className="text-[10px] uppercase tracking-wider font-semibold text-text-muted">
                  {t("input.queueTitle")}
                </span>
                <span className="text-[10px] text-text-muted">{queue.length}</span>
                <span className="text-[10px] text-text-muted ml-auto">
                  {t("input.queueHint")}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                {queue.map((q, i) => (
                  <div
                    key={q.id}
                    className="group flex items-center gap-2 text-xs px-2 py-1 rounded-md bg-bg-tertiary/20 hover:bg-bg-tertiary/50 transition-colors"
                  >
                    <span className="text-[10px] text-text-muted w-5 flex-shrink-0">
                      #{i + 1}
                    </span>
                    <span
                      className="flex-1 truncate text-text-secondary"
                      title={q.content}
                    >
                      {q.content}
                    </span>
                    {onRemoveQueued && (
                      <button
                        onClick={() => onRemoveQueued(q.id)}
                        className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-error transition-all"
                        title={t("input.queueRemove")}
                      >
                        <X size={11} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Attachment area */}
          {attachments.length > 0 && (
            <div className="px-3 pt-3 pb-1">
              <div className="flex flex-wrap gap-2">
                {attachments.map((att, i) => (
                  <AttachmentChip
                    key={`${att.path}-${i}`}
                    att={att}
                    onRemove={() => removeAttachment(i)}
                    onOpen={() => openAttachment(att)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              isStreaming
                ? streamStartTime
                  ? `Claude Code 运行中... ${formatDuration(elapsedMs)}`
                  : "Claude Code 运行中..."
                : t("input.placeholder")
            }
            rows={1}
            disabled={disabled}
            className="w-full resize-none bg-transparent px-4 py-2
                       text-text-primary placeholder:text-text-muted
                       focus:outline-none disabled:cursor-not-allowed
                       text-[0.9375rem] break-words [word-break:break-all]"
          />

          {/* Bottom bar: attach + toolbar + send */}
          <div className="flex items-center gap-1 px-2 pb-1">
            <button
              onClick={handleAttach}
              disabled={disabled}
              className="flex items-center justify-center w-5 h-5 rounded-full flex-shrink-0
                         text-text-secondary hover:text-text-primary hover:bg-bg-tertiary/50 transition-colors
                         disabled:opacity-30 disabled:cursor-not-allowed"
              title={t("input.attach")}
            >
              <Plus size={13} strokeWidth={2.5} />
            </button>

            {/* Inline toolbar */}
            {onModelChange && (
              <div className="flex items-center gap-0.5 min-w-0 flex-nowrap">
                {/* New session button */}
                {onClearSession && (
                  <>
                    <button
                      onClick={onClearSession}
                      className="flex items-center gap-1 rounded-md text-xs px-1.5 py-0.5
                                 text-text-secondary hover:text-text-primary hover:bg-bg-tertiary/50 transition-colors"
                      title={t("chat.clearSession")}
                    >
                      <Eraser size={12} className="flex-shrink-0" />
                      <span>{t("chat.clearSession")}</span>
                    </button>
                    <ContextProgressBar tokens={contextTokens} contextWindow={contextWindow} label={t("input.contextWindow")} />
                    <span className="text-border/40 flex-shrink-0">|</span>
                  </>
                )}
                {models.length > 0 ? (
                  <ModelPanel
                    model={model}
                    models={models}
                    onModelChange={(v) => onModelChange?.(v)}
                  />
                ) : (
                  <input
                    type="text"
                    value={model}
                    onChange={(e) => onModelChange?.(e.target.value)}
                    placeholder={t("input.addModelsHint")}
                    className="w-40 px-2 py-1 rounded-md text-xs bg-transparent border border-transparent
                               text-text-secondary hover:border-border focus:border-accent focus:outline-none
                               placeholder:text-text-muted/50 transition-colors"
                  />
                )}
                <span className="text-border/40 flex-shrink-0">|</span>
                <SkillsPopover onSelect={handleSkillSelect} projectPath={projectPath} />
                {onAllowedToolsChange && (
                  <>
                    <span className="text-border/40 flex-shrink-0">|</span>
                    <ToolsSelector
                      selected={allowedTools}
                      onChange={onAllowedToolsChange}
                      t={t}
                    />
                  </>
                )}
                {onOpenTerminal && (
                  <>
                    <span className="text-border/40 flex-shrink-0">|</span>
                    <button
                      onClick={onOpenTerminal}
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-xs
                                 text-text-secondary hover:text-text-primary hover:bg-bg-tertiary/50
                                 transition-colors"
                      title={t("input.openTerminal")}
                    >
                      <SquareTerminal size={13} />
                      <span>{t("input.terminal")}</span>
                    </button>
                  </>
                )}
              </div>
            )}

            <div className="flex-1" />

            <div className="flex items-center gap-1.5 flex-shrink-0">
              {isStreaming ? (
                <>
                  <button
                    onClick={handleSend}
                    disabled={!hasContent || disabled}
                    className={`flex items-center justify-center w-8 h-8 rounded-lg transition-all
                      ${hasContent && !disabled
                        ? "bg-bg-tertiary/60 text-text-primary hover:bg-bg-tertiary border border-accent/40"
                        : "bg-bg-tertiary/30 text-text-muted cursor-not-allowed border border-border"
                      }`}
                    title={t("input.queueAdd")}
                  >
                    <ListPlus size={14} />
                  </button>
                  <button
                    onClick={onStop}
                    className="flex items-center justify-center w-8 h-8 rounded-lg
                               bg-error/15 text-error hover:bg-error/25 transition-colors"
                    title={t("input.stop")}
                  >
                    <Square size={14} />
                  </button>
                </>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!hasContent || disabled}
                  className={`flex items-center justify-center w-8 h-8 rounded-lg transition-all
                    ${hasContent && !disabled
                      ? "bg-accent text-white hover:bg-accent-hover shadow-sm shadow-accent/20"
                      : "bg-bg-tertiary/50 text-text-muted cursor-not-allowed"
                    }`}
                  title={t("input.send")}
                >
                  <Send size={14} />
                </button>
              )}
            </div>
          </div>
        </div>

        {disabled && (
          <div className="flex items-center gap-2 text-warning text-sm mt-2">
            <AlertCircle size={14} />
            <span>{t("input.cliNotDetected")}</span>
          </div>
        )}
      </div>
    </div>
  );
}
