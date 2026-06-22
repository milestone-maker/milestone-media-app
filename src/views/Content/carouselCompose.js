// Client-side carousel composition for Style B "statement-then-reveal".
//
// Reuses the app's existing browser-canvas + JSZip pattern (see
// views/Bookings: canvas.toBlob + window.JSZip + object-URL download). The
// published-media bucket serves Access-Control-Allow-Origin: * so photos load
// with crossOrigin="anonymous" and the canvas is NOT tainted → toBlob works.
//
// BRAND-PARAMETERIZED: every renderer takes a brandTokens object so upcoming
// white-label work can feed brokerage/agent brand values into the same tokens
// with no redesign. Defaults are a light, typography-led luxury look (NOT the
// dark dashboard theme).
//
// Built so a Style A (text-over-photo) renderer can be added later reusing the
// same primitives + brandTokens, without changing callers.

export const SLIDE_W = 1080;
export const SLIDE_H = 1350; // IG 4:5 portrait

export const DEFAULT_BRAND_TOKENS = {
  bgColor:      "#FBF7EE", // warm off-white / cream
  textColor:    "#1A1A1A", // charcoal / near-black
  mutedColor:   "#6B6256", // muted warm gray for footer/stat text
  accentColor:  "#C9A84C", // gold — used sparingly (thin rule / small kicker)
  fontHeadline: "Cormorant Garamond",
  fontBody:     "Jost",
  logoUrl:      "/logo.png",
};

// Canonical photo_labels category → human-readable kicker.
// Exported (see bottom of file) so the "Replace photo" picker labels candidate
// photos with the same room names the rendered cards/photo labels use.
const HUMAN_SUBJECT = {
  drone:            "Aerial",
  front_facade:     "Exterior",
  backyard:         "Backyard",
  living:           "Living Room",
  dining:           "Dining Room",
  kitchen:          "Kitchen",
  primary_bedroom:  "Primary Suite",
  primary_bathroom: "Primary Bath",
};

// ── Font readiness ───────────────────────────────────────────────────
// Canvas can only draw with a font once the browser has loaded that exact
// family/weight/size. Load the weights the cards use before drawing.
export async function ensureFonts(bt = DEFAULT_BRAND_TOKENS) {
  if (typeof document === "undefined" || !document.fonts) return;
  const specs = [
    `700 90px "${bt.fontHeadline}"`,
    `600 60px "${bt.fontHeadline}"`,
    `600 48px "${bt.fontHeadline}"`,
    `600 40px "${bt.fontHeadline}"`,
    `600 32px "${bt.fontHeadline}"`,
    `400 48px "${bt.fontHeadline}"`,
    `600 30px "${bt.fontBody}"`,
    `500 26px "${bt.fontBody}"`,
    `400 26px "${bt.fontBody}"`,
    `400 22px "${bt.fontBody}"`,
  ];
  try {
    await Promise.all(specs.map((s) => document.fonts.load(s)));
    await document.fonts.ready;
  } catch {
    /* fall through — canvas will use a fallback face if loading fails */
  }
}

// ── Primitives ───────────────────────────────────────────────────────

export function loadImage(url, crossOrigin = "anonymous") {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = crossOrigin;
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load image: ${url}`));
    img.src = url;
  });
}

// Draw `img` cover-cropped (fill) into the W×H rect at (0,0).
export function coverCrop(ctx, img, W, H) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const scale = Math.max(W / iw, H / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = (W - dw) / 2;
  const dy = (H - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
}

// Wrap `text` to fit `maxWidth`, return array of lines. ctx.font must be set.
function wrapLines(ctx, text, maxWidth) {
  const words = String(text || "").trim().split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Pick the largest size (from `sizes`) whose wrapped text fits in maxLines.
function fitWrap(ctx, text, family, weight, maxWidth, sizes, maxLines) {
  for (const size of sizes) {
    ctx.font = `${weight} ${size}px "${family}"`;
    const lines = wrapLines(ctx, text, maxWidth);
    if (lines.length <= maxLines) return { size, lines };
  }
  const size = sizes[sizes.length - 1];
  ctx.font = `${weight} ${size}px "${family}"`;
  return { size, lines: wrapLines(ctx, text, maxWidth) };
}

// Draw centered wrapped lines starting at centerY (vertical center of block).
function drawCenteredBlock(ctx, lines, size, lineHeight, cx, centerY, color) {
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const total = lines.length * lineHeight;
  let y = centerY - total / 2 + size; // first baseline
  for (const ln of lines) {
    ctx.fillText(ln, cx, y);
    y += lineHeight;
  }
  return y;
}

// Thin accent hairline frame inset by `inset` px.
export function drawBrandFrame(ctx, W, H, accent, inset = 48) {
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2);
}

function drawFooter(ctx, footer, bt) {
  if (!footer) return;
  const parts = [];
  if (footer.agentName) parts.push(footer.agentName);
  if (footer.brokerage) parts.push(footer.brokerage);
  const line1 = parts.join("  ·  ");
  ctx.textAlign = "center";
  if (line1) {
    ctx.font = `500 26px "${bt.fontBody}"`;
    ctx.fillStyle = bt.mutedColor;
    ctx.fillText(line1, SLIDE_W / 2, SLIDE_H - 132);
  }
  if (footer.license) {
    ctx.font = `400 22px "${bt.fontBody}"`;
    ctx.fillStyle = bt.mutedColor;
    ctx.fillText(`TREC #${footer.license}`, SLIDE_W / 2, SLIDE_H - 100);
  }
}

