# Join the Beta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the landing page's dead-end "Get Started" CTA with a "Join the Beta" interest form that emails Dan the submission via Resend.

**Architecture:** A new public route `/join-beta` (server page + client form component) posts JSON to a new API route `app/api/beta-signup/route.ts`, which validates the payload, drops honeypot-triggered bot submissions, and sends a plain-text email through the `resend` npm package. No database writes anywhere in this feature.

**Tech Stack:** Next.js 16 App Router, React 19, a plain CSS Module (matching the existing landing page's isolated styling, not the app's Signal token system — see Global Constraints), `resend` npm package.

**Note on process adaptation:** This repo has no automated test framework (`package.json` has no Jest/Vitest/etc. — only `next build` and `eslint`). Per this project's own conventions (CLAUDE.md: "Always run `npm run build` before considering a change complete" + "test the feature in a browser before reporting complete"), each task's verification step is `npm run build` plus a manual browser check instead of an automated unit test. This is a deliberate deviation from the skill's default TDD steps, not an oversight.

## Global Constraints

- Never hardcode a color as a one-off Tailwind class inside the main app — but this feature's UI lives entirely in `app/join-beta/`, styled via its own CSS Module in the same isolated pattern as `app/page.tsx` / `app/page.module.css` (per CLAUDE.md: "styles scoped via page.module.css so they can't leak into the app"). Do not import `components/ui/Button` or other Signal-token components into this feature — match the landing page's existing hand-styled aesthetic instead, for visual continuity with the page it's linked from.
- `RESEND_API_KEY` is server-only. Never reference it in a client component or expose it to the browser.
- Sending "from" address: `hello@contact.crewtracker.app` (domain already verified in Dan's Resend account). Sending "to" address: `dan@theaudiosmith.com`.
- No database persistence of submissions — email is the only record (per approved spec).
- No thank-you redirect route — success state renders inline in place of the form.
- Surface real errors to the user on send failure — no silent no-op (per CLAUDE.md's standing rule on this).

---

## File Structure

- Create: `app/join-beta/page.module.css` — styling for the new page, cloned/adapted from `app/page.module.css`'s visual language (same color variables, font stack, button style).
- Create: `app/join-beta/JoinBetaForm.tsx` — client component: form state, honeypot field, fetch to the API route, inline success/error UI.
- Create: `app/join-beta/page.tsx` — server component: page shell (logo, heading, back link) wrapping `JoinBetaForm`.
- Create: `app/api/beta-signup/route.ts` — validates input, checks honeypot, sends the email via Resend.
- Modify: `app/page.tsx:35` — CTA label/link change only.
- Modify: `package.json` — add `resend` dependency (via `npm install`, not hand-edited).
- Modify: `.env.local` — add `RESEND_API_KEY` (value supplied by Dan at execution time — this is a secret, not something to invent).

---

### Task 1: Add the `resend` dependency and API key

**Files:**
- Modify: `package.json` (via `npm install`)
- Modify: `.env.local`

**Interfaces:**
- Produces: `RESEND_API_KEY` environment variable, readable via `process.env.RESEND_API_KEY` in any server-side file (Task 2 consumes this).
- Produces: `resend` package available to import as `import { Resend } from "resend"` (Task 2 consumes this).

- [ ] **Step 1: Install the package**

Run: `npm install resend`
Expected: `package.json` and `package-lock.json` (or equivalent lockfile) updated with `resend` under `dependencies`.

- [ ] **Step 2: Add the API key to `.env.local`**

Ask Dan for his Resend API key (from the Resend dashboard → API Keys). Add this line to `.env.local`:

```
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxx
```

(Replace with the real key Dan provides — this file is gitignored already, matching how `SUPABASE_SERVICE_ROLE_KEY` is handled.)

- [ ] **Step 3: Verify the install**

Run: `npm run build`
Expected: build succeeds with no errors (nothing references `resend` yet, so this just confirms the install didn't break anything).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "Add resend dependency for beta signup email"
```

(`.env.local` is gitignored and must NOT be committed.)

---

### Task 2: Build the `/api/beta-signup` route

**Files:**
- Create: `app/api/beta-signup/route.ts`

**Interfaces:**
- Consumes: `process.env.RESEND_API_KEY` (from Task 1).
- Produces: `POST /api/beta-signup` endpoint accepting JSON body `{ name, email, company, teamSize, adminUsers, notes, company_website }` (all strings), returning `{ ok: true }` on success (status 200) or `{ error: string }` on failure (status 400 for missing fields, 500 for send failure). Task 3's form consumes this exact request/response shape.

- [ ] **Step 1: Write the route**

```typescript
// app/api/beta-signup/route.ts
import { NextResponse } from "next/server";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: Request) {
  const body = await request.json();

  const {
    name,
    email,
    company,
    teamSize,
    adminUsers,
    notes,
    company_website, // honeypot: real users never see or fill this field
  } = body;

  // Bot caught the honeypot — pretend success, send nothing.
  if (company_website) {
    return NextResponse.json({ ok: true });
  }

  if (!name || !email || !teamSize || !adminUsers) {
    return NextResponse.json(
      { error: "Please fill in your name, email, team size, and number of admin users." },
      { status: 400 }
    );
  }

  try {
    await resend.emails.send({
      from: "CrewTracker <hello@contact.crewtracker.app>",
      to: "dan@theaudiosmith.com",
      subject: `New Beta Interest: ${company || name}`,
      text: [
        `Name: ${name}`,
        `Email: ${email}`,
        `Company: ${company || "(not provided)"}`,
        `Team size: ${teamSize}`,
        `Admin users needed: ${adminUsers}`,
        `Notes: ${notes || "(none)"}`,
      ].join("\n"),
    });
  } catch (err) {
    console.error("beta-signup: Resend send failed", err);
    return NextResponse.json(
      { error: "Something went wrong sending your request. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 3: Manual smoke test with `curl`**

Run the dev server first (`npm run dev` in one terminal), then in another:

```bash
curl -X POST http://localhost:3000/api/beta-signup \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Person","email":"test@example.com","company":"Test Co","teamSize":"12","adminUsers":"2","notes":"just testing"}'
```

Expected: `{"ok":true}` printed, and a real email arrives at `dan@theaudiosmith.com` within a minute (this is a live send — confirm receipt before moving on).

Then test the honeypot with a non-empty `company_website`:

```bash
curl -X POST http://localhost:3000/api/beta-signup \
  -H "Content-Type: application/json" \
  -d '{"name":"Bot","email":"bot@example.com","teamSize":"1","adminUsers":"1","company_website":"http://spam.example"}'
```

Expected: `{"ok":true}` printed, but **no email arrives** — confirms the honeypot silently drops the submission.

Then test missing required fields:

```bash
curl -X POST http://localhost:3000/api/beta-signup \
  -H "Content-Type: application/json" \
  -d '{"name":"Missing Fields"}'
```

Expected: HTTP 400 with `{"error":"Please fill in your name, email, team size, and number of admin users."}`.

- [ ] **Step 4: Commit**

```bash
git add app/api/beta-signup/route.ts
git commit -m "Add beta-signup API route: validates input, honeypot check, sends via Resend"
```

---

### Task 3: Build the `/join-beta` page and form

**Files:**
- Create: `app/join-beta/page.module.css`
- Create: `app/join-beta/JoinBetaForm.tsx`
- Create: `app/join-beta/page.tsx`

**Interfaces:**
- Consumes: `POST /api/beta-signup` from Task 2 (exact request/response shape as defined there).
- Produces: route `/join-beta`, consumed by Task 4's landing-page link.

- [ ] **Step 1: Write the CSS Module**

```css
/* app/join-beta/page.module.css */
.page {
  --bg-color: #1a1a1e;
  --surface-color: #24242a;
  --accent-color: #4db8ff;
  --accent-glow: rgba(77, 184, 255, 0.4);
  --text-primary: #ffffff;
  --text-secondary: #a0a0ab;

  background-color: var(--bg-color);
  color: var(--text-primary);
  line-height: 1.6;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}

.topnav {
  display: flex;
  justify-content: flex-start;
  padding: 1.5rem 5% 0;
  max-width: 700px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
}

.backLink {
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 0.9rem;
  font-weight: 600;
  transition: color 0.2s ease;
}

.backLink:hover {
  color: var(--accent-color);
}

.main {
  flex: 1;
  padding: 2rem 5% 4rem;
  max-width: 700px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
}

.hero {
  text-align: center;
  margin-bottom: 2.5rem;
}

.heroLogo {
  display: block;
  width: 100%;
  max-width: 100px;
  height: auto;
  margin: 0 auto 1rem;
  border-radius: 22px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
}

.hero h1 {
  font-size: clamp(2rem, 5vw, 2.75rem);
  line-height: 1.1;
  margin: 0 0 1rem;
}

.hero h1 span {
  color: var(--accent-color);
  text-shadow: 0 0 20px var(--accent-glow);
}

.subtitle {
  font-size: 1.1rem;
  color: var(--text-secondary);
  max-width: 500px;
  margin: 0 auto;
}

.formSection {
  background-color: var(--surface-color);
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  padding: 2rem;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.field label {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.field input,
.field textarea {
  background-color: var(--bg-color);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 0.75rem 1rem;
  color: var(--text-primary);
  font-size: 1rem;
  font-family: inherit;
}

.field input:focus,
.field textarea:focus {
  outline: none;
  border-color: var(--accent-color);
}

.honeypot {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
}

.errorMessage {
  color: #ff6b6b;
  font-size: 0.9rem;
  margin: 0;
}

.submitButton {
  display: inline-block;
  background-color: transparent;
  color: var(--accent-color);
  border: 2px solid var(--accent-color);
  padding: 1rem 2rem;
  font-size: 1.1rem;
  font-weight: 600;
  border-radius: 50px;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 0 15px var(--accent-glow);
}

.submitButton:hover:not(:disabled) {
  background-color: var(--accent-color);
  color: var(--bg-color);
  box-shadow: 0 0 25px var(--accent-glow);
}

.submitButton:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.successMessage {
  background-color: var(--surface-color);
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  padding: 2.5rem;
  text-align: center;
}

.successMessage h2 {
  color: var(--accent-color);
  margin: 0 0 0.5rem;
}

.successMessage p {
  color: var(--text-secondary);
  margin: 0;
}

@media (max-width: 600px) {
  .formSection {
    padding: 1.5rem;
  }
}
```

- [ ] **Step 2: Write the form client component**

```tsx
// app/join-beta/JoinBetaForm.tsx
"use client";

import { useState } from "react";
import styles from "./page.module.css";

type Status = "idle" | "submitting" | "success" | "error";

export default function JoinBetaForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("submitting");
    setErrorMessage("");

    const form = e.currentTarget;
    const data = new FormData(form);

    const payload = {
      name: data.get("name"),
      email: data.get("email"),
      company: data.get("company"),
      teamSize: data.get("teamSize"),
      adminUsers: data.get("adminUsers"),
      notes: data.get("notes"),
      company_website: data.get("company_website"),
    };

    try {
      const res = await fetch("/api/beta-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const responseBody = await res.json().catch(() => ({}));
        setErrorMessage(responseBody.error || "Something went wrong. Please try again.");
        setStatus("error");
        return;
      }

      setStatus("success");
    } catch {
      setErrorMessage("Something went wrong. Please check your connection and try again.");
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className={styles.successMessage}>
        <h2>Thanks!</h2>
        <p>We&apos;ve got your info and will be in touch about joining the CrewTracker Beta.</p>
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.field}>
        <label htmlFor="name">Name</label>
        <input id="name" name="name" type="text" required />
      </div>

      <div className={styles.field}>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required />
      </div>

      <div className={styles.field}>
        <label htmlFor="company">Company Name</label>
        <input id="company" name="company" type="text" />
      </div>

      <div className={styles.field}>
        <label htmlFor="teamSize">Team Size (crew you track)</label>
        <input id="teamSize" name="teamSize" type="text" required />
      </div>

      <div className={styles.field}>
        <label htmlFor="adminUsers">Admin Users Needed</label>
        <input id="adminUsers" name="adminUsers" type="text" required />
      </div>

      <div className={styles.field}>
        <label htmlFor="notes">Anything else?</label>
        <textarea id="notes" name="notes" rows={4} />
      </div>

      {/* Honeypot: hidden from real users; bots tend to fill every field they find */}
      <div className={styles.honeypot} aria-hidden="true">
        <label htmlFor="company_website">Company Website</label>
        <input id="company_website" name="company_website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      {status === "error" && <p className={styles.errorMessage}>{errorMessage}</p>}

      <button type="submit" className={styles.submitButton} disabled={status === "submitting"}>
        {status === "submitting" ? "Sending..." : "Request an Invite"}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Write the page shell**

```tsx
// app/join-beta/page.tsx
import Image from "next/image";
import Link from "next/link";
import styles from "./page.module.css";
import JoinBetaForm from "./JoinBetaForm";

export default function JoinBetaPage() {
  return (
    <div className={styles.page}>
      <div className={styles.topnav}>
        <Link href="/" className={styles.backLink}>&larr; Back to CrewTracker</Link>
      </div>

      <main className={styles.main}>
        <section className={styles.hero}>
          <Image
            src="/app-icon.png"
            alt="CrewTracker app icon"
            width={100}
            height={100}
            className={styles.heroLogo}
            priority
          />
          <h1>Join the <span>Beta</span></h1>
          <p className={styles.subtitle}>
            Tell us a bit about your team and we&apos;ll reach out about getting you set up.
          </p>
        </section>

        <section className={styles.formSection}>
          <JoinBetaForm />
        </section>
      </main>

      <footer className={styles.footer}>
        <p>&copy; 2026 CrewTracker. All rights reserved.</p>
      </footer>
    </div>
  );
}
```

- [ ] **Step 4: Verify it builds**

Run: `npm run build`
Expected: build succeeds with no TypeScript/ESLint errors.

- [ ] **Step 5: Manual browser verification**

Run `npm run dev`, open `http://localhost:3000/join-beta` in a browser:
- Confirm the page renders with logo, heading, and all six visible fields (Name, Email, Company, Team Size, Admin Users, Anything Else) — honeypot field should not be visible.
- Submit with all required fields filled: confirm the form is replaced by the "Thanks!" message, and a real email arrives at `dan@theaudiosmith.com`.
- Reload and submit with Name left blank: confirm the browser's native `required` validation blocks submission (no request sent).

- [ ] **Step 6: Commit**

```bash
git add app/join-beta/
git commit -m "Add /join-beta page: interest form for the beta CTA"
```

---

### Task 4: Point the landing page CTA at `/join-beta`

**Files:**
- Modify: `app/page.tsx:35`

**Interfaces:**
- Consumes: route `/join-beta` from Task 3.

- [ ] **Step 1: Change the CTA link**

In `app/page.tsx`, change:

```tsx
<Link href="/login" className={styles.ctaButton}>Get Started</Link>
```

to:

```tsx
<Link href="/join-beta" className={styles.ctaButton}>Join the Beta</Link>
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 3: Manual browser verification**

Run `npm run dev`, open `http://localhost:3000/`:
- Confirm the CTA button now reads "Join the Beta".
- Click it, confirm it navigates to `/join-beta`.
- Confirm the "Log In" link in the top nav is unchanged (still goes to `/login`).

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "Point landing page CTA at the new Join the Beta form"
```

---

### Task 5: Production env var (manual, Dan-only step)

This task has no code changes — it's a reminder so the feature doesn't silently fail once deployed.

- [ ] **Step 1:** Dan adds `RESEND_API_KEY` (same value as in `.env.local`) to the Vercel project's environment variables (Production and Preview), via the Vercel dashboard → Project Settings → Environment Variables. (The Vercel CLI isn't installed in this environment, and this is a production-account settings change, so it's a manual step for Dan rather than something run from here.)
- [ ] **Step 2:** After the next deploy, Dan submits the live `/join-beta` form once on `crewtracker-lime.vercel.app` to confirm the email arrives in production, not just locally.

---

## Spec Coverage Check

- Landing page CTA label/link change → Task 4. ✅
- New `/join-beta` route with the six specified fields + honeypot → Task 3. ✅
- POST to `/api/beta-signup`, validation, honeypot silent-drop, Resend send, error surfacing → Task 2. ✅
- No DB writes anywhere → confirmed, no task touches Supabase. ✅
- Inline success message, no redirect → Task 3 Step 2 (`JoinBetaForm`). ✅
- `resend` dependency + `RESEND_API_KEY` env var, local and production → Tasks 1 and 5. ✅
