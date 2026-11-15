# 🌐 Website & Google Search Setup — Step by Step

The landing page lives in **`docs/`** and is published automatically by **GitHub Pages** at:

**https://shishir-ip.github.io/Gemini-Desktop-Companion/**

Every push to `main` that touches `docs/` redeploys the site (~1 minute). No build step, no server, free forever.

---

## Step 1 — Confirm GitHub Pages is on (already done for you)

1. Open https://github.com/Shishir-ip/Gemini-Desktop-Companion/settings/pages
2. You should see: **Source: Deploy from a branch · Branch: `main` · Folder: `/docs`** and a green "Your site is live at …" banner.
3. If it ever shows "unpublished", select `main` + `/docs` and click **Save**.

> The repo **Website** field (Settings → General) also points to the site, so it appears under the repo description on GitHub.

## Step 2 — Open your live site

Visit **https://shishir-ip.github.io/Gemini-Desktop-Companion/** and check it looks right.
If you just pushed, wait ~1 minute and hard-refresh (`Ctrl+F5`).

## Step 3 — Add the site to Google Search Console

This is the dialog from your screenshot (`search.google.com` → Search Console).

1. Go to **https://search.google.com/search-console** and sign in with your Google account.
2. Click the property dropdown (top-left) → **+ Add property**.
3. Choose **URL prefix** (the right-hand card — *not* Domain; you don't own `github.io`'s DNS).
4. Enter exactly:
   ```
   https://shishir-ip.github.io/Gemini-Desktop-Companion/
   ```
   (trailing slash included) → **Continue**.
5. On the verification screen, expand **HTML tag** (under "Other verification methods").
6. Google shows a tag like:
   ```html
   <meta name="google-site-verification" content="AbCdEf12345_your_code" />
   ```
   **Copy the whole tag.**
7. In this repo, open **`docs/index.html`** and paste it on the line marked:
   ```html
   <!-- GOOGLE SEARCH CONSOLE: paste your verification meta tag on the next line ... -->
   ```
   (In GitHub you can edit the file right in the browser: press `.` or the pencil icon, paste, commit.)
8. Commit to `main`. Wait ~1 minute for Pages to redeploy.
9. Back in Search Console click **VERIFY**. ✅ Done — you now own the property.

**Alternative (HTML file method):** if you prefer, download the `googleXXXX.html` file Google offers, drop it into `docs/`, commit & push, then click Verify. Either method works; the meta tag is simplest.

## Step 4 — Submit your sitemap

1. In Search Console, left sidebar → **Sitemaps** (under Indexing).
2. Under "Add a new sitemap", enter:
   ```
   sitemap.xml
   ```
3. Click **Submit**. Status should become **Success** (may take a few minutes).

This tells Google about every page and its images in one shot.

## Step 5 — Request indexing (speeds things up)

1. Left sidebar → **URL inspection**.
2. Paste `https://shishir-ip.github.io/Gemini-Desktop-Companion/` → Enter.
3. Click **Request indexing**. Google crawls it within minutes to a few days.

> Realistic expectations: first appearance in Google results usually takes **a few days to ~2 weeks** for a brand-new site. The page is already optimized for your target queries ("circle to search windows", "gemini for windows", etc.) via the title, headings, FAQ structured data and sitemap.

## Step 6 — (Optional but recommended) Bing + backlinks

- **Bing Webmaster Tools** (https://www.bing.com/webmasters): sign in → **Import from Google Search Console** → it pulls the verified property in one click. Bing also feeds DuckDuckGo.
- **Backlinks are the #1 ranking lever.** Post your site link (not just the repo) in:
  - Reddit: r/windowsapps, r/windows, r/GoogleGemini (your earlier Reddit post can be edited to add the website link)
  - Product Hunt, AlternativeTo (list it as a Circle to Search / Google Lens alternative)
  - X/Twitter, dev.to, Hashnode — a short "I built Circle to Search for Windows" post
- Each external link pointing to the site raises its authority faster than anything on-page.

## Step 7 — Keeping the site fresh

- Edit anything in `docs/` (copy, screenshots, version number) → commit → push → auto-deploy.
- When you ship a new app version: update `v4.1.0` mentions in `docs/index.html`, replace screenshots in `docs/screenshots/`, bump `<lastmod>` in `docs/sitemap.xml`.
- Watch **Search Console → Performance** weekly: it shows the exact queries people used to find you. Add FAQ entries for queries you see but don't cover yet.

---

### What's already optimized (no action needed)

| Item | Where |
| --- | --- |
| Keyword-targeted `<title>` + meta description | `docs/index.html` |
| Canonical URL, Open Graph + Twitter cards (link previews) | `docs/index.html` |
| `SoftwareApplication` + `FAQPage` structured data (rich results) | `docs/index.html` |
| `robots.txt` + `sitemap.xml` | `docs/` |
| Fast single-file page, lazy images, no trackers | `docs/index.html` |
| Repo homepage + website badge in README | repo settings / `README.md` |