// ── Card renderer (Style B) ──────────────────────────────────────────
// beat: { kind:'hook'|'room'|'cta', statement, kicker?, stats?, footer?, contact? }
export async function renderCardSlide(beat, bt = DEFAULT_BRAND_TOKENS, logoImg = null) {
  const canvas = document.createElement("canvas");
  canvas.width = SLIDE_W; canvas.height = SLIDE_H;
  const ctx = canvas.getContext("2d");

  // Background + single ornament (thin gold frame).
  ctx.fillStyle = bt.bgColor;
  ctx.fillRect(0, 0, SLIDE_W, SLIDE_H);
  drawBrandFrame(ctx, SLIDE_W, SLIDE_H, bt.accentColor);

  const cx = SLIDE_W / 2;

  // Logo — small + quiet, top center.
  if (logoImg) {
    const lw = 150;
    const lh = (logoImg.naturalHeight / logoImg.naturalWidth) * lw || 60;
    ctx.globalAlpha = 0.9;
    ctx.drawImage(logoImg, cx - lw / 2, 120, lw, lh);
    ctx.globalAlpha = 1;
  }

  // Kicker (room) — uppercase Jost, accent, small. Room cards only.
  if (beat.kicker) {
    ctx.font = `600 30px "${bt.fontBody}"`;
    ctx.fillStyle = bt.accentColor;
    ctx.textAlign = "center";
    ctx.fillText(beat.kicker.toUpperCase(), cx, 360, SLIDE_W - 240);
    // single thin accent rule under the kicker
    ctx.strokeStyle = bt.accentColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 40, 392);
    ctx.lineTo(cx + 40, 392);
    ctx.stroke();
  }

  // Statement — headline serif, centered, fit-wrapped, large (bolder on hook).
  const weight = beat.kind === "hook" ? 700 : 600;
  const sizes = beat.kind === "hook" ? [104, 92, 80, 70, 60] : [92, 82, 72, 62, 54];
  const { size, lines } = fitWrap(ctx, beat.statement || "", bt.fontHeadline, weight, SLIDE_W - 240, sizes, 6);
  drawCenteredBlock(ctx, lines, size, Math.round(size * 1.12), cx, SLIDE_H / 2, bt.textColor);

  // Hook stat strip beneath the statement.
  if (beat.kind === "hook" && beat.stats) {
    const st = [];
    if (beat.stats.beds != null && beat.stats.beds !== "") st.push(`${beat.stats.beds} BD`);
    if (beat.stats.baths != null && beat.stats.baths !== "") st.push(`${beat.stats.baths} BA`);
    if (beat.stats.sqft) st.push(`${beat.stats.sqft} SF`);
    if (beat.stats.city) st.push(beat.stats.city);
    if (st.length) {
      ctx.font = `500 30px "${bt.fontBody}"`;
      ctx.fillStyle = bt.mutedColor;
      ctx.textAlign = "center";
      ctx.fillText(st.join("   ·   "), cx, SLIDE_H / 2 + lines.length * Math.round(size * 1.12) / 2 + 70, SLIDE_W - 200);
    }
  }

  // CTA contact line.
  if (beat.kind === "cta" && beat.contact) {
    ctx.font = `500 30px "${bt.fontBody}"`;
    ctx.fillStyle = bt.accentColor;
    ctx.textAlign = "center";
    ctx.fillText(beat.contact, cx, SLIDE_H / 2 + lines.length * Math.round(size * 1.12) / 2 + 70, SLIDE_W - 200);
  }

  drawFooter(ctx, beat.footer, bt);
  return canvas;
}

