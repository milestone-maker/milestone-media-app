// Vercel Serverless Function — robots.txt.
// GET /api/robots   (wired to /robots.txt via vercel.json rewrite)
//
// SEO stage 2 (discovery): a real robots.txt that allows crawling, keeps bots out
// of /api/, and points at the dynamic sitemap. Anonymous, unauthenticated, no DB.
// The Sitemap line uses the centralized PUBLIC_APP_BASE (never a hardcoded domain).

import { PUBLIC_APP_BASE } from "./_lib/microsite.js";

// Pure builder (exported for tests).
export function buildRobotsTxt(base = PUBLIC_APP_BASE) {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    `Sitemap: ${base}/sitemap.xml`,
    "",
  ].join("\n");
}

export default async function handler(req, res) {
  res.status(200);
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=86400");
  return res.end(buildRobotsTxt());
}
