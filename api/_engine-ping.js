// THROWAWAY — Stage 5a smoke test for @milestone-maker/content-engine adoption.
// Confirms the package imports inside a Vercel serverless function and exposes
// its expected public surface. This file is deleted in Phase 6 of Stage 5a.
//
// Gate: requires header `x-engine-ping-secret` to match env var
// ENGINE_PING_SECRET. Fails closed if the env var is unset, so this route is
// never publicly callable even on preview.

import * as engine from "@milestone-maker/content-engine";

export default function handler(req, res) {
  const expected = process.env.ENGINE_PING_SECRET;
  const provided = req.headers["x-engine-ping-secret"];
  if (!expected || !provided || provided !== expected) {
    return res.status(404).end();
  }
  return res.status(200).json({
    exports: Object.keys(engine).sort(),
  });
}
