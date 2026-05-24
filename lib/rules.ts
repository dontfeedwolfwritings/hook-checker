// Apostrophe variants: straight, left-curly, right-curly
const AP = "['‘’]";

export interface Match {
  start: number;
  end: number;
  type: "hard" | "slop" | "hook";
  label: string;
}

export interface AnalysisResult {
  matches: Match[];
  hardCount: number;
  slopCount: number;
  hookIssues: string[];
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function findAll(
  text: string,
  pattern: RegExp
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
  label: string
): Match[] {
  return hits.map((h) => ({ ...h, type, label }));
}

// ─── hard violation rules ─────────────────────────────────────────────────────

const hardRules: Array<{
  label: string;
  find: (text: string) => Array<{ start: number; end: number }>;
}> = [
  {
    label: "Em dash",
    find: (t) => findAll(t, /—/g),
  },
  {
    label: "Spot on",
    find: (t) => findAll(t, /\bspot\s+on\b/i),
  },
  {
    // "it's not a post, it's a revolution"
    label: "It’s not X, it’s Y",
    find: (t) =>
      findAll(
        t,
        new RegExp(
          `it${AP}?s\\s+not\\s+.{1,120}?,\\s*it${AP}?s\\s`,
          "i"
        )
      ),
  },
  {
    // "this isn't X, it's Y"
    label: "This isn’t X, it’s Y",
    find: (t) =>
      findAll(
        t,
        new RegExp(
          `this\\s+isn${AP}?t\\s+.{1,120}?,\\s*it${AP}?s\\s`,
          "i"
        )
      ),
  },
  {
    // "not just X, it's Y"
    label: "Not just X, it’s Y",
    find: (t) =>
      findAll(
        t,
        new RegExp(
          `not\\s+just\\s+.{1,120}?,\\s*it${AP}?s\\s`,
          "i"
        )
      ),
  },
];

// ─── slop word rules ──────────────────────────────────────────────────────────

function findLeverageVerb(
  text: string
): Array<{ start: number; end: number }> {
  const results: Array<{ start: number; end: number }> = [];

  // leverages / leveraging / leveraged are almost exclusively verb forms
  for (const h of findAll(text, /\bleverag(?:es|ing|ed)\b/i)) {
    results.push(h);
  }

  // bare "leverage" in clear verb context — capture the word itself, not the prefix
  const contextRe = new RegExp(
    `\\b(?:to|can|will|should|could|would|must|might|we|you|I|they|he|she|it|also|and|or)\\s+(leverage)\\b`,
    "gi"
  );
  let m: RegExpExecArray | null;
  while ((m = contextRe.exec(text)) !== null) {
    const ws = m.index + m[0].length - m[1].length;
    results.push({ start: ws, end: ws + m[1].length });
  }

  return results;
}

// Flag all "quietly" hits only when the word appears more than once in the post
function findRepeatedQuietly(
  text: string
): Array<{ start: number; end: number }> {
  const all = findAll(text, /\bquietly\b/i);
  return all.length > 1 ? all : [];
}

function findUnpackSlop(
  text: string
): Array<{ start: number; end: number }> {
  return findAll(
    text,
    new RegExp(
      // "let's unpack", "let me unpack", "need to unpack", "time to unpack" …
      `\\b(?:let${AP}?s|let\\s+me|let\\s+us|need(?:s)?\\s+to|time\\s+to|going\\s+to|want(?:s)?\\s+to|trying\\s+to)\\s+unpack\\b` +
        // "unpack this / that / it / what / how / why / the …"
        `|\\bunpack\\s+(?:this|that|it|what|how|why|the)\\b`,
      "i"
    )
  );
}

const slopRules: Array<{
  label: string;
  find: (text: string) => Array<{ start: number; end: number }>;
}> = [
  {
    label: "Delve",
    find: (t) => findAll(t, /\bdelv(?:e|es|ed|ing)\b/i),
  },
  {
    label: "Tapestry",
    find: (t) => findAll(t, /\btapestry\b/i),
  },
  {
    label: "A testament to",
    find: (t) => findAll(t, /\ba\s+testament\s+to\b/i),
  },
  {
    label: "Game-changer",
    find: (t) => findAll(t, /\bgame[- ]changer\b/i),
  },
  {
    label: "Thought leader(ship)",
    find: (t) => findAll(t, /\bthought\s+leader(?:ship)?\b/i),
  },
  {
    label: "At the end of the day",
    find: (t) => findAll(t, /\bat\s+the\s+end\s+of\s+the\s+day\b/i),
  },
  {
    label: "In conclusion",
    find: (t) => findAll(t, /\bin\s+conclusion\b/i),
  },
  {
    label: "In today’s world / digital landscape",
    find: (t) =>
      findAll(
        t,
        new RegExp(
          `\\bin\\s+today${AP}?s\\s+(?:world|digital\\s+landscape)\\b`,
          "i"
        )
      ),
  },
  {
    label: "It’s important to note/remember/understand",
    find: (t) =>
      findAll(
        t,
        new RegExp(
          `it${AP}?s\\s+important\\s+to\\s+(?:note|remember|understand)\\b`,
          "i"
        )
      ),
  },
  {
    label: "Foster a culture/community",
    find: (t) => findAll(t, /\bfoster(?:ing)?\s+a\s+(?:culture|community)\b/i),
  },
  {
    label: "Leverage (verb)",
    find: findLeverageVerb,
  },
  {
    label: "Elevate your/our",
    find: (t) => findAll(t, /\belevate\s+(?:your|our)\b/i),
  },
  {
    label: "Let’s unpack",
    find: findUnpackSlop,
  },
  {
    label: "Quietly becoming / silently shifting / slowly emerging",
    find: (t) =>
      findAll(
        t,
        /\b(?:quietly\s+becoming|silently\s+shifting|slowly\s+emerging)\b/i
      ),
  },
  {
    label: "Villain group label",
    find: (t) =>
      findAll(t, /\bthe\s+(?:lazy|cynics|skeptics|doubters)\b/i),
  },
  {
    label: "“Quietly” used more than once",
    find: findRepeatedQuietly,
  },
];

// ─── hook quality check ───────────────────────────────────────────────────────

function getLineInfo(text: string) {
  const nl1 = text.indexOf("\n");
  const line1End = nl1 === -1 ? text.length : nl1;
  const line1 = text.slice(0, line1End);

  let twoLinesEnd: number;
  if (nl1 === -1) {
    twoLinesEnd = text.length;
  } else {
    const nl2 = text.indexOf("\n", nl1 + 1);
    twoLinesEnd = nl2 === -1 ? text.length : nl2;
  }

  return { line1, line1End, twoLinesEnd };
}

// A capitalised word that isn't at a sentence-start position is a proxy for a proper noun.
function hasProperNoun(line: string): boolean {
  const re = /\b([A-Z][a-zA-Z]{1,})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const before = line.slice(0, m.index).trimEnd();
    // Sentence-start capitals are expected — skip them
    if (before === "" || /[.!?]$/.test(before)) continue;
    if (m[1] === "I") continue; // first-person pronoun is not a proper noun
    return true;
  }
  return false;
}

