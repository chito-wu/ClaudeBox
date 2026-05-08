import { useState, useEffect, useRef, useCallback } from "react";
import { Download, Loader2, CheckCircle, XCircle, ExternalLink, Copy, Check, Terminal } from "lucide-react";
import {
  checkNodeVersion,
  downloadAndOpenNodeInstaller,
  installClaudeCode,
  onInstallProgress,
  type InstallProgress,
  openInBrowser,
  openInTerminal,
} from "../../lib/claude-ipc";
import { useT } from "../../lib/i18n";
import { isWindows } from "../../lib/utils";

const MIN_NODE_MAJOR = 22;

type NodeStep = "idle" | "downloading" | "waiting" | "done" | "error";
type ClaudeStep = "idle" | "installing" | "done" | "error";

const NODE_MANUAL_CMD = isWindows
  ? "winget install OpenJS.NodeJS.LTS"
  : "brew install node@22";
const CLAUDE_MANUAL_CMD = "npm install -g @anthropic-ai/claude-code";

/** Hint shown on install failure: copy-able command + "open terminal" button. */
function ManualInstallHint({ command }: { command: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard may be denied — user can still select & copy */ }
  }, [command]);

  return (
    <div className="mt-2 rounded-lg border border-border bg-bg-secondary/40 p-2.5">
      <p className="text-[11px] text-text-secondary leading-relaxed">{t("install.manualHint")}</p>
      <div className="mt-1.5 flex items-center gap-1.5">
        <code className="flex-1 px-2 py-1 rounded-md bg-code-bg text-[11px] font-mono text-text-primary
                         break-all select-all">
          {command}
        </code>
        <button
          onClick={copy}
          className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-[11px]
                     text-text-secondary hover:text-text-primary hover:bg-bg-tertiary/50 transition-colors"
          title={t("install.copyCommand")}
        >
          {copied ? <Check size={11} className="text-success" /> : <Copy size={11} />}
          <span>{copied ? t("install.copied") : t("install.copyCommand")}</span>
        </button>
      </div>
      <button
        onClick={() => openInTerminal("").catch(() => {})}
        className="mt-1.5 flex items-center gap-1 text-[11px] text-accent hover:text-accent-hover transition-colors"
      >
        <Terminal size={11} />
        <span>{isWindows ? t("install.openCmd") : t("install.openTerminal")}</span>
      </button>
    </div>
  );
}

// ── Node.js install section ────────────────────────────────────────