// ── Photo renderer — fit the WHOLE photo onto the branded background ──
// Contain-fit (no cover-crop) so the entire room is visible, on the same cream
// card background, with an uppercase room label beneath. Always 1080x1350.
export async function renderPhotoSlide(photoUrl, { category, brandTokens } = {}) {
  const bt = { ...DEFAULT_BRAND_TOKENS, ...(brandTokens || {}) };
  const img = await loadImage(photoUrl, "anonymous");
  const canvas = document.createElement("canvas");
  canvas.width = SLIDE_W; canvas.height = SLIDE_H;
  const ctx = canvas.getContext("2d");

  // Branded background (matches the cards).
  ctx.fillStyle = bt.bgColor;
  ctx.fillRect(0, 0, SLIDE_W, SLIDE_H);

  const label = category ? (HUMAN_SUBJECT[category] || "") : "";
  const margin = 64;
  const labelBand = label ? 110 : 0;       // reserved space at the bottom
  const availW = SLIDE_W - margin * 2;       // ~952 — fit to width
  const availH = SLIDE_H - margin * 2 - labelBand;

  // Contain-fit: show the whole photo, never crop. For typical landscape
  // listing shots width is the binding constraint (fit-to-width); portraits
  // fall back to height so nothing is cut off.
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const scale = Math.min(availW / iw, availH / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = (SLIDE_W - dw) / 2;
  const dy = margin + (availH - dh) / 2;     // centered in the area above the label
  ctx.drawImage(img, dx, dy, dw, dh);

  // Room label beneath the photo — uppercase Jost in the accent color, with a
  // short thin hairline above it (matches the card kicker treatment).
  if (label) {
    const cx = SLIDE_W / 2;
    ctx.strokeStyle = bt.accentColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 40, SLIDE_H - 112);
    ctx.lineTo(cx + 40, SLIDE_H - 112);
    ctx.stroke();

    ctx.font = `600 30px "${bt.fontBody}"`;
    ctx.fillStyle = bt.accentColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(label.toUpperCase(), cx, SLIDE_H - 66, SLIDE_W - 240);
  }

  return canvas;
}

// ── Combined renderer (photo top + caption band bottom) ─────────────
// One 1080×1350 slide: photo cover-cropped into the top ~72%, caption band
// across the bottom ~28% reusing the existing brand tokens (cream surface,
// gold rule + kicker, Cormorant headline, Jost footer). Used by the
// Instagram Walkthrough Carousel flow; replaces the legacy alternating
// card-then-photo pair with one combined image per source slide.
//
// item shape: { kind:"hook"|"room"|"cta", statement, kicker?, photo_url, stats?, footer?, contact? }
//   - photo_url MUST be set (callers fall back to hero/exterior; renderer also
//     paints a cream-only fallback when no photo is supplied)
//   - kicker is OMITTED entirely on slides with no room label (per spec)
const COMBINED_BAND_HEIGHT  = 377;   // 28% of 1350 (bottom band)
const COMBINED_PHOTO_HEIGHT = SLIDE_H - COMBINED_BAND_HEIGHT; // 973
const COMBINED_CAPTION_SIZES = [48, 40, 32];
const COMBINED_MAX_CAPTION_LINES = 3;

function truncateLineWithEllipsis(ctx, line, maxWidth) {
  if (ctx.measureText(line).width <= maxWidth) return line;
  let s = String(line);
  while (s.length > 1 && ctx.measureText(s + "…").width > maxWidth) {
    s = s.slice(0, -1);
  }
  return s + "…";
}

