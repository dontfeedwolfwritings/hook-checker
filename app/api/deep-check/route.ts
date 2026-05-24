import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const PLATFORM_LABEL: Record<string, string> = {
  linkedin: "a LinkedIn text post",
  youtube:  "a YouTube video title",
  tiktok:   "a TikTok or Instagram Reels caption",
};

const SYSTEM_PROMPT = `You are a sharp copy editor. When given a piece of social media copy, \
you return a JSON array of semantic weaknesses — nothing else. \
Categories to flag:
- Vague claim: assertion without evidence or specificity
- Overpromise: implies a result the copy cannot back up
- Unclear value prop: what the reader gains is not stated
- Weak CTA: call to action is absent or generic
- Logic gap: claim contradicts itself or skips a reasoning step

Each item in the array must be: {"category":"<label>","issue":"<what is weak>","suggestion":"<concrete fix>"}
Return at most 5 items. If the copy is solid, return [].
Return ONLY the JSON array — no prose, no markdown fences.`;

export async function POST(req: NextRequest) {
  const { text, platform } = (await req.json()) as {
    text?: string;
    platform?: string;
  };

  if (!text?.trim()) {
    return NextResponse.json({ issues: [] });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "your_key_here") {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured" },
      { status: 503 }
    );
  }

  const client = new Anthropic({ apiKey });
  const context = PLATFORM_LABEL[platform ?? ""] ?? "a social media post";

  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Platform: ${context}\n\nCopy:\n"""\n${text.trim()}\n"""`,
        },
      ],
    });

    const block = message.content[0];
    if (block.type !== "text") {
      return NextResponse.json({ issues: [] });
    }

    // Strip accidental markdown fences if the model adds them
    const raw = block.text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    const issues = JSON.parse(raw);
    return NextResponse.json({
      issues: Array.isArray(issues) ? issues : [],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
