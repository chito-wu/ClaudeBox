import { useState, useEffect, useCallback } from "react";
import { Sparkles, Trash2, X } from "lucide-react";
import { useT } from "../../lib/i18n";

interface NewSessionDialogProps {
  open: boolean;
  onConfirm: (clearHistory: boolean) => void;
  onCancel: () => void;
}

export default function NewSessionDialog({ open, onConfirm, onCancel }: NewSessionDialogProps) {
  const t = useT();
  const [clearHistory, setClearHistory] = useState(false);

  // Reset checkbox each time dialog opens
  useEffect(() => {
    if (open) setClearHistory(false);
  }, [open]);

  const handleConfirm = useCallback(() => {
    onConfirm(clearHistory);
  }, [clearHistory, onConfirm]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      // 输入法拼字阶段不响应 Enter/Escape,避免上屏候选词时误触确认
      if (e.isComposing) return;
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") handleConfirm();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onCancel, handleConfirm]);

  if (!open) return null;

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      {/* Blur overlay */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Dialog */}
      <div className="relative z-10 w-[360px] rounded-2xl border border-border bg-bg-secondary shadow-2xl overflow-hidden animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-accent/10 flex items-center justify-center flex-shrink-0">
              <Sparkles size={15} className="text-accent" />
            </div>
            <h2 className="text-sm font-semibold text-text-primary">
              {t("chat.newSession.title")}
            </h2>
          </div>
          <button
            onClick={onCancel}
            className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary/50 transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 pb-4">
          <p className="text-xs text-text-secondary leading-relaxed">
            {t("chat.newSession.desc")}
          </p>
        </div>

        {/* Divider */}
        <div className="mx-5 border-t border-border/50" />

        {/* Checkbox option */}
        <label className="flex items-start gap-3 mx-5 my-4 cursor-pointer group">
          <div className="relative flex-shrink-0 mt-0.5">
            <input
              type="checkbox"
              checked={clearHistory}
              onChange={(e) => setClearHistory(e.target.checked)}
              className="sr-only"
            />
            <div
              className={`w-4 h-4 rounded flex items-center justify-center border transition-colors
                ${clearHistory
                  ? "bg-error border-error"
                  : "border-border bg-bg-tertiary/30 group-hover:border-text-muted"
                }`}
            >
              {clearHistory && (
                <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                  <path d="M1 3.5L3.5 6L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
          </div>
          <div className="min-w-0">
            <div className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${clearHistory ? "text-error" : "text-text-primary"}`}>
              <Trash2 size={11} className="flex-shrink-0" />
              {t("chat.newSession.clearHistory")}
            </div>
            <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">
              {t("chat.newSession.clearHistoryHint")}
            </p>
          </div>
        </label>

        {/* Divider */}
        <div className="mx-5 border-t border-border/50" />

        {/* Footer buttons */}
        <div className="flex items-center justify-end gap-2 px-5 py-4">
          <button
            onClick={onCancel}
            className="px-3.5 py-1.5 rounded-lg text-xs text-text-secondary border border-border
                       hover:bg-bg-tertiary/50 hover:text-text-primary transition-colors"
          >
            {t("chat.newSession.cancel")}
          </button>
          <button
            onClick={handleConfirm}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors
              ${clearHistory
                ? "bg-error/90 hover:bg-error text-white"
                : "bg-accent hover:bg-accent-hover text-white"
              }`}
          >
            {t("chat.newSession.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
