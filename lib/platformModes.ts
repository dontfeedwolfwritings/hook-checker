import { type Match } from "./rules";

export type Platform = "linkedin" | "youtube" | "tiktok";

// ─── config & char-counter ────────────────────────────────────────────────────

interface PlatformLimits {
  idealMin: number; // lower green boundary
  idealMax: number; // upper green boundary
  softMax:  number; // amber → red threshold
}

interface PlatformConfig {
  tabLabel: string;
  limits: PlatformLimits;
  note: string;
}

export const PLATFORM_CONFIG: Record<Platform, PlatformConfig> = {
  linkedin: {
    tabLabel: "LinkedIn",
    limits: { idealMin: 900, idealMax: 1200, softMax: 3000 },
    note: "Hook ≤200 · Full post: 900–1,200",
  },
  youtube: {
    tabLabel: "YouTube",
    limits: { idealMin: 40, idealMax: 60, softMax: 100 },
    note: "Ideal 40–60 chars · hard cap ~100",
  },
  tiktok: {
    tabLabel: "TikTok",
    limits: { idealMin: 1, idealMax: 125, softMax: 150 },
    note: "First 125 visible · cap at 150",
  },
};

export type CharColor = "neutral" | "green" | "amber" | "red";

export function getCharColor(count: number, platform: Platform): CharColor {
  if (count === 0) return "neutral";
  const { idealMin, idealMax, softMax } = PLATFORM_CONFIG[platform].limits;
  if (count > softMax) return "red";
  if (count >= idealMin && count <= idealMax) return "green";
  return "amber";
}

// ─── helpers ──────────────────────────────────────────────────────────────────

const AP = "[''']"; // straight, left-curly, right-curly apostrophes

function findAll(
  text: string,
  pattern: RegExp,
): Array<{ start: number; end: number }> {
  const results: Array<{ start: number; end: number }> = [];
  const flags = pattern.flags.replace(/g/g, "") + "g";
  const re = new RegExp(pattern.source, flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    results.push({ start: m.index, end: m.index + m[0].length });
    if (m[0].length === 0) re.lastIndex++;
  }
  return results;
}

function toMatches(
  hits: Array<{ start: number; end: number }>,
  type: Match["type"],
  label: string,
): Match[] {
  return hits.map((h) => ({ ...h, type, label }));
}

// Identical to the version in rules.ts — detects a mid-sentence capital word
function hasProperNoun(text: string): boolean {
  const re = /\b([A-Z][a-zA-Z]{1,})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(0, m.index).trimEnd();
    if (before === "" || /[.!?]$/.test(before)) continue;
    if (m[1] === "I") continue;
    return true;
  }
  return false;
}

// ─── result types ─────────────────────────────────────────────────────────────

export interface PlatformResult {
  matches:             Match[];
  platformHookIssues:  string[]; // separate from base hookIssues
  warnings:            string[]; // non-inline structural warnings
}

const EMPTY: PlatformResult = { matches: [], platformHookIssues: [], warnings: [] };

// ─── LinkedIn ─────────────────────────────────────────────────────────────────

// Extracts text up to the first sentence-ending punctuation or newline
function firstSentence(text: string): string {
  return text.match(/^[^.!?\n]*/)?.[0] ?? text;
}

