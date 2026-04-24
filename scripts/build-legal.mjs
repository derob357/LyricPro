// Convert docs/legal/*.md to standalone static HTML pages under
// client/public/. Run after editing any doc in docs/legal/:
//
//   node scripts/build-legal.mjs
//
// The generated HTML files are committed; Vite serves them verbatim from
// client/public/ at /<slug>.html. No client-bundle cost — the pages load
// as plain HTML with a tiny inline stylesheet.

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Input (markdown) -> output (static HTML) mapping. Add new entries as
// more legal docs are authored.
const DOCS = [
  { md: "docs/legal/privacy-policy.md",   out: "client/public/privacy.html", title: "Privacy Policy — LyricPro Ai" },
  { md: "docs/legal/terms-of-service.md", out: "client/public/terms.html",   title: "Terms of Service — LyricPro Ai" },
];

// Minimal inline stylesheet — matches LyricPro's dark / purple-accent
// palette but standalone so the page loads with no app JS/CSS. Using system
// font stack keeps the page fast and avoids pulling the Google Fonts that
// the SPA does.
const CSS = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  background: #0a0613;
  color: #e8e5f0;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  line-height: 1.7;
}
.wrap { max-width: 760px; margin: 0 auto; padding: 48px 24px 80px; }
.back { display: inline-block; margin-bottom: 24px; color: #c0a7ff; text-decoration: none; font-size: 14px; }
.back:hover { color: #fff; }
h1 { font-size: 32px; line-height: 1.2; margin: 0 0 24px; color: #fff; }
h2 { font-size: 22px; margin: 40px 0 12px; color: #fff; border-top: 1px solid #2a2240; padding-top: 28px; }
h3 { font-size: 17px; margin: 28px 0 8px; color: #d6caf5; }
p, li { color: #c9c5dc; }
a { color: #c0a7ff; }
a:hover { color: #fff; }
strong { color: #fff; }
hr { border: 0; border-top: 1px solid #2a2240; margin: 32px 0; }
blockquote {
  margin: 20px 0;
  padding: 12px 16px;
  border-left: 3px solid #8b5cf6;
  background: rgba(139, 92, 246, 0.08);
  color: #d6caf5;
  border-radius: 0 8px 8px 0;
}
table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; }
th, td { padding: 10px 12px; border: 1px solid #2a2240; text-align: left; vertical-align: top; }
th { background: rgba(139, 92, 246, 0.1); color: #fff; }
code { background: rgba(139, 92, 246, 0.12); color: #d6caf5; padding: 1px 6px; border-radius: 4px; font-size: 90%; }
ul, ol { padding-left: 22px; }
li { margin: 4px 0; }
@media (max-width: 520px) {
  .wrap { padding: 32px 16px 64px; }
  h1 { font-size: 26px; }
  h2 { font-size: 19px; }
}
`;

marked.setOptions({ gfm: true, breaks: false });

function wrapHtml(title, bodyHtml) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="robots" content="index, follow" />
  <style>${CSS}</style>
</head>
<body>
  <main class="wrap">
    <a class="back" href="/">&larr; Back to LyricPro Ai</a>
    ${bodyHtml}
  </main>
</body>
</html>
`;
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

console.log("[build-legal] converting markdown docs to static HTML");
for (const { md, out, title } of DOCS) {
  const source = readFileSync(join(ROOT, md), "utf8");
  const bodyHtml = marked.parse(source);
  const fullHtml = wrapHtml(title, bodyHtml);
  writeFileSync(join(ROOT, out), fullHtml);
  console.log(`  ${md} -> ${out}`);
}
console.log("[build-legal] done");
