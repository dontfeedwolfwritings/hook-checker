// ─── changelog data ───────────────────────────────────────────────────────────
// Add new entries at the TOP of the array. `date` drives the "unseen" dot badge.

export type ChangelogItemType = "new" | "fix" | "improved";

export interface ChangelogItem {
  type: ChangelogItemType;
  text: string;
}

export interface ChangelogEntry {
  version: string;
  date:    string; // YYYY-MM-DD — newest entry drives the badge
  summary: string;
  items:   ChangelogItem[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.5",
    date:    "2026-06-03",
    summary: "Smarter negation detection, changelog, LinkedIn contact",
    items: [
      { type: "improved", text: "Negation-reframe detection now catches period-separated and paragraph-break variants: \"This isn't X. It's Y.\", \"These aren't X. They're Y.\", and the Visa-style paragraph reframe" },
      { type: "new",      text: "Four distinct rules cover the full isn't/aren't family — comma, period, single newline, or blank-line separation" },
      { type: "new",      text: "Changelog page (/changelog) — versioned release notes with fix/new/improved tags" },
      { type: "new",      text: "What's new badge on the main screen — green dot appears when there are updates you haven't seen" },
      { type: "new",      text: "Built by card with LinkedIn follow link — reach out on LinkedIn with questions or feedback" },
    ],
  },
  {
    version: "0.4",
    date:    "2026-05-30",
    summary: "Em dash fix, X & Facebook, expanded slop rules",
    items: [
      { type: "fix",      text: "Restored em dash (—) detection — regex was silently broken by an earlier encoding fix" },
      { type: "new",      text: "X (Twitter) and Facebook added as active platforms" },
      { type: "new",      text: "LinkedIn: detects 3-line hook and single-line hook format before 'See more'" },
      { type: "new",      text: "12 new AI slop/trope rules — liminal, deeply meaningful, meticulous, groundswell, and more" },
    ],
  },
  {
    version: "0.3",
    date:    "2026-05-25",
    summary: "Inline editor, tooltips, mobile support",
    items: [
      { type: "new",      text: "Hemingway-style inline highlight editor — write and see violations at the same time" },
      { type: "new",      text: "Hover tooltips on every flagged word or phrase" },
      { type: "new",      text: "Long-press tooltip on mobile (300ms hold)" },
      { type: "new",      text: "Mobile tab bar (Write / Results)" },
      { type: "fix",      text: "Tooltip pinned to top-center on mobile, clamped to viewport" },
    ],
  },
  {
    version: "0.2",
    date:    "2026-05-24",
    summary: "Freemium model, Stripe, Redis rate limiting",
    items: [
      { type: "new",      text: "3 free AI deep checks per day — upgrade modal on limit" },
      { type: "new",      text: "Stripe subscription — pro users get unlimited deep checks" },
      { type: "new",      text: "Server-side daily IP limit via Upstash Redis (closes incognito bypass)" },
      { type: "new",      text: "Clerk sign-in for persistent pro access" },
      { type: "fix",      text: "Stripe webhook and pro-tier verification fixes" },
    ],
  },
  {
    version: "0.1",
    date:    "2026-05-24",
    summary: "Initial release",
    items: [
      { type: "new",      text: "Clean Copy launched — hook strength checker, slop/hard violation detection, and score out of 100" },
      { type: "new",      text: "AI Deep Check: preachy tone, moralizing close, buried insight, fake authority" },
      { type: "new",      text: "Save up to 5 drafts with before/after diff view" },
    ],
  },
];

// The date of the newest entry — used by the badge to detect unseen updates
export const LATEST_CHANGELOG_DATE = CHANGELOG[0].date;
