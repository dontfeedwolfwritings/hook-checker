"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useUser, SignInButton, SignOutButton } from "@clerk/nextjs";
import { analyzeText, type Match } from "@/lib/rules";
import {
  analyzePlatform,
  getCharColor,
  getPlatformChecklist,
  PLATFORM_CONFIG,
  type CharColor,
  type CheckItem,
  type Platform,
} from "@/lib/platformModes";

// ─── types ────────────────────────────────────────────────────────────────────

interface Draft {
  id:       string;
  text:     string;
  platform: Platform;
  savedAt:  number;
}

interface SemanticIssue {
  type:     string;
  severity: "high" | "medium" | "low";
  note:     string;
  fix:      string;
}

interface DeepCheckResult {
  issues:  SemanticIssue[];
  verdict: "clean" | "minor" | "needs work";
  topFix:  string | null;
}

type DiffOp = { type: "equal" | "add" | "del"; text: string };

// ─── constants ────────────────────────────────────────────────────────────────

const DRAFT_KEY        = "hc_drafts";
const MAX_DRAFTS       = 5;
const USAGE_KEY        = "deepcheck_usage";
const FREE_LIMIT       = 3;
const STRIPE_LINK      = process.env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK ?? "#";

interface UsageData { count: number; date: string }

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}
function getUsage(): UsageData {
  if (typeof window === "undefined") return { count: 0, date: todayStr() };
  try {
    const raw = localStorage.getItem(USAGE_KEY);
    if (!raw) return { count: 0, date: todayStr() };
    const parsed = JSON.parse(raw) as UsageData;
    return parsed.date === todayStr() ? parsed : { count: 0, date: todayStr() };
  } catch { return { count: 0, date: todayStr() }; }
}
function incrementUsage(): UsageData {
  const next = { count: getUsage().count + 1, date: todayStr() };
  localStorage.setItem(USAGE_KEY, JSON.stringify(next));
  return next;
}

const MATCH_STYLE: Record<Match["type"], string> = {
  hard: "underline decoration-red-500   decoration-2 bg-red-950/40",
  slop: "underline decoration-amber-500 decoration-2 bg-amber-950/30",
  hook: "underline decoration-blue-500/60 decoration-2",
};

const CHAR_COLOR_CLASS: Record<CharColor, string> = {
  neutral: "text-[#252525]",
  green:   "text-emerald-600",
  amber:   "text-amber-500",
  red:     "text-red-500",
};

// ─── draft helpers ────────────────────────────────────────────────────────────

function loadDrafts(): Draft[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Draft[]) : [];
  } catch {
    return [];
  }
}

function persistDrafts(drafts: Draft[]): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts));
  } catch { /* storage full — silent */ }
}

// ─── diff helpers ─────────────────────────────────────────────────────────────

function wordDiff(before: string, after: string): DiffOp[] {
  const a = before.match(/\S+|\s+/g) ?? [];
  const b = after.match(/\S+|\s+/g) ?? [];
  const m = a.length;
  const n = b.length;

  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const ops: DiffOp[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.unshift({ type: "equal", text: a[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ type: "add", text: b[j - 1] });
      j--;
    } else {
      ops.unshift({ type: "del", text: a[i - 1] });
      i--;
    }
  }

  return ops;
}

// ─── score helpers ────────────────────────────────────────────────────────────

function computeScore(
  hardCount:  number,
  slopCount:  number,
  hookIssues: string[],
  platIssues: string[],
  deep:       DeepCheckResult | null,
): number {
  let s = 100;
  s -= hardCount * 15;
  s -= slopCount * 8;
  s -= (hookIssues.length + platIssues.length) * 10;
  if (deep) {
    for (const issue of deep.issues) {
      s -= issue.severity === "high" ? 12 : issue.severity === "medium" ? 6 : 3;
    }
  }
  return Math.max(0, s);
}

function scoreLabel(n: number): string {
  if (n >= 90) return "Clean";
  if (n >= 75) return "Strong";
  if (n >= 60) return "Needs work";
  return "Major issues";
}

function scoreColor(n: number): string {
  if (n >= 75) return "text-emerald-500";
  if (n >= 60) return "text-amber-500";
  return "text-red-500";
}

// ─── segment builder ──────────────────────────────────────────────────────────

interface Segment {
  text:  string;
  start: number;
  match: Match | null;
}

function buildSegments(text: string, matches: Match[]): Segment[] {
  if (!text) return [];

  const PRIORITY: Record<Match["type"], number> = { hard: 3, slop: 2, hook: 1 };
  const pts = new Set<number>([0, text.length]);
  for (const m of matches) {
    if (m.start >= 0 && m.start < text.length) pts.add(m.start);
    if (m.end > 0 && m.end <= text.length) pts.add(m.end);
  }

  const sorted = Array.from(pts).sort((a, b) => a - b);
  const segments: Segment[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end   = sorted[i + 1];
    let best: Match | null = null;
    for (const m of matches) {
      if (m.start <= start && m.end >= end) {
        if (!best || PRIORITY[m.type] > PRIORITY[best.type]) best = m;
      }
    }
    segments.push({ text: text.slice(start, end), start, match: best });
  }

  return segments;
}

// ─── highlight span ───────────────────────────────────────────────────────────

