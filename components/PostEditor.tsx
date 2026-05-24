"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

interface DeepIssue {
  category:   string;
  issue:      string;
  suggestion: string;
}

// ─── highlight styles ─────────────────────────────────────────────────────────

const MATCH_STYLE: Record<Match["type"], string> = {
  hard: "underline decoration-red-500   decoration-2 bg-red-950/40",
  slop: "underline decoration-amber-500 decoration-2 bg-amber-950/30",
  hook: "underline decoration-blue-500/60 decoration-2",
};

// ─── char-counter color map ───────────────────────────────────────────────────

const CHAR_COLOR_CLASS: Record<CharColor, string> = {
  neutral: "text-[#252525]",
  green:   "text-emerald-600",
  amber:   "text-amber-500",
  red:     "text-red-500",
};

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
      {/* Platform label bar */}
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

function HookChecklist({ items }: { items: CheckItem[] }) {
  return (
    <div className="border-b border-[#191919] py-5">
      <p className="mb-3.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[#4a4a4a]">
        Hook strength
      </p>
      <ul className="space-y-3">
        {items.map(({ label, passed }) => (
          <li key={label} className="flex items-start gap-2.5 text-[13px]">
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
            <span
              className={
                passed === null
                  ? "text-[#2e2e2e]"
                  : passed
                  ? "text-[#999]"
                  : "text-[#555]"
              }
            >
              {label}
            </span>
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

      {/* Ideal-range hint when in red zone */}
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
      {/* Toggle button */}
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

      {/*
        CSS grid-row trick for smooth height animation.
        The inner div needs min-h-0 so the grid item can actually collapse to 0
        when grid-template-rows is 0fr.
      */}
      <div
        className={`grid transition-all duration-300 ease-in-out ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="space-y-6 pb-6">

            {HOOK_EXAMPLES.map((ex, i) => (
              <div key={i}>
                {/* Principle */}
                <p className="mb-3 font-mono text-[9px] uppercase tracking-[0.18em] text-[#2e2e2e]">
                  {ex.principle}
                </p>

                {/* Weak */}
                <div className="mb-2">
                  <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-red-900/80">
                    Weak
                  </span>
                  <p className="mt-1 text-[12px] italic leading-snug text-[#3c3c3c]">
                    &ldquo;{ex.weak}&rdquo;
                  </p>
                </div>

                {/* Strong */}
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

            {/* Formula */}
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

function DeepCheckSection({ text, platform }: { text: string; platform: Platform }) {
  const [loading, setLoading] = useState(false);
  const [issues, setIssues]   = useState<DeepIssue[] | null>(null);
  const [error, setError]     = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    setIssues(null);
    try {
      const res = await fetch("/api/deep-check", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ text, platform }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setIssues(Array.isArray(data.issues) ? data.issues : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  const disabled = !text.trim() || loading;

  return (
    <div className="py-5">
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

      {issues !== null && issues.length === 0 && !error && (
        <p className="mt-3 font-mono text-[11px] text-emerald-700">
          No semantic issues found.
        </p>
      )}

      {issues && issues.length > 0 && (
        <ul className="mt-3 space-y-2">
          {issues.map((issue, i) => (
            <li key={i} className="rounded border border-[#191919] bg-[#0b0b0b] p-3">
              <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-[#404040]">
                {issue.category}
              </p>
              <p className="mb-1.5 text-[12px] leading-snug text-[#888]">
                {issue.issue}
              </p>
              <p className="text-[11px] italic leading-snug text-[#4a4a4a]">
                {issue.suggestion}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── main export ──────────────────────────────────────────────────────────────

export default function PostEditor() {
  const [text, setText]         = useState("");
  const [platform, setPlatform] = useState<Platform>("linkedin");
  const textareaRef             = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  // Run base + platform analysis on every text/platform change
  const analysis = useMemo(() => {
    const EMPTY_RESULT = {
      matches:            [] as Match[],
      hardCount:          0,
      slopCount:          0,
      hookIssues:         [] as string[],
      platformHookIssues: [] as string[],
      warnings:           [] as string[],
    };

    if (!text.trim()) return EMPTY_RESULT;

    const base = analyzeText(text);
    const { matches: pMatches, platformHookIssues, warnings } = analyzePlatform(text, platform);

    // Merge: base is already deduped; platform patterns are distinct, so concat is safe.
    // buildSegments handles rendering priority per-position.
    const allMatches = [...base.matches, ...pMatches].sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      // hard(0) < slop(1) < hook(2) → lower wins first position → hard takes precedence
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

  return (
    <div
      className="flex min-h-screen flex-col bg-[#0e0e0e] text-[#e8e4dc] lg:flex-row"
      style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
    >
      {/* ── Left pane ── */}
      <div className="flex flex-col lg:w-[60%] lg:border-r lg:border-[#181818]">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste or type your copy. Issues highlight in real time."
          spellCheck={false}
          rows={1}
          className="w-full resize-none bg-[#111] px-5 py-5 text-[15px] leading-relaxed text-[#e8e4dc] placeholder-[#2a2a2a] outline-none"
          style={{
            fontFamily: "Georgia, 'Times New Roman', serif",
            minHeight:  "220px",
            border:     "none",
            overflowY:  "hidden",
          }}
        />

        <div className="h-px bg-[#181818]" />

        <div className="min-h-[80px] flex-1">
          <HighlightedPreview
            text={text}
            matches={analysis.matches}
            platform={platform}
          />
        </div>
      </div>

      {/* ── Right sidebar ── */}
      <aside className="lg:sticky lg:top-0 lg:h-screen lg:w-[40%] lg:overflow-y-auto">
        <div className="px-7">
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
          <DeepCheckSection text={text} platform={platform} />
        </div>
      </aside>
    </div>
  );
}