// Tighter than the base credibility check — requires role title, $ figure, or specific number
const LI_CRED_RE =
  /\b(?:\$[\d,.]+[kKmMbB]?|\d[\d,.]*\s*[kKmMbB](?:\+)?\s*(?:ARR|MRR|revenue|sales|clients?|users?|followers?|subscribers?|students?)?|ceo|cto|coo|founder|co[- ]founder|director|vp\s+of|head\s+of|author\s+of|ranked|#\s*\d|award[-\s]winning|bestsell|Ph\.?D|M\.?B\.?A|Dr\.)\b/i;

// Named public figure + attribution verb = credibility (e.g. "Seth Rogen says…")
const LI_ATTR_RE =
  /\b(?:says?|said|claims?|claimed|argues?|argued|warns?|warned|reveals?|revealed|admits?|admitted|announces?|announced|confirms?|confirmed|told|tells?|called\s+out|calls?\s+out)\b/i;

function analyzeLinkedIn(text: string): PlatformResult {
  const matches:            Match[]   = [];
  const platformHookIssues: string[]  = [];
  const warnings:           string[]  = [];

  // Extra slop — humble-brag announce phrases
  const ANNOUNCE = [
    { re: new RegExp(`\\bI${AP}?m\\s+excited\\s+to\\s+announce\\b`, "i"), label: "“I’m excited to announce”" },
    { re: /\bI\s+am\s+excited\s+to\s+announce\b/i,                        label: "“I’m excited to announce”" },
    { re: /\bthrilled\s+to\s+share\b/i,                                    label: "“Thrilled to share”"             },
    { re: /\bhonored\s+to\s+(?:be|share|announce)\b/i,                     label: "“Honored to be/share”"           },
    { re: /\bhumbled\s+to\b/i,                                              label: "“Humbled to”"                    },
  ];
  for (const { re, label } of ANNOUNCE) {
    matches.push(...toMatches(findAll(text, re), "slop", label));
  }

  // Proper noun in FIRST SENTENCE (stricter than base rule's first-line check)
  if (!hasProperNoun(firstSentence(text))) {
    platformHookIssues.push("LinkedIn: no proper noun in first sentence");
  }

  // LinkedIn-specific credibility within hook region (first two lines)
  const nl1 = text.indexOf("\n");
  const nl2 = nl1 === -1 ? -1 : text.indexOf("\n", nl1 + 1);
  const hookEnd = nl2 !== -1 ? nl2 : nl1 !== -1 ? nl1 : text.length;
  const hookText = text.slice(0, hookEnd);
  const hasLiAttribution = hasProperNoun(firstSentence(text)) && LI_ATTR_RE.test(hookText);

  // Company/brand as subject: "Apple is paying…", "Google has acquired…"
  const LI_NON_NAME =
    /^(?:The|A|An|This|That|These|Those|It|They|We|You|He|She|I|Nobody|Nothing|Something|Everything|Everyone|Someone|Anyone|Each|Every|Recently|Today|Yesterday|Last|Next|My|Your|Our|Their|His|Her|Its|When|Where|What|How|Why|If|But|And|Or|So|Yet|Because|Although|While|After|Before|During|Since|Unless|Until|Whether|Meanwhile|Finally|Then|Now|Here|There|Not|Just|Still|Also|Even|Only|Both|Either|Neither|Many|Most|Some|Few|All|Any|No)\b/;
  const LI_COMPANY_SUBJECT_RE =
    /^[A-Z][a-zA-Z]{2,}(?:\s+[A-Z][a-zA-Z]{1,})?\s+(?:is|are|was|were|has|have|had|will|just|recently|now)\b/;
  const hasSubjectAction =
    LI_COMPANY_SUBJECT_RE.test(text) && !LI_NON_NAME.test(text);

  if (!LI_CRED_RE.test(hookText) && !hasLiAttribution && !hasSubjectAction) {
    platformHookIssues.push("LinkedIn: hook lacks role, dollar figure, or specific number");
  }

  // Warning: wall-of-text (no line breaks at all)
  if (!text.includes("\n")) {
    warnings.push("No line breaks — LinkedIn rewards white space");
  }

  // Warning: hook before "see more" is over 200 chars
  const blankLinePos = text.indexOf("\n\n");
  const hookLength   = blankLinePos !== -1 ? blankLinePos : Math.min(text.length, 400);
  if (hookLength > 200) {
    warnings.push(`Hook is ~${hookLength} chars — LinkedIn truncates at ~200 before "see more"`);
  }

  return { matches, platformHookIssues, warnings };
}

// ─── YouTube ──────────────────────────────────────────────────────────────────

const YT_CLICKBAIT_RE =
  /\b(?:you\s+won['']?t\s+believe|this\s+will\s+(?:shock|change\s+everything|blow\s+your\s+mind)|what\s+happens\s+(?:next|when\s+you)|mind[- ]blowing|insane\s+results?)\b/i;

// Curiosity gap: leading interrogative, number opener, or question-mark ending
const YT_CURIOSITY_RE =
  /^(?:\d+\s|how\s|why\s|what\s|when\s|the\s+(?:secret|truth|real\s+reason|one\s+thing)|i\s+(?:tried|tested|spent|made|built))/i;

function analyzeYouTube(text: string): PlatformResult {
  const matches:            Match[]   = [];
  const platformHookIssues: string[]  = [];
  const warnings:           string[]  = [];

  // Clickbait non-answers → hard violation
  matches.push(...toMatches(findAll(text, YT_CLICKBAIT_RE), "hard", "Clickbait non-answer"));

  // Combined curiosity-gap / number / named-person check
  const hasCuriosityGap = YT_CURIOSITY_RE.test(text.trim()) || /\?$/.test(text.trim());
  const hasNumber       = /\d/.test(text);
  // Named person proxy: capital word not at the very start of the string
  const hasNamedPerson  = /(?:\s)[A-Z][a-z]{1,}/.test(text);

  if (!hasCuriosityGap && !hasNumber && !hasNamedPerson) {
    platformHookIssues.push("YouTube: no number, named person, or curiosity gap in title");
  }

  return { matches, platformHookIssues, warnings };
}

// ─── TikTok / Reels ───────────────────────────────────────────────────────────

const TT_DESCRIBES_RE =
  /^(?:check\s+out(?:\s+my)?|watch\s+(?:my|this|me)|new\s+video(?:\s+on)?|link\s+in\s+(?:bio|profile)|follow\s+(?:me\s+)?for|subscribe\s+for|(?:my\s+)?latest\s+(?:video|post|reel))/i;

const TT_GENERIC_CTA_RE =
  /\b(?:link\s+in\s+(?:bio|profile)|check\s+(?:my|the)\s+(?:bio|profile|page)|follow\s+for\s+more)\b/i;

function analyzeTikTok(text: string): PlatformResult {
  const matches:            Match[]   = [];
  const platformHookIssues: string[]  = [];
  const warnings:           string[]  = [];

  const firstLine = text.split("\n")[0] ?? text;

  // First line should hook, not just describe
  if (TT_DESCRIBES_RE.test(firstLine.trim())) {
    platformHookIssues.push("TikTok: first line just describes the video — it should hook");
  }

  // Generic CTAs as slop
  matches.push(...toMatches(findAll(text, TT_GENERIC_CTA_RE), "slop", "Generic CTA"));

  // Excessive hashtags
  const hashCount = (text.match(/#\w+/g) ?? []).length;
  if (hashCount > 5) {
    warnings.push(`${hashCount} hashtags — keep to 5 or fewer`);
  }

  return { matches, platformHookIssues, warnings };
}

// ─── checklist builder ────────────────────────────────────────────────────────

export interface CheckItem {
  label:  string;
  passed: boolean | null; // null = neutral (textarea empty)
}

interface CheckDef {
  label:    string;
  failKeys: string[]; // issue is failed if any key is a substring of any issue string
}

const PLATFORM_CHECKS: Record<Platform, CheckDef[]> = {
  linkedin: [
    { label: "Proper noun in first sentence",  failKeys: ["proper noun"]              },
    { label: "Contradiction or tension",        failKeys: ["contradiction"]             },
    { label: "Role, number, or dollar figure",  failKeys: ["credibility", "lacks role"] },
  ],
  youtube: [
    { label: "Number, name, or curiosity gap", failKeys: ["curiosity gap"]             },
    { label: "Credibility signal present",      failKeys: ["credibility"]               },
  ],
  tiktok: [
    { label: "First line as standalone hook",  failKeys: ["first line"]               },
    { label: "Named person or brand present",   failKeys: ["proper noun"]              },
    { label: "Contradiction or tension",        failKeys: ["contradiction"]             },
  ],
};

// Combines base hook issues (from analyzeText) and platform-specific hook issues
// to produce the per-platform checklist shown in the sidebar.
export function getPlatformChecklist(
  baseHookIssues:     string[],
  platformHookIssues: string[],
  platform:           Platform,
  textIsEmpty:        boolean,
): CheckItem[] {
  const defs = PLATFORM_CHECKS[platform];
  if (textIsEmpty) return defs.map(({ label }) => ({ label, passed: null }));

  const all = [...baseHookIssues, ...platformHookIssues];
  return defs.map(({ label, failKeys }) => ({
    label,
    passed: !all.some((issue) =>
      failKeys.some((key) => issue.toLowerCase().includes(key))
    ),
  }));
}

// ─── main export ──────────────────────────────────────────────────────────────

export function analyzePlatform(text: string, platform: Platform): PlatformResult {
  if (!text.trim()) return EMPTY;
  switch (platform) {
    case "linkedin": return analyzeLinkedIn(text);
    case "youtube":  return analyzeYouTube(text);
    case "tiktok":   return analyzeTikTok(text);
  }
}