function HighlightSpan({ seg }: { seg: Segment }) {
  const [show, setShow] = useState(false);
  const { text, match } = seg;

  if (!match) return <span>{text}</span>;

  return (
    <span
      className={`relative cursor-help ${MATCH_STYLE[match.type]}`}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {text}
      {show && (
        <span className="pointer-events-none absolute bottom-full left-0 z-20 mb-1.5 whitespace-nowrap rounded border border-[#2a2a2a] bg-[#141414] px-2.5 py-1 font-mono text-[11px] text-[#c8c4bc] shadow-2xl">
          {match.label}
        </span>
      )}
    </span>
  );
}

// ─── highlighted preview ──────────────────────────────────────────────────────

function HighlightedPreview({
  text,
  matches,
  platform,
}: {
  text:     string;
  matches:  Match[];
  platform: Platform;
}) {
  const segments = useMemo(() => buildSegments(text, matches), [text, matches]);

  return (
    <>
      <div className="flex items-center justify-between border-b border-[#181818] px-5 py-2">
        <span className="font-mono text-[10px] text-[#282828]">Preview</span>
        <span className="font-mono text-[10px] text-[#2a2a2a]">
          {PLATFORM_CONFIG[platform].tabLabel} rules active
        </span>
      </div>

      {!text ? (
        <div className="px-5 py-4 font-mono text-sm italic text-[#2e2e2e]">
          Preview will appear here…
        </div>
      ) : (
        <div
          className="px-5 py-5 text-[15px] leading-relaxed text-[#e8e4dc]"
          style={{ fontFamily: "Georgia, 'Times New Roman', serif", whiteSpace: "pre-wrap" }}
        >
          {segments.map((seg) => (
            <HighlightSpan key={seg.start} seg={seg} />
          ))}
        </div>
      )}
    </>
  );
}

// ─── backdrop span ────────────────────────────────────────────────────────────
// Renders the highlight colour. Passes its DOM ref up so HighlightEditor can
// do bounding-rect hit-testing for hover tooltips (backdrop is pointer-events:none).

function BackdropSpan({
  seg,
  onRef,
}: {
  seg:   Segment;
  onRef?: (el: HTMLSpanElement | null) => void;
}) {
  const { text, match } = seg;
  if (!match) return <span>{text}</span>;
  return (
    <span ref={onRef} className={MATCH_STYLE[match.type]}>
      {text}
    </span>
  );
}

// ─── inline-highlight tooltip ─────────────────────────────────────────────────

const TOOLTIP_BADGE: Record<Match["type"], { label: string; cls: string }> = {
  hard: { label: "VIOLATION", cls: "text-red-400"    },
  slop: { label: "AI SLOP",   cls: "text-amber-400"  },
  hook: { label: "HOOK",      cls: "text-blue-400"   },
};

const TOOLTIP_HINT: Record<Match["type"], string> = {
  hard: "→ Remove — hard rule violation",
  slop: "→ Delete or rephrase — signals AI-written copy",
  hook: "→ Strengthen the hook: add a name, number, or contradiction",
};

function HighlightTooltip({
  match,
  x,
  y,
}: {
  match: Match;
  x:     number;
  y:     number;
}) {
  const { label, cls } = TOOLTIP_BADGE[match.type];
  // Keep tooltip on screen — flip below finger/cursor if near top edge
  // Use 90 px offset so a thumb doesn't occlude the card on mobile
  const top = y > 100 ? y - 90 : y + 28;

  return (
    <div
      className="pointer-events-none fixed z-50 max-w-xs rounded border border-[#2a2a2a] bg-[#141414] px-3 py-2 shadow-2xl"
      style={{ left: x, top, transform: "translateX(-40%)" }}
    >
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest">
        <span className={cls}>{label}</span>
        <span className="text-[#555]">·</span>
        <span className="text-[#c8c4bc]">{match.label}</span>
      </div>
      <div className="mt-1 font-mono text-[10px] text-[#444]">
        {TOOLTIP_HINT[match.type]}
      </div>
    </div>
  );
}

// ─── inline highlight editor ──────────────────────────────────────────────────
// Transparent textarea overlaid on a highlight-rendering backdrop.
// Desktop: mousemove hit-tests backdrop span bounding rects → hover tooltip.
// Mobile:  touchstart starts a 500 ms long-press timer → same hit-test → tooltip.
//          touchmove > 8 px cancels the timer so normal scrolling is unaffected.
//          touchend dismisses the tooltip after 1.5 s so the user has time to read.

