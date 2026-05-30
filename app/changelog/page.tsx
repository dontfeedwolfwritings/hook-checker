import type { Metadata } from "next";
import Link from "next/link";
import { CHANGELOG } from "@/data/changelog";
import type { ChangelogItemType } from "@/data/changelog";

export const metadata: Metadata = {
  title: "Changelog — Clean Copy",
  description: "Updates and improvements to Clean Copy.",
};

const TYPE_STYLE: Record<ChangelogItemType, { label: string; cls: string }> = {
  new:      { label: "new",      cls: "bg-emerald-950/50 text-emerald-700" },
  fix:      { label: "fix",      cls: "bg-red-950/30   text-red-700"       },
  improved: { label: "improved", cls: "bg-amber-950/30 text-amber-700"     },
};

export default function ChangelogPage() {
  return (
    <div
      className="min-h-screen bg-[#0e0e0e] text-[#e8e4dc]"
      style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
    >
      <div className="mx-auto max-w-xl px-6 py-10">

        {/* ── header ── */}
        <div className="mb-10 flex items-center justify-between">
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#3a3a3a]">
            Clean Copy — Changelog
          </span>
          <Link
            href="/"
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#2a2a2a] transition-colors hover:text-[#555]"
          >
            ← Back
          </Link>
        </div>

        {/* ── entries ── */}
        <div className="space-y-12">
          {CHANGELOG.map((entry) => (
            <div key={entry.version}>

              {/* version header */}
              <div className="mb-5 border-b border-[#181818] pb-3">
                <div className="flex items-baseline gap-4">
                  <span className="font-mono text-[13px] text-[#666]">
                    v{entry.version}
                  </span>
                  <span className="font-mono text-[10px] text-[#333]">
                    {entry.date}
                  </span>
                </div>
                <p className="mt-1 font-mono text-[11px] italic text-[#3a3a3a]">
                  {entry.summary}
                </p>
              </div>

              {/* items */}
              <ul className="space-y-4">
                {entry.items.map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span
                      className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] ${TYPE_STYLE[item.type].cls}`}
                    >
                      {TYPE_STYLE[item.type].label}
                    </span>
                    <span className="text-[13px] leading-snug text-[#888]">
                      {item.text}
                    </span>
                  </li>
                ))}
              </ul>

            </div>
          ))}
        </div>

        {/* ── footer ── */}
        <div className="mt-16 border-t border-[#181818] pt-6 space-y-4">
          <div>
            <p className="mb-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-[#282828]">
              Built by
            </p>
            <p className="mb-3 font-mono text-[13px] text-[#4a4a4a]">Sean Mullen</p>
            <a
              href="https://www.linkedin.com/in/proof-of-friction"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded border border-[#1d1d1d] bg-[#0a0a0a] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[#3a3a3a] transition-all hover:border-[#2e2e2e] hover:text-[#777]"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 .774v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
              </svg>
              Follow on LinkedIn
            </a>
            <p className="mt-3 font-mono text-[9px] text-[#252525]">
              Questions, feedback, or feature ideas — reach out on LinkedIn.
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}