// Tension signals: common contradiction/contrast words …
const CONTRADICTION_RE =
  /\b(?:without|despite|instead\s+of|rather\s+than|although|even\s+though|contrary\s+to|by\s+not|not\s+\w+(?:\s+\w+)?\s+but|but|yet|however|except\s+that)\b/i;

// Short-line rebuttal: "Wrong target." / "False." / "Actually," etc. on its own line or after a period
const SHORT_REBUTTAL_RE =
  /(?:^|[.!?]\s{0,3}|\n)(?:Wrong|False|Not true|Not quite|Nope|Actually|Incorrect|No\.|Bullshit)\b/im;

// Credibility signals: follower counts, titles, rankings, awards, credentials …
const CREDIBILITY_RE =
  /\b(?:\d[\d,.]*\s*[kKmM]\+?\s*(?:followers?|subscribers?|connections?|views?)|#\s*1\b|ranked\s+(?:#\s*)?\d|award[-\s]winning|bestsell|certified|licensed|Ph\.?D|M\.?B\.?A|Dr\.|professor|author\s+of|founded|founder|ceo|cto|coo|vp\s+of|head\s+of|director\s+of|record[- ](?:breaking|setting))\b/i;

function runHookChecks(text: string): {
  hookMatches: Match[];
  hookIssues: string[];
} {
  const { line1, line1End, twoLinesEnd } = getLineInfo(text);
  const firstTwo = text.slice(0, twoLinesEnd);
  const hookMatches: Match[] = [];
  const hookIssues: string[] = [];

  function flag(start: number, end: number, label: string) {
    hookMatches.push({ start, end, type: "hook", label });
    hookIssues.push(label);
  }

  if (!hasProperNoun(line1)) {
    flag(0, line1End, "Weak hook: no proper noun in first line");
  }
  if (!CONTRADICTION_RE.test(firstTwo) && !SHORT_REBUTTAL_RE.test(firstTwo)) {
    flag(0, twoLinesEnd, "Weak hook: no contradiction or tension signal");
  }
  if (!CREDIBILITY_RE.test(firstTwo)) {
    flag(0, twoLinesEnd, "Weak hook: no credibility signal");
  }

  return { hookMatches, hookIssues };
}

// ─── deduplication ────────────────────────────────────────────────────────────

const TYPE_PRIORITY: Record<Match["type"], number> = {
  hard: 0,
  slop: 1,
  hook: 2,
};

// Hook matches represent absence flags over large regions and are kept in full.
// Hard and slop inline matches are deduplicated: at overlapping positions the
// higher-priority / longer match wins.
function deduplicateMatches(matches: Match[]): Match[] {
  const hooks = matches.filter((m) => m.type === "hook");
  const inline = matches.filter((m) => m.type !== "hook");

  const sorted = [...inline].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    if (a.type !== b.type) return TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type];
    return b.end - b.start - (a.end - a.start); // prefer longer span
  });

  const deduped: Match[] = [];
  let lastEnd = -1;
  for (const m of sorted) {
    if (m.start >= lastEnd) {
      deduped.push(m);
      lastEnd = m.end;
    }
  }

  // Merge and sort everything by position; hooks come after any inline match
  // at the same position so specific matches are not buried.
  return [...deduped, ...hooks].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type];
  });
}

// ─── public API ───────────────────────────────────────────────────────────────

export function analyzeText(text: string): AnalysisResult {
  const raw: Match[] = [];

  for (const rule of hardRules) {
    raw.push(...toMatches(rule.find(text), "hard", rule.label));
  }
  for (const rule of slopRules) {
    raw.push(...toMatches(rule.find(text), "slop", rule.label));
  }

  const { hookMatches, hookIssues } = runHookChecks(text);

  const matches = deduplicateMatches([...raw, ...hookMatches]);
  const hardCount = matches.filter((m) => m.type === "hard").length;
  const slopCount = matches.filter((m) => m.type === "slop").length;

  return { matches, hardCount, slopCount, hookIssues };
}
