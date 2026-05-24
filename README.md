# Hook Checker

A dark-theme editorial tool for writing better social media copy. Paste a LinkedIn post, YouTube title, or TikTok caption — it highlights AI tells, slop phrases, hard violations, and hook quality issues in real time.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fdontfeedwolfwritings%2Fhook-checker&env=ANTHROPIC_API_KEY&envDescription=Anthropic%20API%20key%20for%20the%20Deep%20Check%20feature&envLink=https%3A%2F%2Fconsole.anthropic.com)

---

## What it does

**Pattern engine (no API key needed)**
- Flags hard violations in red: em dash, "spot on", "it's not X it's Y" constructions
- Flags AI slop in amber: delve, tapestry, game-changer, thought leader, "at the end of the day", leverage-as-verb, and 15+ more
- Hook quality checklist: named person, contradiction/tension signal, credibility signal — adapted per platform

**Platform modes**
- **LinkedIn** — 900–1,200 char guideline, hook truncation warning, announce-phrase detector ("Thrilled to share", "Honored to be")
- **YouTube** — curiosity-gap / number / named-person check, clickbait non-answer detection
- **TikTok / Reels** — first-line standalone hook check, hashtag count warning, generic CTA detector

**Deep Check (requires API key)**
- Calls Claude to detect issues pattern matching can't catch: preachy tone, moralizing close, teaching-vs-showing, buried insight, tidy metaphor close, fake authority

---

## Running locally

```bash
# 1. Clone
git clone https://github.com/dontfeedwolfwritings/hook-checker.git
cd hook-checker

# 2. Install
npm install

# 3. Add your Anthropic API key
#    (the regex engine works without it; Deep Check requires it)
echo "ANTHROPIC_API_KEY=sk-ant-..." >> .env.local

# 4. Start
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Deploy to Vercel

### One-click (after pushing to GitHub)

Click the **Deploy with Vercel** button at the top of this file. Vercel will:
1. Clone the repo to your account
2. Prompt you to set `ANTHROPIC_API_KEY`
3. Deploy automatically

### Manual steps

1. Push this repo to GitHub
2. Go to [vercel.com/new](https://vercel.com/new) → **Import Git Repository**
3. Select `hook-checker`
4. In **Environment Variables**, add:
   - Key: `ANTHROPIC_API_KEY`
   - Value: your key from [console.anthropic.com](https://console.anthropic.com)
5. Click **Deploy**

No `vercel.json` is needed — Vercel detects Next.js 14 automatically.

> **Hobby plan note:** Vercel Hobby functions time out at 10 seconds. Claude typically responds in 3–7 seconds for short posts, so this is fine for normal use. If you hit timeouts on very long posts, upgrade to Pro and add a `vercel.json` with `"maxDuration": 30`.

---

## Environment variables

| Variable | Required for | Where to get it |
|---|---|---|
| `ANTHROPIC_API_KEY` | Deep Check button | [console.anthropic.com](https://console.anthropic.com) |

`.env.local` is gitignored — never committed to the repo.

---

## Project structure

```
hook-checker/
├── app/
│   ├── api/
│   │   ├── deep-check/route.ts   # simple issue-list endpoint (used by Deep Check button)
│   │   └── deepcheck/route.ts    # semantic analysis with verdict + topFix
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   └── PostEditor.tsx            # main editor + sidebar (all UI)
├── lib/
│   ├── rules.ts                  # pattern-matching engine (no API needed)
│   └── platformModes.ts          # per-platform rules, char guidelines, checklist builder
└── .env.local                    # gitignored — add ANTHROPIC_API_KEY here
```

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| AI | Anthropic SDK (`@anthropic-ai/sdk`) |
| Deploy | Vercel |