export async function renderCombinedSlide(item, bt = DEFAULT_BRAND_TOKENS) {
  const canvas = document.createElement("canvas");
  canvas.width = SLIDE_W; canvas.height = SLIDE_H;
  const ctx = canvas.getContext("2d");

  // 1. Cream background fills the whole frame (also visible behind the band
  //    and as a fallback if the photo fails to load).
  ctx.fillStyle = bt.bgColor;
  ctx.fillRect(0, 0, SLIDE_W, SLIDE_H);

  // 2. Photo — cover-cropped into the top 72%, edge to edge (no letterbox).
  //    On any load/decode failure, leave the cream surface visible (the band
  //    + caption still tell the story).
  if (item.photo_url) {
    try {
      const img = await loadImage(item.photo_url, "anonymous");
      // Reuse coverCrop but constrain to the photo rect (it draws to (0,0,W,H)
      // by design, so clip to the rect, translate, then draw).
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, SLIDE_W, COMBINED_PHOTO_HEIGHT);
      ctx.clip();
      coverCrop(ctx, img, SLIDE_W, COMBINED_PHOTO_HEIGHT);
      ctx.restore();
    } catch {
      // photo failed — cream stays
    }
  }

  // 3. Cream band fills the bottom 28% (covers any photo bleed at the seam).
  ctx.fillStyle = bt.bgColor;
  ctx.fillRect(0, COMBINED_PHOTO_HEIGHT, SLIDE_W, COMBINED_BAND_HEIGHT);

  // 4. 2px gold rule at the band's TOP edge.
  ctx.strokeStyle = bt.accentColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, COMBINED_PHOTO_HEIGHT + 1);
  ctx.lineTo(SLIDE_W, COMBINED_PHOTO_HEIGHT + 1);
  ctx.stroke();

  // 5. Optional kicker (room/beat label) — Jost 600 30px gold, OMITTED if
  //    no kicker (per spec: do not print "Detail").
  const cx = SLIDE_W / 2;
  const bandTop = COMBINED_PHOTO_HEIGHT; // 973
  const hasKicker = !!(item.kicker && String(item.kicker).trim());
  if (hasKicker) {
    ctx.font = `600 30px "${bt.fontBody}"`;
    ctx.fillStyle = bt.accentColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(String(item.kicker).toUpperCase(), cx, bandTop + 50, SLIDE_W - 140);
  }

  // 6. Caption — Cormorant 600, auto-sized 48 → 40 → 32 with max 3 lines.
  //    If still overflowing at 32px, last line gets an ellipsis.
  //    Caption sits in a vertical block between the kicker (or band top) and
  //    the footer band at the bottom.
  const captionTop    = hasKicker ? bandTop + 70 : bandTop + 30;
  const footerReserve = 70; // space at the bottom for the footer line(s)
  const captionAreaH  = SLIDE_H - footerReserve - captionTop;
  const captionMaxW   = SLIDE_W - 140;

  if (item.statement) {
    const { size, lines } = fitWrap(
      ctx,
      item.statement,
      bt.fontHeadline,
      600,
      captionMaxW,
      COMBINED_CAPTION_SIZES,
      COMBINED_MAX_CAPTION_LINES,
    );
    // If still over the max-lines budget at the smallest size, ellipsis the
    // last visible line and drop the rest.
    let finalLines = lines;
    if (lines.length > COMBINED_MAX_CAPTION_LINES) {
      ctx.font = `600 ${size}px "${bt.fontHeadline}"`;
      const kept = lines.slice(0, COMBINED_MAX_CAPTION_LINES);
      kept[kept.length - 1] = truncateLineWithEllipsis(
        ctx,
        kept[kept.length - 1] + " " + lines[COMBINED_MAX_CAPTION_LINES].slice(0, 1),
        captionMaxW,
      );
      finalLines = kept;
    }
    const lineHeight = Math.round(size * 1.12);
    const block      = finalLines.length * lineHeight;
    const centerY    = captionTop + captionAreaH / 2;
    // Set the font once more in case fitWrap downgraded then truncate path mutated it.
    ctx.font = `600 ${size}px "${bt.fontHeadline}"`;
    drawCenteredBlock(ctx, finalLines, size, lineHeight, cx, centerY, bt.textColor);
    // Suppress unused-var lint without changing behaviour.
    void block;
  }

  // 7. Footer (agent · brokerage · TREC) — Jost 400 22px muted, hugging bottom.
  if (item.footer) {
    const f = item.footer;
    const parts = [];
    if (f.agentName) parts.push(f.agentName);
    if (f.brokerage) parts.push(f.brokerage);
    if (f.license)   parts.push(`TREC #${f.license}`);
    if (parts.length) {
      ctx.font = `400 22px "${bt.fontBody}"`;
      ctx.fillStyle = bt.mutedColor;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(parts.join("  ·  "), cx, SLIDE_H - 30, SLIDE_W - 100);
    }
  }

  return canvas;
}

