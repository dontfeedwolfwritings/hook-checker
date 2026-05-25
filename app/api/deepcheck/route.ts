import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@clerk/nextjs/server";

// ─── burst rate limiter (per-minute) ─────────────────────────────────────────
interface RateEntry {
  count:   number;
  resetAt: number;
}

const RATE_STORE  = new Map<string, RateEntry>();
const RATE_LIMIT  = 10;
const RATE_WINDOW = 60_000; // 1 minute

// ─── daily free-tier limiter (unauthenticated only) ───────────────────────────
// In-memory — resets on cold start, but still blocks incognito / new browsers
// since the check is server-side by IP, not client-side by localStorage.

interface DailyEntry {
  count:   number;
  resetAt: number; // next midnight UTC
}

const DAILY_STORE = new Map<string, DailyEntry>();
const DAILY_LIMIT = 3;

function nextMidnightUTC(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

function checkDaily(ip: string): { ok: boolean; remaining: number } {
  const now   = Date.now();
  const entry = DAILY_STORE.get(ip);

  if (!entry || now >= entry.resetAt) {
    DAILY_STORE.set(ip, { count: 1, resetAt: nextMidnightUTC() });
    return { ok: true, remaining: DAILY_LIMIT - 1 };
  }
  if (entry.count >= DAILY_LIMIT) return { ok: false, remaining: 0 };
  entry.count++;
  return { ok: true, remaining: DAILY_LIMIT - entry.count };
}

function pruneDailyStore(): void {
  const now = Date.now();
  for (const [ip, entry] of Array.from(DAILY_STORE)) {
    if (now >= entry.resetAt) DAILY_STORE.delete(ip);
  }
}

function getIp(req: NextRequest): string {
  // x-forwarded-for may be a comma-separated list; take the first (client) address
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

function checkRate(ip: string): { ok: boolean; remaining: number } {
  const now   = Date.now();
  const entry = RATE_STORE.get(ip);

  if (!entry || now >= entry.resetAt) {
    RATE_STORE.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
    return { ok: true, remaining: RATE_LIMIT - 1 };
  }

  if (entry.count >= RATE_LIMIT) {
    return { ok: false, remaining: 0 };
  }

  entry.count++;
  return { ok: true, remaining: RATE_LIMIT - entry.count };
}

// Prune expired entries to keep the map from growing unbounded
function pruneRateStore(): void {
  const now = Date.now();
  for (const [ip, entry] of Array.from(RATE_STORE)) {
    if (now >= entry.resetAt) RATE_STORE.delete(ip);
  }
}

// ─── platform labels ──────────────────────────────────────────────────────────

const PLATFORM_LABEL: Record<string, string> = {
  linkedin: "LinkedIn text post",
  youtube:  "YouTube video title",
  tiktok:   "TikTok / Instagram Reels caption",
};

// ─── system prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(platformLabel: string): string {
  return `You are a senior editor specializing in social media copy. Analyze this post for semantic writing issues that pattern matching can't detect. Check for:

1. PREACHY / BITTER UNCLE TONE — Does the post lecture the reader? Tell them what they should do or feel? Does it sound like someone complaining rather than observing?

2. MORALIZING CLOSE — Does it end with a lesson or instruction instead of an observation? Good posts end with a cultural observation that lets the reader draw their own conclusion. Bad posts end with 'Remember: always X' or 'The lesson here is Y.'

3. TEACHING VS SHOWING — Is the post explaining a concept abstractly or demonstrating it through a specific example? Abstract: 'Hooks are important.' Show: 'Zaria Parvez won the Super Bowl without buying a spot.'

4. BURIED SO WHAT — Is the insight in the middle or end instead of the hook? The conclusion should come first, then the proof.

5. TIDY METAPHOR CLOSE — Does it end with a clever-sounding image designed to feel profound? (e.g. 'The crime is never the brush, it's who held it.') These feel like AI wrapping up a thought.

6. FAKE AUTHORITY — Does it claim expertise without showing it? 'As a [title], I know that...' without actual proof.

Platform context: ${platformLabel}

Respond ONLY with valid JSON — no prose, no markdown fences:
{"issues":[{"type":"issue name","severity":"high|medium|low","note":"specific explanation citing actual text from the post","fix":"one-line suggested fix"}],"verdict":"clean|minor|needs work","topFix":"the single most important edit in one sentence"}

If no issues found, return issues as empty array. topFix may be null when verdict is clean.`;
}

// ─── response types ───────────────────────────────────────────────────────────

interface DeepCheckIssue {
  type:     string;
  severity: "high" | "medium" | "low";
  note:     string;
  fix:      string;
}

interface DeepCheckResponse {
  issues:  DeepCheckIssue[];
  verdict: "clean" | "minor" | "needs work";
  topFix:  string | null;
}

function isDeepCheckResponse(v: unknown): v is DeepCheckResponse {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  return Array.isArray(obj.issues) && typeof obj.verdict === "string";
}

// ─── route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Check Clerk auth — signed-in users get unlimited checks
  const { userId } = await auth();
  const isAuthenticated = !!userId;

  // Burst rate limiter (everyone)
  pruneRateStore();
  const ip = getIp(req);
  const { ok, remaining } = checkRate(ip);

  if (!ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded — max 10 requests per minute." },
      { status: 429, headers: { "X-RateLimit-Remaining": "0" } },
    );
  }

  const rlHeaders = { "X-RateLimit-Remaining": String(remaining) };

  // Daily free-tier limit (anonymous only)
  if (!isAuthenticated) {
    pruneDailyStore();
    const daily = checkDaily(ip);
    if (!daily.ok) {
      return NextResponse.json(
        { error: "Daily limit reached — 3 free deep checks per day. Sign in to get unlimited." },
        { status: 429, headers: rlHeaders },
      );
    }
  }

  // Parse and validate body
  let text: string;
  let platform: string;
  try {
    const body  = await req.json();
    text     = (typeof body?.text     === "string" ? body.text     : "").trim();
    platform = (typeof body?.platform === "string" ? body.platform : "linkedin").trim();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: rlHeaders });
  }

  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400, headers: rlHeaders });
  }

  if (text.length > 5_000) {
    return NextResponse.json(
      { error: "Text too long — max 5,000 characters." },
      { status: 400, headers: rlHeaders },
    );
  }

  // Guard against unconfigured API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "your_key_here") {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured." },
      { status: 503, headers: rlHeaders },
    );
  }

  const platformLabel = PLATFORM_LABEL[platform] ?? "social media post";
  const client        = new Anthropic({ apiKey });

  try {
    const message = await client.messages.create({
      model:      "claude-sonnet-4-20250514",
      max_tokens: 800,
      system:     buildSystemPrompt(platformLabel),
      messages:   [{ role: "user", content: text }],
    });

    const block = message.content[0];
    if (block.type !== "text") {
      return NextResponse.json(
        { error: "Unexpected content block type from model." },
        { status: 500, headers: rlHeaders },
      );
    }

    // Strip accidental markdown fences
    const raw = block.text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/,          "")
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Return a degraded response rather than crashing — include a snippet for debugging
      return NextResponse.json(
        {
          error:   "Model returned non-JSON output.",
          snippet: block.text.slice(0, 300),
        },
        { status: 500, headers: rlHeaders },
      );
    }

    if (!isDeepCheckResponse(parsed)) {
      return NextResponse.json(
        { error: "Model response did not match expected schema." },
        { status: 500, headers: rlHeaders },
      );
    }

    return NextResponse.json(parsed, { headers: rlHeaders });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500, headers: rlHeaders });
  }
}