function HighlightEditor({
  text,
  matches,
  onChange,
}: {
  text:     string;
  matches:  Match[];
  onChange: (t: string) => void;
}) {
  const textareaRef     = useRef<HTMLTextAreaElement>(null);
  const backdropRef     = useRef<HTMLDivElement>(null);
  const spanRefs        = useRef<Map<number, HTMLSpanElement>>(new Map());
  const longPressTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPos   = useRef<{ x: number; y: number } | null>(null);
  const dismissTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const segments        = useMemo(() => buildSegments(text, matches), [text, matches]);

  const [tooltip, setTooltip] = useState<{ match: Match; x: number; y: number } | null>(null);

  // Auto-expand textarea height
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  // Span refs are managed by the onRef callbacks in BackdropSpan —
  // React calls onRef(null) on unmount and onRef(el) on mount, so the
  // Map stays current automatically. No manual clearing needed.

  // Shared hit-test: returns the first Match whose backdrop span contains (x, y)
  function findMatchAtPoint(x: number, y: number): Match | null {
    for (const [start, el] of Array.from(spanRefs.current)) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        const m = matches.find((m) => m.start === start);
        if (m) return m;
      }
    }
    return null;
  }

  // Keep backdrop scroll in sync with textarea
  function handleScroll() {
    if (backdropRef.current && textareaRef.current) {
      backdropRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }

  // ── Desktop: hover ──────────────────────────────────────────────────────────
  function handleMouseMove(e: React.MouseEvent<HTMLTextAreaElement>) {
    const m = findMatchAtPoint(e.clientX, e.clientY);
    setTooltip(m ? { match: m, x: e.clientX, y: e.clientY } : null);
  }

  // ── Mobile: long-press ──────────────────────────────────────────────────────
  function handleTouchStart(e: React.TouchEvent<HTMLTextAreaElement>) {
    const t = e.touches[0];
    const x = t.clientX;
    const y = t.clientY;
    touchStartPos.current = { x, y };

    if (dismissTimer.current) clearTimeout(dismissTimer.current);

    longPressTimer.current = setTimeout(() => {
      const m = findMatchAtPoint(x, y);
      if (m) setTooltip({ match: m, x, y });
    }, 300);
  }

  function handleTouchMove(e: React.TouchEvent<HTMLTextAreaElement>) {
    if (!longPressTimer.current || !touchStartPos.current) return;
    const t   = e.touches[0];
    const dx  = t.clientX - touchStartPos.current.x;
    const dy  = t.clientY - touchStartPos.current.y;
    if (Math.sqrt(dx * dx + dy * dy) > 8) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
      setTooltip(null);
    }
  }

  function handleTouchEnd() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    // Keep tooltip visible for 1.5 s so the user can read it
    dismissTimer.current = setTimeout(() => setTooltip(null), 1500);
  }

  return (
    <>
      <div className="relative bg-[#111]">
        {/* ── Backdrop: visible highlighted text (pointer-events:none) ── */}
        <div
          ref={backdropRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-5 py-5 text-base lg:text-[15px] leading-relaxed text-[#e8e4dc]"
          style={{ fontFamily: "Georgia, 'Times New Roman', serif", wordWrap: "break-word" }}
        >
          {segments.map((seg) => (
            <BackdropSpan
              key={seg.start}
              seg={seg}
              onRef={seg.match ? (el) => {
                if (el) spanRefs.current.set(seg.start, el);
                else    spanRefs.current.delete(seg.start);
              } : undefined}
            />
          ))}
          &#8203;
        </div>

        {/* ── Textarea: captures input, transparent so backdrop shows through ── */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onScroll={handleScroll}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setTooltip(null)}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          placeholder="Paste or type your copy. Issues highlight in real time."
          spellCheck={false}
          rows={1}
          className="relative z-10 w-full resize-none bg-transparent px-5 py-5 text-base lg:text-[15px] leading-relaxed text-transparent placeholder-[#2a2a2a] outline-none"
          style={{
            fontFamily: "Georgia, 'Times New Roman', serif",
            caretColor: "#e8e4dc",
            minHeight:  "220px",
            overflowY:  "hidden",
            wordWrap:   "break-word",
          }}
        />
      </div>

      {/* ── Tooltip: rendered outside relative container so z-index is global ── */}
      {tooltip && <HighlightTooltip match={tooltip.match} x={tooltip.x} y={tooltip.y} />}
    </>
  );
}

// ─── score card ───────────────────────────────────────────────────────────────

function ScoreCard({
  score,
  empty,
  onShare,
}: {
  score:   number;
  empty:   boolean;
  onShare: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function handleShare() {
    onShare();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="border-b border-[#191919] py-5">
      <div className="flex items-end justify-between">
        <div className="flex items-baseline gap-2">
          <span
            className={`font-mono text-[64px] font-bold leading-none tabular-nums transition-colors ${
              empty ? "text-[#242424]" : scoreColor(score)
            }`}
          >
            {empty ? "—" : score}
          </span>
          {!empty && (
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#3a3a3a]">
              / 100
            </span>
          )}
        </div>

        <button
          onClick={handleShare}
          disabled={empty}
          className={`mb-1 rounded border px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest transition-colors ${
            empty
              ? "cursor-not-allowed border-[#191919] text-[#2a2a2a]"
              : copied
              ? "border-emerald-800 text-emerald-600"
              : "border-[#1e1e1e] text-[#383838] hover:border-[#2e2e2e] hover:text-[#666]"
          }`}
        >
          {copied ? "Copied!" : "Share score"}
        </button>
      </div>

      {!empty && (
        <p className={`mt-1 font-mono text-[11px] ${scoreColor(score)} opacity-60`}>
          {scoreLabel(score)}
        </p>
      )}
    </div>
  );
}

// ─── score breakdown ──────────────────────────────────────────────────────────

function ScoreBreakdown({
  hardCount,
  slopCount,
  hookIssues,
  platIssues,
  deepResult,
}: {
  hardCount:  number;
  slopCount:  number;
  hookIssues: string[];
  platIssues: string[];
  deepResult: DeepCheckResult | null;
}) {
  const hookCount = hookIssues.length + platIssues.length;
  const items: string[] = [];

  if (hardCount > 0)
    items.push(`${hardCount} hard violation${hardCount > 1 ? "s" : ""} (−${hardCount * 15})`);
  if (slopCount > 0)
    items.push(`${slopCount} slop trope${slopCount > 1 ? "s" : ""} (−${slopCount * 8})`);
  if (hookCount > 0)
    items.push(`${hookCount} hook issue${hookCount > 1 ? "s" : ""} (−${hookCount * 10})`);
  if (deepResult && deepResult.issues.length > 0) {
    const penalty = deepResult.issues.reduce(
      (s, i) => s + (i.severity === "high" ? 12 : i.severity === "medium" ? 6 : 3),
      0,
    );
    items.push(`${deepResult.issues.length} semantic issue${deepResult.issues.length > 1 ? "s" : ""} (−${penalty})`);
  }

  if (items.length === 0) return null;

  return (
    <div className="pb-4 pt-0">
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-1.5 font-mono text-[10px] text-[#363636]">
            <span className="text-red-900/70">↓</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── flagged phrases ──────────────────────────────────────────────────────────

const VIOLATION_FIX: Record<string, string> = {
  "Em dash":          "Replace — with a period or colon.",
  "Spot on":          "Replace with 'exactly right' or just cut it.",
  "it's not X it's Y": "State your point directly without the construction.",
};

const SLOP_FIX_DEFAULT = "Replace with something specific to your actual point.";
const HARD_FIX_DEFAULT = "Remove — this phrase signals AI-written copy.";

function FlaggedPhrases({ matches }: { matches: Match[] }) {
  const inline = matches.filter((m) => m.type === "hard" || m.type === "slop");
  if (inline.length === 0) return null;

  // Deduplicate by label
  const seen = new Set<string>();
  const unique: Match[] = [];
  for (const m of inline) {
    if (!seen.has(m.label)) { seen.add(m.label); unique.push(m); }
  }

  return (
    <div className="border-b border-[#191919] py-4">
      <p className="mb-2.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[#4a4a4a]">
        Flagged phrases
      </p>
      <ul className="space-y-3">
        {unique.map((m) => (
          <li key={m.label}>
            <div className="flex items-center gap-2">
              <span
                className={`rounded px-1.5 py-0.5 font-mono text-[9px] uppercase ${
                  m.type === "hard"
                    ? "bg-red-950/40 text-red-600"
                    : "bg-amber-950/30 text-amber-600"
                }`}
              >
                {m.type === "hard" ? "violation" : "slop"}
              </span>
              <span className="font-mono text-[11px] text-[#555]">{m.label}</span>
            </div>
            <p className="mt-0.5 font-mono text-[10px] leading-snug text-[#3a3a3a]">
              → {VIOLATION_FIX[m.label] ?? (m.type === "hard" ? HARD_FIX_DEFAULT : SLOP_FIX_DEFAULT)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── stat card ────────────────────────────────────────────────────────────────

function StatCard({
  count,
  label,
  desc,
  activeColor,
}: {
  count:       number;
  label:       string;
  desc:        string;
  activeColor: string;
}) {
  return (
    <div className="border-b border-[#191919] py-5">
      <div className="mb-0.5 flex items-baseline gap-3">
        <span
          className={`font-mono text-[52px] font-bold leading-none tabular-nums transition-colors ${
            count > 0 ? activeColor : "text-[#242424]"
          }`}
        >
          {count}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#4a4a4a]">
          {label}
        </span>
      </div>
      <p className="font-mono text-[11px] text-[#303030]">{desc}</p>
    </div>
  );
}

// ─── hook checklist ───────────────────────────────────────────────────────────

const HOOK_HINTS: Record<string, string> = {
  "Proper noun in first sentence":  "Name a specific person, company, or brand in your opening line.",
  "Contradiction or tension":       "State something unexpected — \"X did Y, despite what you'd expect.\"",
  "Role, number, or dollar figure": "Add a credential: job title, specific number, or dollar amount.",
  "Number, name, or curiosity gap": "Open with a number, a name, 'How / Why / What', or end with '?'",
  "Credibility signal present":     "Add proof: a metric, a named role, or a measurable result.",
  "First line as standalone hook":  "Lead with the surprising claim, not 'Check out my video…'",
  "Named person or brand present":  "Drop a specific name — person, brand, or character.",
};

function HookChecklist({ items }: { items: CheckItem[] }) {
  return (
    <div className="border-b border-[#191919] py-5">
      <p className="mb-3.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[#4a4a4a]">
        Hook strength
      </p>
      <ul className="space-y-3">
        {items.map(({ label, passed }) => (
          <li key={label} className="flex items-start gap-2.5">
            <span
              className={`mt-px font-mono text-[13px] font-bold leading-tight ${
                passed === null
                  ? "text-[#252525]"
                  : passed
                  ? "text-emerald-500"
                  : "text-red-500"
              }`}
            >
              {passed === null ? "–" : passed ? "✓" : "✗"}
            </span>
            <div>
              <span
                className={`text-[13px] ${
                  passed === null
                    ? "text-[#2e2e2e]"
                    : passed
                    ? "text-[#999]"
                    : "text-[#555]"
                }`}
              >
                {label}
              </span>
              {passed === false && HOOK_HINTS[label] && (
                <p className="mt-0.5 font-mono text-[10px] leading-snug text-[#3a3a3a]">
                  → {HOOK_HINTS[label]}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── platform warnings ────────────────────────────────────────────────────────

function PlatformWarnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="border-b border-[#191919] py-4">
      <p className="mb-2.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[#4a4a4a]">
        Platform notes
      </p>
      <ul className="space-y-2">
        {warnings.map((w, i) => (
          <li key={i} className="flex items-start gap-2 text-[11px]">
            <span className="mt-px font-mono text-amber-600">!</span>
            <span className="font-mono text-[#555]">{w}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── save draft bar ───────────────────────────────────────────────────────────

function SaveDraftBar({
  drafts,
  onSave,
  onLoad,
  onDelete,
}: {
  drafts:   Draft[];
  onSave:   () => void;
  onLoad:   (d: Draft) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="flex items-center gap-3 border-b border-[#181818] px-5 py-2.5">
      <button
        onClick={onSave}
        className="font-mono text-[11px] text-[#383838] transition-colors hover:text-[#999]"
      >
        Save draft
      </button>

      {drafts.length > 0 && (
        <>
          <span className="font-mono text-[#1e1e1e]">·</span>
          <div ref={ref} className="relative">
            <button
              onClick={() => setOpen((o) => !o)}
              className="font-mono text-[11px] text-[#2e2e2e] transition-colors hover:text-[#666]"
            >
              {drafts.length} saved {open ? "▾" : "▸"}
            </button>

            {open && (
              <div className="absolute left-0 top-full z-30 mt-1 w-72 rounded border border-[#222] bg-[#111] shadow-2xl">
                {drafts.map((d) => (
                  <div
                    key={d.id}
                    className="group flex items-start gap-2 border-b border-[#181818] px-3 py-2.5 last:border-0"
                  >
                    <button
                      onClick={() => { onLoad(d); setOpen(false); }}
                      className="flex-1 text-left"
                    >
                      <div className="font-mono text-[10px] text-[#444]">
                        {new Date(d.savedAt).toLocaleDateString()}{" "}
                        {new Date(d.savedAt).toLocaleTimeString([], {
                          hour:   "2-digit",
                          minute: "2-digit",
                        })}
                        {" · "}
                        {PLATFORM_CONFIG[d.platform].tabLabel}
                      </div>
                      <div
                        className="mt-0.5 text-[12px] leading-snug text-[#777]"
                        style={{ fontFamily: "Georgia, serif" }}
                      >
                        {d.text.slice(0, 50)}
                        {d.text.length > 50 ? "…" : ""}
                      </div>
                    </button>
                    <button
                      onClick={() => onDelete(d.id)}
                      className="mt-0.5 font-mono text-[11px] text-[#2a2a2a] opacity-0 transition-opacity hover:text-red-700 group-hover:opacity-100"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── diff view ────────────────────────────────────────────────────────────────

function DiffView({ before, after }: { before: string; after: string }) {
  const ops = useMemo(() => wordDiff(before, after), [before, after]);
  const hasChanges = ops.some((op) => op.type !== "equal");

  if (!hasChanges) {
    return (
      <div className="px-5 py-4 font-mono text-[12px] italic text-[#2e2e2e]">
        No changes from snapshot.
      </div>
    );
  }

  return (
    <div
      className="px-5 py-5 text-[14px] leading-relaxed"
      style={{ fontFamily: "Georgia, 'Times New Roman', serif", whiteSpace: "pre-wrap" }}
    >
      {ops.map((op, i) => {
        if (op.type === "equal")
          return <span key={i} className="text-[#555]">{op.text}</span>;
        if (op.type === "add")
          return (
            <span key={i} className="rounded bg-emerald-950/60 text-emerald-400">
              {op.text}
            </span>
          );
        return (
          <span key={i} className="rounded bg-red-950/60 text-red-500 line-through opacity-75">
            {op.text}
          </span>
        );
      })}
    </div>
  );
}

// ─── platform selector ────────────────────────────────────────────────────────

function PlatformSelector({
  value,
  onChange,
  charCount,
}: {
  value:     Platform;
  onChange:  (p: Platform) => void;
  charCount: number;
}) {
  const { note }   = PLATFORM_CONFIG[value];
  const colorKey   = getCharColor(charCount, value);
  const colorClass = CHAR_COLOR_CLASS[colorKey];

  return (
    <div className="border-b border-[#191919] py-5">
      <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[#4a4a4a]">
        Platform
      </p>

      <div className="mb-3 flex rounded bg-[#0d0d0d] p-0.5">
        {(Object.keys(PLATFORM_CONFIG) as Platform[]).map((p) => (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={`flex-1 rounded py-1.5 font-mono text-[11px] transition-all ${
              value === p
                ? "bg-[#1c1c1c] text-[#c8c4bc]"
                : "text-[#383838] hover:text-[#666]"
            }`}
          >
            {PLATFORM_CONFIG[p].tabLabel}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] text-[#3a3a3a]">{note}</span>
        <span className={`font-mono text-[11px] tabular-nums transition-colors ${colorClass}`}>
          {charCount.toLocaleString()} chars
        </span>
      </div>

      {colorKey === "red" && (
        <p className="mt-1.5 font-mono text-[10px] text-red-800">
          Over soft limit ({PLATFORM_CONFIG[value].limits.softMax.toLocaleString()} chars)
        </p>
      )}
    </div>
  );
}

// ─── hook examples ────────────────────────────────────────────────────────────

const HOOK_EXAMPLES = [
  {
    principle: "Named person + contradiction + implied proof",
    weak:      "Attention spans did not disappear.",
    strong:    "Zaria Parvez won the Super Bowl twice without buying a spot. Tell me again that attention spans are shrinking.",
  },
  {
    principle: "Named person + dollar credential + contradiction",
    weak:      "AI is changing how brands market themselves.",
    strong:    "Ben Affleck ran the best ad for a $600M AI company by going on Joe Rogan and calling AI shitty.",
  },
  {
    principle: "Named person + superlative credential + action against self-interest",
    weak:      "YouTube creators are pushing back against the algorithm.",
    strong:    "PewDiePie, the longest-reigning most-subscribed creator in YouTube history, just built a tool to destroy his own recommendation feed.",
  },
] as const;

const HOOK_FORMULA =
  "[Named person]  +  [credential or record]  +  [did something that contradicts what you'd expect]  +  [cultural moment happening NOW]";

function HookExamples() {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-[#191919]">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between py-5"
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#4a4a4a]">
          Hook examples
        </span>
        <span
          className={`font-mono text-[12px] text-[#2e2e2e] transition-transform duration-200 ${
            open ? "rotate-90" : ""
          }`}
        >
          ▸
        </span>
      </button>

      <div
        className={`grid transition-all duration-300 ease-in-out ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="space-y-6 pb-6">
            {HOOK_EXAMPLES.map((ex, i) => (
              <div key={i}>
                <p className="mb-3 font-mono text-[9px] uppercase tracking-[0.18em] text-[#2e2e2e]">
                  {ex.principle}
                </p>
                <div className="mb-2">
                  <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-red-900/80">
                    Weak
                  </span>
                  <p className="mt-1 text-[12px] italic leading-snug text-[#3c3c3c]">
                    &ldquo;{ex.weak}&rdquo;
                  </p>
                </div>
                <div>
                  <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-emerald-900/80">
                    Strong
                  </span>
                  <p
                    className="mt-1 text-[13px] leading-snug text-[#b0aba3]"
                    style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
                  >
                    &ldquo;{ex.strong}&rdquo;
                  </p>
                </div>
              </div>
            ))}

            <div className="pt-1">
              <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.18em] text-[#2e2e2e]">
                The formula
              </p>
              <p className="rounded border border-[#1a1a1a] bg-[#090909] px-3 py-3 font-mono text-[11px] leading-relaxed text-[#4a4a4a]">
                {HOOK_FORMULA}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── deep check ───────────────────────────────────────────────────────────────

// ─── upgrade modal ────────────────────────────────────────────────────────────

function UpgradeModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-sm rounded border border-[#252525] bg-[#111] p-7 text-center shadow-2xl">
        <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[#555]">
          Daily limit reached
        </p>
        <h2 className="mb-3 text-[18px] font-normal leading-snug text-[#e8e4dc]">
          You&apos;ve used your 3 free checks today
        </h2>
        <p className="mb-6 text-[13px] leading-relaxed text-[#666]">
          Upgrade for unlimited deep checks — $5/month
        </p>
        <a
          href={STRIPE_LINK}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-3 block w-full rounded border border-[#444] bg-[#1a1a1a] py-2.5 font-mono text-[11px] uppercase tracking-[0.15em] text-[#c8c4bc] transition-colors hover:border-[#666] hover:text-white"
        >
          Upgrade
        </a>
        <button
          onClick={onClose}
          className="block w-full py-2 font-mono text-[10px] uppercase tracking-[0.15em] text-[#383838] transition-colors hover:text-[#666]"
        >
          Maybe tomorrow
        </button>
      </div>
    </div>
  );
}

// ─── upgrade banner ───────────────────────────────────────────────────────────

function UpgradeBanner({ isSignedIn }: { isSignedIn: boolean }) {
  const remaining = FREE_LIMIT - getUsage().count;
  if (isSignedIn) {
    return (
      <div className="border-t border-[#181818] py-4">
        <p className="font-mono text-[10px] text-emerald-700">
          Pro — unlimited deep checks ✓
        </p>
      </div>
    );
  }
  return (
    <div className="border-t border-[#181818] py-4">
      <a
        href={STRIPE_LINK}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-[10px] text-[#383838] transition-colors hover:text-[#666]"
      >
        {remaining > 0 ? `${remaining} free deep check${remaining === 1 ? "" : "s"} left today` : "No free checks left today"} · Upgrade for unlimited →
      </a>
    </div>
  );
}

// ─── deep check ───────────────────────────────────────────────────────────────

function DeepCheckSection({
  text,
  platform,
  isSignedIn,
  onResult,
}: {
  text:       string;
  platform:   Platform;
  isSignedIn: boolean;
  onResult:   (result: DeepCheckResult | null, snapText: string | null) => void;
}) {
  const [loading, setLoading]           = useState(false);
  const [result, setResult]             = useState<DeepCheckResult | null>(null);
  const [error, setError]               = useState<string | null>(null);
  const [showUpgrade, setShowUpgrade]   = useState(false);

  async function run() {
    const snapText = text;
    setLoading(true);
    setError(null);
    setResult(null);
    onResult(null, null);
    try {
      const res = await fetch("/api/deepcheck", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ text, platform }),
      });
      if (res.status === 429) {
        const body = await res.json().catch(() => ({}));
        const msg  = (body as { error?: string }).error ?? "";
        if (msg.toLowerCase().includes("daily")) {
          setShowUpgrade(true);
          return;
        }
        throw new Error(msg || "Rate limit exceeded");
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      // Track locally for the banner display
      if (!isSignedIn) incrementUsage();
      const data = (await res.json()) as DeepCheckResult;
      setResult(data);
      onResult(data, snapText);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  const disabled = !text.trim() || loading;

  return (
    <div className="py-5">
      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
      <button
        onClick={run}
        disabled={disabled}
        className={`w-full rounded py-2.5 font-mono text-[11px] uppercase tracking-[0.15em] transition-all ${
          disabled
            ? "cursor-not-allowed bg-[#0d0d0d] text-[#242424]"
            : "border border-[#252525] bg-[#0d0d0d] text-[#555] hover:border-[#333] hover:text-[#999]"
        }`}
      >
        {loading ? "Analysing…" : "Deep Check (AI)"}
      </button>

      {error && (
        <p className="mt-3 font-mono text-[11px] text-red-600">{error}</p>
      )}

      {result !== null && result.issues.length === 0 && !error && (
        <p className="mt-3 font-mono text-[11px] text-emerald-700">
          No semantic issues found.
        </p>
      )}

      {result?.topFix && (
        <div className="mt-3 rounded border border-[#1e1e1e] bg-[#090909] p-3">
          <p className="mb-1 font-mono text-[9px] uppercase tracking-widest text-[#383838]">
            Top fix
          </p>
          <p className="text-[12px] italic leading-snug text-[#777]">{result.topFix}</p>
        </div>
      )}

      {result && result.issues.length > 0 && (
        <ul className="mt-3 space-y-2">
          {result.issues.map((issue, i) => (
            <li key={i} className="rounded border border-[#191919] bg-[#0b0b0b] p-3">
              <div className="mb-1 flex items-center gap-2">
                <p className="font-mono text-[10px] uppercase tracking-widest text-[#404040]">
                  {issue.type}
                </p>
                <span
                  className={`rounded px-1.5 py-0.5 font-mono text-[9px] uppercase ${
                    issue.severity === "high"
                      ? "bg-red-950/40 text-red-600"
                      : issue.severity === "medium"
                      ? "bg-amber-950/40 text-amber-600"
                      : "bg-[#151515] text-[#444]"
                  }`}
                >
                  {issue.severity}
                </span>
              </div>
              <p className="mb-1.5 text-[12px] leading-snug text-[#888]">{issue.note}</p>
              <p className="text-[11px] italic leading-snug text-[#4a4a4a]">{issue.fix}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── main export ──────────────────────────────────────────────────────────────

export default function PostEditor() {
  const { isSignedIn = false, user }        = useUser();
  const isPro = user?.publicMetadata?.plan === "pro";
  const [text, setText]                     = useState("");
  const [platform, setPlatform]             = useState<Platform>("linkedin");
  const [drafts, setDrafts]                 = useState<Draft[]>([]);
  const [deepResult, setDeepResult]         = useState<DeepCheckResult | null>(null);
  const [diffSnapshot, setDiffSnapshot]     = useState<string | null>(null);
  const [showDiff, setShowDiff]             = useState(false);
  const [mobileTab, setMobileTab]           = useState<"write" | "results">("write");

  useEffect(() => { setDrafts(loadDrafts()); }, []);

  const analysis = useMemo(() => {
    const EMPTY = {
      matches:            [] as Match[],
      hardCount:          0,
      slopCount:          0,
      hookIssues:         [] as string[],
      platformHookIssues: [] as string[],
      warnings:           [] as string[],
    };
    if (!text.trim()) return EMPTY;

    const base = analyzeText(text);
    const { matches: pMatches, platformHookIssues, warnings } = analyzePlatform(text, platform);

    const allMatches = [...base.matches, ...pMatches].sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      const P: Record<Match["type"], number> = { hard: 0, slop: 1, hook: 2 };
      return P[a.type] - P[b.type];
    });

    return {
      matches:            allMatches,
      hardCount:          allMatches.filter((m) => m.type === "hard").length,
      slopCount:          allMatches.filter((m) => m.type === "slop").length,
      hookIssues:         base.hookIssues,
      platformHookIssues,
      warnings,
    };
  }, [text, platform]);

  const score = useMemo(() => {
    if (!text.trim()) return 100;
    return computeScore(
      analysis.hardCount,
      analysis.slopCount,
      analysis.hookIssues,
      analysis.platformHookIssues,
      deepResult,
    );
  }, [analysis, deepResult, text]);

  function handleDeepResult(result: DeepCheckResult | null, snapText: string | null) {
    setDeepResult(result);
    if (result !== null && snapText !== null) {
      setDiffSnapshot(snapText);
      setShowDiff(false);
      setMobileTab("results"); // auto-switch to results pane on mobile
    }
  }

  function handleSaveDraft() {
    if (!text.trim()) return;
    const draft: Draft = {
      id:      `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      text,
      platform,
      savedAt: Date.now(),
    };
    const updated = [draft, ...drafts.filter((d) => d.text !== text)].slice(0, MAX_DRAFTS);
    setDrafts(updated);
    persistDrafts(updated);
  }

  function handleLoadDraft(d: Draft) {
    setText(d.text);
    setPlatform(d.platform);
    setDeepResult(null);
    setDiffSnapshot(null);
    setShowDiff(false);
  }

  function handleDeleteDraft(id: string) {
    const updated = drafts.filter((d) => d.id !== id);
    setDrafts(updated);
    persistDrafts(updated);
  }

  function handleShareScore() {
    const hookCount     = analysis.hookIssues.length + analysis.platformHookIssues.length;
    const semanticCount = deepResult?.issues.length ?? 0;
    const lines = [
      `Clean Copy Score: ${score}/100 — ${scoreLabel(score)}`,
      ``,
      `Hard violations: ${analysis.hardCount}${analysis.hardCount > 0 ? ` (−${analysis.hardCount * 15})` : ""}`,
      `AI slop: ${analysis.slopCount}${analysis.slopCount > 0 ? ` (−${analysis.slopCount * 8})` : ""}`,
      `Hook issues: ${hookCount}${hookCount > 0 ? ` (−${hookCount * 10})` : ""}`,
      `Semantic issues: ${semanticCount > 0 ? String(semanticCount) : "none"}`,
    ];
    navigator.clipboard.writeText(lines.join("\n")).catch(() => {});
  }

  const hasDiff = diffSnapshot !== null && text !== diffSnapshot;

  return (
    <div
      className="flex min-h-screen flex-col bg-[#0e0e0e] text-[#e8e4dc]"
      style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
    >
      {/* ── Mobile tab bar (hidden on desktop) ── */}
      <div className="flex border-b border-[#181818] bg-[#0e0e0e] lg:hidden">
        <button
          onClick={() => setMobileTab("write")}
          className={`flex-1 py-3 font-mono text-[10px] uppercase tracking-widest transition-colors ${
            mobileTab === "write" ? "text-[#e8e4dc]" : "text-[#3a3a3a]"
          }`}
        >
          Write
        </button>
        <button
          onClick={() => setMobileTab("results")}
          className={`flex-1 py-3 font-mono text-[10px] uppercase tracking-widest transition-colors ${
            mobileTab === "results" ? "text-[#e8e4dc]" : "text-[#3a3a3a]"
          }`}
        >
          {text.trim() ? `Results · ${score}` : "Results"}
        </button>
      </div>

      {/* ── Content area ── */}
      <div className="flex flex-1 flex-col lg:flex-row">

      {/* ── Left pane ── */}
      <div className={`${mobileTab === "results" ? "hidden lg:flex" : "flex"} flex-col lg:w-[60%] lg:border-r lg:border-[#181818]`}>
        <div className="flex items-center justify-between border-b border-[#181818] px-5 py-3">
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#3a3a3a]">
            Clean Copy
          </span>
          {isSignedIn ? (
            <SignOutButton>
              <button className="font-mono text-[10px] uppercase tracking-[0.15em] text-[#2a2a2a] transition-colors hover:text-[#555]">
                Sign out
              </button>
            </SignOutButton>
          ) : (
            <SignInButton mode="modal">
              <button className="font-mono text-[10px] uppercase tracking-[0.15em] text-[#2a2a2a] transition-colors hover:text-[#555]">
                Sign in
              </button>
            </SignInButton>
          )}
        </div>
        <SaveDraftBar
          drafts={drafts}
          onSave={handleSaveDraft}
          onLoad={handleLoadDraft}
          onDelete={handleDeleteDraft}
        />

        {/* ── Inline highlight editor ── */}
        <HighlightEditor
          text={text}
          matches={analysis.matches}
          onChange={setText}
        />

        {/* ── Diff toggle + view (only visible after a deep check with edits) ── */}
        {hasDiff && (
          <div className="border-t border-[#181818]">
            <div className="flex items-center justify-between px-5 py-2">
              <span className="font-mono text-[10px] text-[#383838]">
                Changed since last check
              </span>
              <button
                onClick={() => setShowDiff((s) => !s)}
                className={`font-mono text-[10px] uppercase tracking-widest transition-colors ${
                  showDiff
                    ? "text-emerald-700 hover:text-emerald-600"
                    : "text-[#383838] hover:text-[#666]"
                }`}
              >
                {showDiff ? "Hide diff" : "Show diff"}
              </button>
            </div>
            {showDiff && diffSnapshot && (
              <>
                <div className="flex items-center justify-between border-t border-[#181818] px-5 py-2">
                  <span className="font-mono text-[10px] text-[#282828]">Diff</span>
                  <span className="font-mono text-[10px] text-[#2a2a2a]">
                    <span className="text-emerald-900/80">+</span> added&nbsp;&nbsp;
                    <span className="text-red-900/80">−</span> removed
                  </span>
                </div>
                <DiffView before={diffSnapshot} after={text} />
              </>
            )}
          </div>
        )}
        <div className="border-t border-[#181818] px-5 py-3">
          <a
            href="https://cleancopy.io"
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#2a2a2a] hover:text-[#444] transition-colors"
          >
            cleancopy.io
          </a>
        </div>
      </div>

      {/* ── Right sidebar ── */}
      <aside className={`${mobileTab === "write" ? "hidden lg:block" : "block"} lg:sticky lg:top-0 lg:h-screen lg:w-[40%] lg:overflow-y-auto`}>
        <div className="px-7">
          <ScoreCard
            score={score}
            empty={!text.trim()}
            onShare={handleShareScore}
          />
          <ScoreBreakdown
            hardCount={analysis.hardCount}
            slopCount={analysis.slopCount}
            hookIssues={analysis.hookIssues}
            platIssues={analysis.platformHookIssues}
            deepResult={deepResult}
          />
          <StatCard
            count={analysis.hardCount}
            label="Hard violations"
            desc="Em dash · spot on · it's not X it's Y"
            activeColor="text-red-500"
          />
          <StatCard
            count={analysis.slopCount}
            label="AI slop tropes"
            desc="Villain labels · AI phrases · clichés"
            activeColor="text-amber-500"
          />
          <FlaggedPhrases matches={analysis.matches} />
          <HookChecklist
            items={getPlatformChecklist(
              analysis.hookIssues,
              analysis.platformHookIssues,
              platform,
              !text.trim(),
            )}
          />
          <PlatformWarnings warnings={analysis.warnings} />
          <HookExamples />
          <PlatformSelector
            value={platform}
            onChange={setPlatform}
            charCount={text.length}
          />
          <DeepCheckSection
            text={text}
            platform={platform}
            isSignedIn={isPro}
            onResult={handleDeepResult}
          />
          <UpgradeBanner isSignedIn={isPro} />
        </div>
      </aside>
      </div>{/* end content area */}
    </div>
  );
}