export function NodeStatusSection({
  nodeVersion,
  nodeChecking,
  onRecheck,
}: {
  nodeVersion: string | null;
  nodeChecking: boolean;
  onRecheck: () => void;
}) {
  const t = useT();
  const [step, setStep] = useState<NodeStep>("idle");
  const [progress, setProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const nodeOk = nodeVersion !== null && (() => {
    const major = parseInt(nodeVersion.replace(/^v/, "").split(".")[0], 10);
    return !isNaN(major) && major >= MIN_NODE_MAJOR;
  })();

  useEffect(() => {
    const unlisten = onInstallProgress((p: InstallProgress) => {
      if (p.step === "download_node" || p.step === "open_installer") {
        setStatusMsg(p.message);
        if (p.progress >= 0) setProgress(p.progress);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const startInstall = useCallback(async () => {
    setStep("downloading");
    setError(null);
    setProgress(0);
    try {
      await downloadAndOpenNodeInstaller();
      setStep("waiting");
      // Poll for node availability
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const ver = await checkNodeVersion();
          const major = parseInt(ver.replace(/^v/, "").split(".")[0], 10);
          if (!isNaN(major) && major >= MIN_NODE_MAJOR) {
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
            setStep("done");
            onRecheck();
          }
        } catch { /* keep polling */ }
      }, 3000);
    } catch (e) {
      setError(String(e));
      setStep("error");
    }
  }, [onRecheck]);

  const needsInstall = !nodeChecking && !nodeOk;

  return (
    <div>
      <label className="text-sm font-medium text-text-primary block mb-2">
        {t("settings.nodeStatus")}
      </label>
      <div className="flex items-center gap-2 text-sm">
        {nodeChecking ? (
          <>
            <Loader2 size={14} className="animate-spin text-text-muted" />
            <span className="text-text-muted">{t("settings.checking")}</span>
          </>
        ) : nodeOk ? (
          <>
            <CheckCircle size={14} className="text-success" />
            <span className="text-success">{nodeVersion}</span>
          </>
        ) : nodeVersion ? (
          <>
            <XCircle size={14} className="text-warning" />
            <span className="text-warning text-xs">
              {t("install.nodeOld", { version: nodeVersion, target: "v24" })}
            </span>
          </>
        ) : (
          <>
            <XCircle size={14} className="text-error" />
            <span className="text-error text-xs">{t("settings.notFound")}</span>
          </>
        )}
        <button
          onClick={onRecheck}
          className="ml-auto text-xs text-accent hover:text-accent-hover transition-colors"
        >
          {t("settings.recheck")}
        </button>
      </div>

      {/* Install UI */}
      {needsInstall && step === "idle" && (
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={startInstall}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                       bg-accent text-white hover:bg-accent-hover transition-colors"
          >
            <Download size={12} />
            {t("install.installNode")}
          </button>
          <button
            onClick={() => openInBrowser("https://nodejs.org")}
            className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-secondary transition-colors"
          >
            <ExternalLink size={10} />
            {t("install.openUrl")}
          </button>
        </div>
      )}

      {step === "downloading" && (
        <div className="mt-2">
          <div className="flex items-center gap-2 mb-1.5">
            <Loader2 size={12} className="animate-spin text-accent" />
            <span className="text-xs text-text-secondary">
              {t("install.downloadingNode", { version: "v24" })}
            </span>
          </div>
          <div className="relative w-full h-1.5 rounded-full bg-text-muted/15 overflow-hidden">
            <div
              className="absolute top-0 left-0 h-full bg-accent transition-all duration-300"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          {statusMsg && <p className="text-[10px] text-text-muted mt-1">{statusMsg}</p>}
        </div>
      )}

      {step === "waiting" && (
        <div className="mt-2">
          <div className="flex items-center gap-2 mb-1">
            <Loader2 size={12} className="animate-spin text-warning" />
            <span className="text-xs text-text-primary">{t("install.waitingInstaller")}</span>
          </div>
          <p className="text-[10px] text-text-muted">{t("install.waitingInstallerDesc")}</p>
          <p className="text-[10px] text-text-muted/60 italic mt-1">{t("install.waitingDetect")}</p>
        </div>
      )}

      {step === "done" && (
        <div className="mt-2 flex items-center gap-2">
          <CheckCircle size={12} className="text-success" />
          <span className="text-xs text-success">{t("install.nodeSuccess")}</span>
        </div>
      )}

      {step === "error" && (
        <div className="mt-2">
          <div className="flex items-center gap-2 mb-1.5">
            <XCircle size={12} className="text-error" />
            <span className="text-xs text-error">{t("install.failed", { error: error || "" })}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { setError(null); startInstall(); }}
              className="px-2 py-1 rounded-md text-xs bg-accent text-white hover:bg-accent-hover transition-colors"
            >{t("install.retry")}</button>
            <button onClick={() => openInBrowser("https://nodejs.org")}
              className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-secondary"
            ><ExternalLink size={10} />{t("install.openUrl")}</button>
          </div>
          <ManualInstallHint command={NODE_MANUAL_CMD} />
        </div>
      )}
    </div>
  );
}

// ── Claude Code install section ────────────────────────────────────

export function ClaudeInstallButton({
  nodeOk,
  onComplete,
}: {
  nodeOk: boolean;
  onComplete: () => void;
}) {
  const t = useT();
  const [step, setStep] = useState<ClaudeStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [npmLog, setNpmLog] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unlisten = onInstallProgress((p: InstallProgress) => {
      if (p.step === "install_claude" && p.message && !p.done) {
        setNpmLog((prev) => [...prev.slice(-100), p.message]);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [npmLog]);

  const startInstall = useCallback(async () => {
    setStep("installing");
    setError(null);
    setNpmLog([]);
    try {
      await installClaudeCode();
      setStep("done");
      onComplete();
    } catch (e) {
      setError(String(e));
      setStep("error");
    }
  }, [onComplete]);

  if (step === "idle") {
    return (
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={startInstall}
          disabled={!nodeOk}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
                     bg-accent text-white hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download size={12} />
          {t("install.installClaude")}
        </button>
        {!nodeOk && (
          <span className="text-[10px] text-text-muted">{t("install.needsNode")}</span>
        )}
      </div>
    );
  }

  if (step === "installing") {
    return (
      <div className="mt-2">
        <div className="flex items-center gap-2 mb-1.5">
          <Loader2 size={12} className="animate-spin text-accent" />
          <span className="text-xs text-text-secondary">{t("install.installingClaude")}</span>
        </div>
        <div className="relative w-full h-1.5 rounded-full bg-text-muted/15 overflow-hidden mb-2">
          <div className="absolute top-0 left-0 h-full w-1/3 bg-accent rounded-full animate-[shimmer_1.5s_ease-in-out_infinite]" />
        </div>
        {npmLog.length > 0 && (
          <div ref={logRef}
            className="max-h-[80px] overflow-y-auto rounded bg-code-bg p-2 text-[10px] font-mono text-text-muted leading-relaxed"
          >
            {npmLog.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        )}
      </div>
    );
  }

  if (step === "done") {
    return (
      <div className="mt-2 flex items-center gap-2">
        <CheckCircle size={12} className="text-success" />
        <span className="text-xs text-success">{t("install.success")}</span>
      </div>
    );
  }

  // error
  return (
    <div className="mt-2">
      <div className="flex items-center gap-2 mb-1.5">
        <XCircle size={12} className="text-error" />
        <span className="text-xs text-error">{t("install.failed", { error: error || "" })}</span>
      </div>
      <button onClick={() => { setError(null); startInstall(); }}
        className="px-2 py-1 rounded-md text-xs bg-accent text-white hover:bg-accent-hover transition-colors"
      >{t("install.retry")}</button>
      <ManualInstallHint command={CLAUDE_MANUAL_CMD} />
    </div>
  );
}