// Combined sequence builder: ONE entry per source slide. Hook/CTA slides
// without a natural photo reuse another listing photo (preference order:
// the cover photo, else the first available photo). If no source slide has
// any photo at all, the entry keeps photo_url = null and the renderer falls
// back to a cream-only band card.
//
// Emitted item shape: { type:"combined", kind, statement, kicker, photo_url,
//   category, stats?, footer?, contact?, sourceIndex, needsCaption }
export function buildSlideSequenceCombined(slides, { stats, footer } = {}) {
  const list = Array.isArray(slides) ? slides : [];
  if (!list.length) return [];

  // Photo fallback inventory (ordered): cover first, then everything else in
  // source order. Used to fill in hook/CTA slides that arrive without photo_url.
  const coverPhotos = [];
  const otherPhotos = [];
  for (const s of list) {
    if (!s || !s.photo_url) continue;
    const entry = { photo_url: s.photo_url, category: s.category };
    if (s.is_cover || s.subject === "cover") coverPhotos.push(entry);
    else otherPhotos.push(entry);
  }
  const fallbackForHook  = coverPhotos[0] || otherPhotos[0] || null;
  // For the CTA: prefer something different from the cover (e.g. an exterior
  // / twilight), else the cover, else the first available.
  const fallbackForCta   =
    otherPhotos[otherPhotos.length - 1] ||
    coverPhotos[0] ||
    otherPhotos[0] ||
    null;

  const seq = [];
  for (let si = 0; si < list.length; si++) {
    const s = list[si];
    const statement   = s.statement || s.text || "";
    const isCover     = s.is_cover || s.subject === "cover";
    const isFinal     = s.subject === "final";
    const needsCaption = s._needsCaption === true;

    // Source photo_url + category. Hook/CTA fall back; rooms keep their own.
    let photo_url = s.photo_url || null;
    let category  = s.category || null;
    if (!photo_url) {
      const fb = isCover ? fallbackForHook : (isFinal ? fallbackForCta : null);
      if (fb) { photo_url = fb.photo_url; category = fb.category; }
    }

    if (isCover) {
      seq.push({
        type: "combined", kind: "hook",
        statement, kicker: "", // hook has no room label
        photo_url, category,
        stats, footer,
        sourceIndex: si, needsCaption,
      });
    } else if (isFinal) {
      seq.push({
        type: "combined", kind: "cta",
        statement, kicker: "",
        photo_url, category,
        footer, contact: footer?.contact || "",
        sourceIndex: si, needsCaption,
      });
    } else {
      seq.push({
        type: "combined", kind: "room",
        statement, kicker: HUMAN_SUBJECT[s.category] || "",
        photo_url, category,
        footer,
        sourceIndex: si, needsCaption,
      });
    }
  }
  return seq;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

// ── Sequence builder: logical model slides → Style B render sequence ──
// Cover slide → hook card + cover photo. Subject slides → room card + photo.
// Final slide → CTA card (no photo). Order preserved.
export function buildSlideSequence(slides, { stats, footer } = {}) {
  const seq = [];
  const list = Array.isArray(slides) ? slides : [];
  // sourceIndex maps each emitted item back to the source slide it came from
  // (additive field; existing consumers ignore it). A card and its photo share
  // the same sourceIndex so an edited lightbox card writes back to the right slide.
  for (let si = 0; si < list.length; si++) {
    const s = list[si];
    const statement = s.statement || s.text || "";
    const isCover = s.is_cover || s.subject === "cover";
    const isFinal = s.subject === "final";
    // needsCaption: this slide's photo was swapped but its statement has not
    // been regenerated yet (regen failed or pending after a failure). Set on
    // BOTH the card and the photo item for the source slide so the
    // "Caption needs updating" marker shows on the strip and in the lightbox.
    // Additive field — existing consumers ignore it. (See _needsCaption in
    // Content/index.jsx swap handlers.)
    const needsCaption = s._needsCaption === true;
    if (isCover) {
      seq.push({ type: "card", kind: "hook", statement, stats, footer, sourceIndex: si, needsCaption });
      if (s.photo_url) seq.push({ type: "photo", kind: "photo", photo_url: s.photo_url, category: s.category, sourceIndex: si, needsCaption });
    } else if (isFinal) {
      seq.push({ type: "card", kind: "cta", statement, footer, contact: footer?.contact || "", sourceIndex: si, needsCaption });
      if (s.photo_url) seq.push({ type: "photo", kind: "photo", photo_url: s.photo_url, category: s.category, sourceIndex: si, needsCaption });
    } else {
      seq.push({ type: "card", kind: "room", statement, kicker: HUMAN_SUBJECT[s.category] || "", footer, sourceIndex: si, needsCaption });
      if (s.photo_url) seq.push({ type: "photo", kind: "photo", photo_url: s.photo_url, category: s.category, sourceIndex: si, needsCaption });
    }
  }
  return seq;
}

// ── Compose the full carousel → ordered [{ name, blob }] ──────────────
// `platform` selects the slide-sequence shape: "instagram" uses the new
// combined photo+band renderer (ONE image per source slide); any other value
// (or omission) falls back to the legacy card+photo pair. Defaults to
// "instagram" because Walkthrough Carousel is IG-only today — callers can
// still pass platform: "facebook" (or anything else) to get the legacy
// sequence if a non-IG consumer is wired up later.
export async function composeCarousel({ slides, stats, footer, brandTokens, platform = "instagram" } = {}) {
  const bt = { ...DEFAULT_BRAND_TOKENS, ...(brandTokens || {}) };
  await ensureFonts(bt);

  let logoImg = null;
  // Load the logo in CORS mode ("anonymous"), NOT null. A non-CORS request taints
  // the card canvas (drawImage of a cross-origin image), and the later toBlob then
  // throws SecurityError ("The operation is insecure" / "Tainted canvases may not
  // be exported"), failing the whole download. The agent-branding bucket sends
  // Access-Control-Allow-Origin: *, so the CORS load succeeds. If a logo host has
  // no CORS, the load fails and the catch leaves logoImg = null (card renders
  // without a logo) — strictly better than tainting the export.
  if (bt.logoUrl) { try { logoImg = await loadImage(bt.logoUrl, "anonymous"); } catch { logoImg = null; } }

  const useCombined = platform === "instagram";
  const seq = useCombined
    ? buildSlideSequenceCombined(slides, { stats, footer })
    : buildSlideSequence(slides, { stats, footer });

  const files = [];
  let idx = 0;
  for (const item of seq) {
    idx += 1;
    const num = String(idx).padStart(2, "0");
    if (item.type === "combined") {
      try {
        const canvas = await renderCombinedSlide(item, bt);
        const blob = await canvasToBlob(canvas, "image/jpeg", 0.92);
        files.push({ name: `${num}_slide.jpg`, blob });
      } catch (e) {
        console.warn(`[composeCarousel] skipped slide ${num} (combined, kind=${item.kind || "?"}):`, e?.message || e);
      }
    } else if (item.type === "card") {
      try {
        const canvas = await renderCardSlide(item, bt, logoImg);
        const blob = await canvasToBlob(canvas, "image/png");
        files.push({ name: `${num}_card.png`, blob });
      } catch (e) {
        // Skip a card that fails to compose/export (e.g. a tainted canvas) rather
        // than failing the whole ZIP. Numbering stays monotonic.
        console.warn(`[composeCarousel] skipped slide ${num} (card, kind=${item.kind || "?"}):`, e?.message || e);
      }
    } else {
      try {
        const canvas = await renderPhotoSlide(item.photo_url, { category: item.category, brandTokens: bt });
        const blob = await canvasToBlob(canvas, "image/jpeg", 0.92);
        files.push({ name: `${num}_photo.jpg`, blob });
      } catch (e) {
        // Skip a photo that fails to load; keep numbering monotonic.
        console.warn(`[composeCarousel] skipped slide ${num} (photo, category=${item.category || "?"}):`, e?.message || e);
      }
    }
  }
  return files;
}

function slugify(s) {
  return String(s || "carousel").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "carousel";
}

// ── Download the composed sequence as a ZIP (reuses the Bookings pattern) ──
export async function downloadCarouselZip({ slides, stats, footer, brandTokens, address, platform = "instagram" } = {}) {
  const JSZip = typeof window !== "undefined" ? window.JSZip : null;
  if (!JSZip) throw new Error("ZIP library not loaded. Please refresh and try again.");
  const files = await composeCarousel({ slides, stats, footer, brandTokens, platform });
  if (!files.length) throw new Error("Nothing to download — no slides composed.");
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.blob);
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slugify(address)}_carousel.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return files.length;
}

export { HUMAN_SUBJECT };
