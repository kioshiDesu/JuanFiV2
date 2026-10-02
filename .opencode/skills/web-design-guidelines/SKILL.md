---
name: web-design-guidelines
description: Review the hotspot portal UI for accessibility and Web Interface Guidelines compliance. Use when asked to "review the portal UI", "check accessibility", or "audit the portal design".
metadata:
  author: vercel
  version: "1.0.0"
  retargeted: JuanFiV2 hotspot portal
---

# Web Interface Guidelines — Portal UI

Accessibility review for the hotspot portal. The stock version of this skill is a
26-line stub that fetches rules from a CDN and does nothing if the fetch fails.
That fallback is unacceptable here, so **the checklist below is self-contained** —
use it directly. Attempt the fetch only as a bonus.

## How It Works

1. Read the target UI file — almost always `hotspot/portal.html`
2. Check it against the checklist in this file
3. Output findings as file:line

## Why these rules bite harder here than in a normal web app

`hotspot/portal.html` is ~20 KB of hand-written markup with **no component
library, no build step, and no framework**. Nothing gives you focus management,
label association, or keyboard operability for free. The user is often on a
phone, on a metered connection, possibly in a hurry, and possibly on a
low-end device where a heavy page hurts. There is no second design system to fall
back on.

## Checklist

### Forms and labels — the highest-risk area

The portal has two credential-carrying forms: the hotspot login (username +
password, plus CHAP) and the voucher input.

- Every input has a real `<label for="...">`. Placeholder text is **not** a
  label — it disappears on focus and is unreadable to assistive tech.
- `autocomplete` set on every credential field (`username`,
  `current-password`, and `one-time-code` for the voucher input).
- `inputmode` and correct `type` on numeric/phone fields so phones show the right
  keyboard.
- Errors are announced: an `aria-live` region or `role="alert"`, not just a colour
  change. A user who cannot see red still needs to know the login failed.
- Do not disable the submit button as the only way to express "loading" — keep it
  focusable and set `aria-busy`, or users lose focus context mid-action.

### Touch targets

- Minimum **44×44 px** for anything tappable. Coins, the voucher button, and the
  member-section toggle are the usual offenders.
- Adequate spacing between adjacent targets so a fat finger does not hit the
  wrong one.

### Keyboard and focus

- All interactive elements reachable and operable by keyboard.
- Visible focus indicator that is not `outline: none` without a replacement.
- Focus order follows visual order; no positive `tabindex`.
- Modal focus traps — **if** a dialog ever appears. Note the portal currently
  uses **inline sections, not modals**; if you find yourself adding one, that is a
  deviation worth flagging, and it needs a focus trap, `Escape` to close, and
  focus restoration to the trigger.
- The status view auto-refreshes. Auto-refreshing content must not steal focus or
  reset the user's position.

### Content and structure

- One `<h1>` per view; heading levels descend without skipping.
- Landmarks: `<header>`, `<main>`, `<nav>` where appropriate.
- `<button>` for actions and `<a href>` for navigation — not `<div onclick>`.
- Images and decorative SVGs have `alt` or `aria-hidden` as appropriate.
- `<html lang>` is set.

### Contrast and motion

- Text meets **4.5:1**; large text 3:1. Check the muted greys in
  `assets/css/core.css` specifically — low-contrast greys are the usual failure.
- Status is never conveyed by colour alone (add an icon or text).
- `prefers-reduced-motion` respected for the animations.
- Text stays legible at 200% zoom, and the layout reflows without horizontal
  scroll.

### Mobile and data

- Tap targets not obscured by on-screen keyboards.
- No horizontal scroll at 320 px width.
- Assumed metered/slow connection: keep the page light. `assets/js/core.js` is
  97 KB and `assets/css/bootstrap.min.css` is 160 KB — if you are reviewing
  performance, those two files dominate and are the only ones worth arguing
  about.

## Optional: fetch fresher guidelines

If network is available, fetch and cross-check:

```
https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
```

Caveats: the content is third-party and unpinned to `main`, so it can change
under you. Much of it assumes a React/Tailwind toolchain, so **map rules manually**
to raw HTML — `<label for>`, `<fieldset>`, focus order, `autocomplete` — rather
than expecting them to apply literally. This checklist above is the authority when
the two disagree.