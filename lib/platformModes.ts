import { type Match } from "./rules";

export type Platform = "linkedin" | "x" | "facebook" | "youtube" | "tiktok";

// ─── config & char-counter ────────────────────────────────────────────────────

interface PlatformLimits {
  idealMin: number; // lower green boundary
  idealMax: number; // upper green boundary
  softMax:  number; // amber -> red threshold
}

interface PlatformConfig {
  tabLabel:   string;
  limits:     PlatformLimits;
  note:       string;
  comingSoon?: true; // when set, platform is excluded from the active selector
}

export const PLATFORM_CONFIG: Record<Platform, PlatformConfig> = {
  linkedin: {
    tabLabel: "LinkedIn",
    limits:   { idealMin: 900, idealMax: 1200, softMax: 3000 },
    note:     "Hook <=200 chars · Full post: 900-1,200",
  },
  x: {
    tabLabel: "X",
    limits:   { idealMin: 100, idealMax: 240, softMax: 280 },
    note:     "280-char limit · lead with the hook",
  },
  facebook: {
    tabLabel: "Facebook",
    limits:   { idealMin: 400, idealMax: 1500, softMax: 63000 },
    note:     'Hook ~477 chars before "See more"',
  },
  youtube: {
    tabLabel:   "YouTube",
    limits:     { idealMin: 40, idealMax: 60, softMax: 100 },
    note:       "Ideal 40-60 chars · hard cap ~100",
    comingSoon: true,
  },
  tiktok: {
    tabLabel:   "TikTok",
    limits:     { idealMin: 1, idealMax: 125, softMax: 150 },
    note:       "First 125 visible · cap at 150",
    comingSoon: true,
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

// Detects a mid-sentence capital word (proxy for proper noun)
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

// ─── shared: humble-brag slop ─────────────────────────────────────────────────
// LinkedIn, X, and Facebook all share these over-announce phrases.

const HUMBLE_BRAG: Array<{ re: RegExp; label: string }> = [
  { re: new RegExp(`\\bI${AP}?m\\s+excited\\s+to\\s+announce\\b`, "i"), label: '"I\'m excited to announce"' },
  { re: /\bI\s+am\s+excited\s+to\s+announce\b/i,                        label: '"I\'m excited to announce"' },
  { re: /\bthrilled\s+to\s+share\b/i,                                    label: '"Thrilled to share"'        },
  { re: /\bhonored\s+to\s+(?:be|share|announce)\b/i,                     label: '"Honored to be/share"'     },
  { re: /\bhumbled\s+to\b/i,                                              label: '"Humbled to"'              },
];

// ─── shared: credibility regexes for text-first hook platforms ────────────────

// Tight credibility: role title, dollar figure, specific number, ranking
const TH_CRED_RE =
  /\b(?:\$[\d,.]+[kKmMbB]?|\d[\d,.]*\s*[kKmMbB](?:\+)?\s*(?:ARR|MRR|revenue|sales|clients?|users?|followers?|subscribers?|students?)?|ceo|cto|coo|founder|co[- ]founder|director|vp\s+of|head\s+of|author\s+of|ranked|#\s*\d|award[-\s]winning|bestsell|Ph\.?D|M\.?B\.?A|Dr\.)\b/i;

// Attribution verb: "[Named person] says/argues/warns..."
const TH_ATTR_RE =
  /\b(?:says?|said|claims?|claimed|argues?|argued|warns?|warned|reveals?|revealed|admits?|admitted|announces?|announced|confirms?|confirmed|told|tells?|called\s+out|calls?\s+out)\b/i;

// Sentence-start words that are NOT proper nouns (exclude from company-subject check)
const TH_NON_NAME_START =
  /^(?:The|A|An|This|That|These|Those|It|They|We|You|He|She|I|Nobody|Nothing|Something|Everything|Everyone|Someone|Anyone|Each|Every|Recently|Today|Yesterday|Last|Next|My|Your|Our|Their|His|Her|Its|When|Where|What|How|Why|If|But|And|Or|So|Yet|Because|Although|While|After|Before|During|Since|Unless|Until|Whether|Meanwhile|Finally|Then|Now|Here|There|Not|Just|Still|Also|Even|Only|Both|Either|Neither|Many|Most|Some|Few|All|Any|No)\b/;

// "Apple is paying..." / "Google has acquired..." -- named brand as subject IS the credential
const TH_COMPANY_SUBJECT_RE =
  /^[A-Z][a-zA-Z]{2,}(?:\s+[A-Z][a-zA-Z]{1,})?\s+(?:is|are|was|were|has|have|had|will|just|recently|now)\b/;

// First sentence up to punctuation or newline
function firstSentence(text: string): string {
  return text.match(/^[^.!?\n]*/)?.[0] ?? text;
}

// Shared hook analysis for LinkedIn, X, and Facebook.
// All three are text-first: the hook leads before any visual and often has a "see more" cutoff.
function analyzeTextHook(
  text:     string,
  platform: string, // used as prefix in issue strings, e.g. "LinkedIn", "X", "Facebook"
): { matches: Match[]; platformHookIssues: string[] } {
  const matches:            Match[]  = [];
  const platformHookIssues: string[] = [];

  // Humble-brag slop
  for (const item of HUMBLE_BRAG) {
    matches.push(...toMatches(findAll(text, item.re), "slop", item.label));
  }

  // Proper noun in first sentence
  if (!hasProperNoun(firstSentence(text))) {
    platformHookIssues.push(`${platform}: no proper noun in first sentence`);
  }

  // Credibility signal in hook region (first two lines)
  const nl1      = text.indexOf("\n");
  const nl2      = nl1 === -1 ? -1 : text.indexOf("\n", nl1 + 1);
  const hookEnd  = nl2 !== -1 ? nl2 : nl1 !== -1 ? nl1 : text.length;
  const hookText = text.slice(0, hookEnd);

  const hasAttribution   = hasProperNoun(firstSentence(text)) && TH_ATTR_RE.test(hookText);
  const hasSubjectAction = TH_COMPANY_SUBJECT_RE.test(text) && !TH_NON_NAME_START.test(text);

  if (!TH_CRED_RE.test(hookText) && !hasAttribution && !hasSubjectAction) {
    platformHookIssues.push(`${platform}: hook lacks role, dollar figure, or specific number`);
  }

  return { matches, platformHookIssues };
}

// ─── LinkedIn ─────────────────────────────────────────────────────────────────
//
// LinkedIn's top-performing hooks follow one of two formats before "see more":
//
//   3-Line Hook:  Line 1 — the claim / "what"
//                [blank line — negative space, creates a pause]
//                Line 3 — the "so what" / twist / consequence
//                                                    ...more
//
//   Single-Line:  One compact statement or quote (≤ 200 chars, no line breaks).
//                 For vertical video it MUST be 5-8 words — it appears as a
//                 caption overlay inside the visual on mobile LinkedIn.
//                                                    ...more
//
// A wall of text (multiple lines without blank-line breathing room, or a block
// over 200 chars) kills the scroll-stop before anyone clicks "see more".

function analyzeLinkedIn(text: string): PlatformResult {
  const warnings: string[] = [];
  const { matches, platformHookIssues } = analyzeTextHook(text, "LinkedIn");

  // ── Hook format: 3-line or single-line ─────────────────────────────────────
  const firstBlankLine = text.indexOf("\n\n");

  // Everything visible before the first paragraph break, capped at 300 chars
  const hookBlock  = firstBlankLine !== -1
    ? text.slice(0, firstBlankLine)
    : text.slice(0, Math.min(text.length, 300));
  const hookLines  = hookBlock.split("\n").filter(l => l.trim());

  // 3-line: exactly one non-empty line before the first blank line (≤ 220 chars in)
  const is3Line      = firstBlankLine !== -1
    && firstBlankLine <= 220
    && hookLines.length === 1;

  // Single-line: one cohesive block with no internal line breaks, ≤ 200 chars
  const isSingleLine = !hookBlock.includes("\n") && hookBlock.length <= 200;

  if (!is3Line && !isSingleLine) {
    platformHookIssues.push("LinkedIn: hook format");

    if (hookBlock.includes("\n") && firstBlankLine === -1) {
      // Multiple line breaks but no blank-line paragraph gap
      warnings.push(
        'Hook spans multiple lines without a blank-line gap -- ' +
        'try: one line (the claim) + blank line + one line (the "so what")'
      );
    } else if (firstBlankLine !== -1 && hookLines.length > 1) {
      // Blank line exists but too many lines crammed before it
      warnings.push(
        'Too many lines before the first blank -- ' +
        'trim to: one statement + blank line + one "so what"'
      );
    } else if (hookBlock.length > 200) {
      // Long unbroken block
      warnings.push(
        'Hook block is too long before "see more" -- ' +
        'try a single punchy line, or the 3-line format: claim + blank + so what'
      );
    }
  }

  // ── Wall-of-text warning ────────────────────────────────────────────────────
  if (!text.includes("\n")) {
    warnings.push("No line breaks -- LinkedIn rewards white space");
  }

  // ── Hook length warning ─────────────────────────────────────────────────────
  const hookLength = firstBlankLine !== -1 ? firstBlankLine : Math.min(text.length, 400);
  if (hookLength > 200) {
    warnings.push(`Hook is ~${hookLength} chars -- LinkedIn truncates at ~200 before "see more"`);
  }

  return { matches, platformHookIssues, warnings };
}

// ─── X ────────────────────────────────────────────────────────────────────────
// Same text-first hook rules as LinkedIn. Character limit is 280.

function analyzeX(text: string): PlatformResult {
  const warnings: string[] = [];
  const { matches, platformHookIssues } = analyzeTextHook(text, "X");

  if (text.length > 280) {
    warnings.push(`Over X's 280-char limit by ${text.length - 280} chars`);
  } else if (text.length > 240) {
    warnings.push(`${280 - text.length} chars remaining -- approaching X's 280-char limit`);
  }

  return { matches, platformHookIssues, warnings };
}

// ─── Facebook ─────────────────────────────────────────────────────────────────
// Same text-first hook rules as LinkedIn. "See more" kicks in at ~477 chars.

function analyzeFacebook(text: string): PlatformResult {
  const warnings: string[] = [];
  const { matches, platformHookIssues } = analyzeTextHook(text, "Facebook");

  // Wall-of-text warning
  if (!text.includes("\n")) {
    warnings.push("No line breaks -- Facebook rewards white space");
  }

  // Hook before "see more" over 477 chars
  const blankLinePos = text.indexOf("\n\n");
  const hookLength   = blankLinePos !== -1 ? blankLinePos : Math.min(text.length, 600);
  if (hookLength > 477) {
    warnings.push(`Hook is ~${hookLength} chars -- Facebook shows "See more" at ~477 chars`);
  }

  return { matches, platformHookIssues, warnings };
}

// ─── YouTube ──────────────────────────────────────────────────────────────────

const YT_CLICKBAIT_RE =
  /\b(?:you\s+won['']?t\s+believe|this\s+will\s+(?:shock|change\s+everything|blow\s+your\s+mind)|what\s+happens\s+(?:next|when\s+you)|mind[- ]blowing|insane\s+results?)\b/i;

const YT_CURIOSITY_RE =
  /^(?:\d+\s|how\s|why\s|what\s|when\s|the\s+(?:secret|truth|real\s+reason|one\s+thing)|i\s+(?:tried|tested|spent|made|built))/i;

function analyzeYouTube(text: string): PlatformResult {
  const matches:            Match[]  = [];
  const platformHookIssues: string[] = [];
  const warnings:           string[] = [];

  matches.push(...toMatches(findAll(text, YT_CLICKBAIT_RE), "hard", "Clickbait non-answer"));

  const hasCuriosityGap = YT_CURIOSITY_RE.test(text.trim()) || /\?$/.test(text.trim());
  const hasNumber       = /\d/.test(text);
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
  const matches:            Match[]  = [];
  const platformHookIssues: string[] = [];
  const warnings:           string[] = [];

  const firstLine = text.split("\n")[0] ?? text;
  if (TT_DESCRIBES_RE.test(firstLine.trim())) {
    platformHookIssues.push("TikTok: first line just describes the video -- it should hook");
  }

  matches.push(...toMatches(findAll(text, TT_GENERIC_CTA_RE), "slop", "Generic CTA"));

  const hashCount = (text.match(/#\w+/g) ?? []).length;
  if (hashCount > 5) {
    warnings.push(`${hashCount} hashtags -- keep to 5 or fewer`);
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
    { label: "3-line or single-line hook",      failKeys: ["hook format"]               },
  ],
  x: [
    { label: "Proper noun in first sentence",  failKeys: ["proper noun"]              },
    { label: "Contradiction or tension",        failKeys: ["contradiction"]             },
    { label: "Role, number, or dollar figure",  failKeys: ["credibility", "lacks role"] },
  ],
  facebook: [
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
    case "linkedin":  return analyzeLinkedIn(text);
    case "x":         return analyzeX(text);
    case "facebook":  return analyzeFacebook(text);
    case "youtube":   return analyzeYouTube(text);
    case "tiktok":    return analyzeTikTok(text);
  }
}
