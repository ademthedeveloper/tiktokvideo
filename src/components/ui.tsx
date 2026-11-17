"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { IconAlert, IconCheck, IconCopy } from "./icons";

/* ── toasts ─────────────────────────────────────────────────────── */

type Toast = { id: number; text: string; kind: "ok" | "warn" | "info"; detail?: string };
type ToastCtx = (text: string, kind?: Toast["kind"], detail?: string) => void;

const ToastContext = createContext<ToastCtx>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastHost({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);

  const push = useCallback<ToastCtx>((text, kind = "info", detail) => {
    seq.current += 1;
    const id = seq.current;
    setItems((prev) => [...prev.slice(-3), { id, text, kind, detail }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4200);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-[70] flex w-[min(92vw,26rem)] -translate-x-1/2 flex-col gap-2">
        {items.map((toast) => (
          <div
            key={toast.id}
            className="toast-in pointer-events-auto flex items-start gap-3 border border-line bg-panel/95 px-4 py-3 backdrop-blur-md"
            style={{
              clipPath:
                "polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px))",
              boxShadow:
                toast.kind === "ok"
                  ? "0 0 0 1px rgba(36,224,210,.18), 0 18px 40px -22px rgba(36,224,210,.5)"
                  : toast.kind === "warn"
                    ? "0 0 0 1px rgba(255,59,92,.2), 0 18px 40px -22px rgba(255,59,92,.5)"
                    : "0 18px 40px -24px rgba(0,0,0,.8)",
            }}
          >
            <span
              className={`mt-0.5 ${
                toast.kind === "ok"
                  ? "text-signal"
                  : toast.kind === "warn"
                    ? "text-flare"
                    : "text-muted"
              }`}
            >
              {toast.kind === "ok" ? (
                <IconCheck className="h-4 w-4" />
              ) : toast.kind === "warn" ? (
                <IconAlert className="h-4 w-4" />
              ) : (
                <IconCopy className="h-4 w-4" />
              )}
            </span>
            <div className="min-w-0">
              <p className="text-[13px] leading-snug font-semibold text-text">{toast.text}</p>
              {toast.detail ? (
                <p className="mt-0.5 text-[11.5px] leading-snug break-words text-muted">
                  {toast.detail}
                </p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ── scroll reveal ──────────────────────────────────────────────── */

export function Reveal({
  children,
  delay = 0,
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "section" | "li" | "article";
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px -6% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const Comp = Tag as any;
  return (
    <Comp
      ref={ref as any}
      className={`reveal ${shown ? "is-in" : ""} ${className}`}
      style={{ ["--reveal-delay" as any]: `${delay}ms` }}
    >
      {children}
    </Comp>
  );
}

/* ── scramble decode title ──────────────────────────────────────── */

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#@$%&*0123456789/\\<>";

export function ScrambleText({
  text,
  className = "",
  speed = 34,
}: {
  text: string;
  className?: string;
  speed?: number;
}) {
  const [output, setOutput] = useState(text);
  const frame = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const run = useCallback(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setOutput(text);
      return;
    }
    frame.current = 0;
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => {
      frame.current += 1;
      const progress = frame.current / 2.2;
      const next = text
        .split("")
        .map((char, index) => {
          if (char === " ") return " ";
          if (index < progress) return char;
          return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        })
        .join("");
      setOutput(next);
      if (progress >= text.length) {
        setOutput(text);
        if (timer.current) clearInterval(timer.current);
      }
    }, speed);
  }, [text, speed]);

  useEffect(() => {
    run();
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [run]);

  return (
    <span className={className} onMouseEnter={run}>
      {output}
    </span>
  );
}

/* ── surfaces ───────────────────────────────────────────────────── */

export function Panel({
  title,
  eyebrow,
  right,
  children,
  className = "",
  dense = false,
}: {
  title?: string;
  eyebrow?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  dense?: boolean;
}) {
  return (
    <section
      className={`relative border border-line bg-panel/70 backdrop-blur-[2px] ${className}`}
      style={{
        clipPath:
          "polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 16px 100%, 0 calc(100% - 16px))",
      }}
    >
      {title || right ? (
        <header className="flex items-center justify-between gap-3 border-b border-line/80 px-4 py-3">
          <div className="min-w-0">
            {eyebrow ? (
              <p className="mono-num text-[10px] tracking-[0.24em] text-dim uppercase">
                {eyebrow}
              </p>
            ) : null}
            {title ? (
              <h2 className="font-display truncate text-[15px] font-bold tracking-wide text-text uppercase">
                {title}
              </h2>
            ) : null}
          </div>
          {right ? <div className="flex shrink-0 items-center gap-2">{right}</div> : null}
        </header>
      ) : null}
      <div className={dense ? "" : "p-4"}>{children}</div>
    </section>
  );
}

type ButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "outline" | "danger" | "flare";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  title?: string;
  className?: string;
  type?: "button" | "submit";
};

export function Button({
  children,
  onClick,
  variant = "outline",
  size = "md",
  disabled,
  title,
  className = "",
  type = "button",
}: ButtonProps) {
  const sizes = {
    sm: "px-2.5 py-1.5 text-[11px]",
    md: "px-3.5 py-2 text-[12.5px]",
    lg: "px-5 py-2.5 text-[13.5px]",
  }[size];
  const variants = {
    primary:
      "bg-signal text-[#04120f] hover:bg-[#3df0e2] shadow-[0_0_0_1px_rgba(36,224,210,.4),0_14px_34px_-18px_rgba(36,224,210,.9)]",
    flare: "bg-flare text-[#1a0208] hover:bg-[#ff5c78]",
    outline:
      "border border-line2 bg-panel2/60 text-text hover:border-signal/60 hover:bg-panel2 hover:text-signal",
    ghost: "text-muted hover:text-signal hover:bg-white/[0.04]",
    danger: "border border-flare/40 text-flare hover:bg-flare/12",
  }[variant];
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`font-display inline-flex items-center justify-center gap-1.5 font-semibold tracking-[0.1em] uppercase transition-all duration-200 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40 ${sizes} ${variants} ${className}`}
      style={{
        clipPath:
          "polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 8px 100%, 0 calc(100% - 8px))",
      }}
    >
      {children}
    </button>
  );
}

export function Chip({
  active,
  children,
  onClick,
  tone = "signal",
  title,
}: {
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
  tone?: "signal" | "flare" | "neutral";
  title?: string;
}) {
  const activeTone =
    tone === "flare"
      ? "border-flare/70 bg-flare/15 text-flare"
      : tone === "neutral"
        ? "border-line2 bg-white/[0.06] text-text"
        : "border-signal/70 bg-signal/14 text-signal";
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`mono-num border px-2.5 py-1 text-[10.5px] tracking-[0.14em] uppercase transition-all duration-200 hover:-translate-y-px ${
        active ? activeTone : "border-line bg-transparent text-dim hover:border-line2 hover:text-muted"
      }`}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mono-num flex items-baseline gap-2 text-[10px] tracking-[0.22em] text-dim uppercase">
        {label}
        {hint ? <span className="normal-case tracking-normal text-[10.5px] text-dim/70">{hint}</span> : null}
      </span>
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}

export const inputClass =
  "w-full border border-line bg-pit/80 px-3 py-2 text-[13px] text-text placeholder:text-dim/80 outline-none transition-colors duration-200 focus:border-signal/70 focus:bg-pit";

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="group flex w-full items-start gap-3 border border-transparent px-1 py-1.5 text-left transition-colors hover:border-line hover:bg-white/[0.02]"
    >
      <span
        className={`relative mt-0.5 h-[18px] w-[32px] shrink-0 border transition-colors duration-200 ${
          checked ? "border-signal/70 bg-signal/25" : "border-line2 bg-pit"
        }`}
      >
        <span
          className={`absolute top-[2px] h-[12px] w-[12px] transition-all duration-200 ${
            checked ? "left-[16px] bg-signal" : "left-[2px] bg-dim"
          }`}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-[12.5px] font-semibold text-text group-hover:text-signal">
          {label}
        </span>
        {description ? (
          <span className="mt-0.5 block text-[11.5px] leading-snug text-muted">{description}</span>
        ) : null}
      </span>
    </button>
  );
}

export function CopyButton({
  value,
  label = "Copy",
  size = "sm",
  variant = "outline",
  onCopied,
}: {
  value: string;
  label?: string;
  size?: "sm" | "md";
  variant?: "primary" | "outline" | "ghost" | "flare";
  onCopied?: () => void;
}) {
  const [done, setDone] = useState(false);
  const toast = useToast();

  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const area = document.createElement("textarea");
        area.value = value;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
      }
      setDone(true);
      toast("Caption copied", "ok", `${value.length} characters on your clipboard`);
      onCopied?.();
      setTimeout(() => setDone(false), 1600);
    } catch {
      toast("Clipboard blocked by the browser", "warn", "Select the text and copy manually");
    }
  };

  return (
    <Button onClick={copy} size={size} variant={done ? "primary" : variant}>
      {done ? <IconCheck className="h-3.5 w-3.5" /> : <IconCopy className="h-3.5 w-3.5" />}
      {done ? "Copied" : label}
    </Button>
  );
}

export function Stat({
  label,
  value,
  tone = "text",
}: {
  label: string;
  value: string | number;
  tone?: "text" | "signal" | "flare" | "amber";
}) {
  const color =
    tone === "signal"
      ? "text-signal"
      : tone === "flare"
        ? "text-flare"
        : tone === "amber"
          ? "text-amber"
          : "text-text";
  return (
    <div className="min-w-0">
      <p className="mono-num text-[9.5px] tracking-[0.2em] text-dim uppercase">{label}</p>
      <p className={`mono-num truncate text-[17px] font-semibold ${color}`}>{value}</p>
    </div>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} animate-spin`} aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.4" opacity="0.2" fill="none" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export function useMediaProxy(url: string | null | undefined): string {
  return useMemo(() => {
    if (!url) return "";
    if (url.startsWith("/api/media/stream")) return url;
    return `/api/media/stream?url=${encodeURIComponent(url)}`;
  }, [url]);
}
