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
        <div className="mt-16 border-t border-[#181818] pt-6">
          <p className="font-mono text-[10px] text-[#282828]">
            Found a bug or have feedback?{" "}
            <a
              href="mailto:insidethesun@gmail.com"
              className="text-[#333] transition-colors hover:text-[#555]"
            >
              Send a note →
            </a>
          </p>
        </div>

      </div>
    </div>
  );
}
