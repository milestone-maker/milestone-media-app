// Assumes hashtags appear only as a trailing block of the caption. All 7
// queued Instagram listing frameworks follow this convention. Future
// frameworks that embed hashtags inline (e.g., thread-style or
// carousel-style) will need to either preserve their own hashtags via a
// prompt-module-level opt-out flag, or use a different canonicalizer.
// Address when actually needed.

/**
 * Replace the trailing hashtag block in a model-generated caption with
 * the canonical values from the structured `hashtags[]` array, so the
 * two fields can never disagree on casing, order, or content.
 *
 * Input shape contract:
 *   parsed: object with at least { caption?: string, hashtags?: string[] }
 *   Other fields are passed through untouched.
 *
 * Behavior table:
 *   ┌────────────────────────────────────────────────┬──────────────────────────────────────────┐
 *   │ Condition                                      │ Result                                   │
 *   ├────────────────────────────────────────────────┼──────────────────────────────────────────┤
 *   │ hashtags missing / not array / empty           │ return parsed unchanged (same reference) │
 *   │ caption missing / not a string                 │ return parsed unchanged (same reference) │
 *   │ caption's last non-empty paragraph is pure     │ replace that paragraph with              │
 *   │   #-tokens (one or more, ws-separated, may     │   hashtags.join(" "); keep the blank-    │
 *   │   span multiple lines)                         │   line separator before it               │
 *   │ caption has no trailing pure-hashtag paragraph │ append "\n\n" + hashtags.join(" ")       │
 *   │ everything above the trailing block            │ preserved byte-for-byte                  │
 *   └────────────────────────────────────────────────┴──────────────────────────────────────────┘
 *
 * Never mutates the input. Returns a shallow-copied object when caption
 * changes, or the original reference when nothing changes.
 *
 * The compliance line "… | TREC License #0123456" contains a `#` but is
 * mixed with words/spaces, so it does NOT match the pure-hashtag regex
 * and is preserved.
 *
 * Tokens missing the leading `#` in the hashtags array are emitted as-is
 * — sanitizing the array is the model's responsibility, not this
 * function's, so a bad model emit surfaces visibly instead of silently.
 *
 * KNOWN LIMITATION:
 * If the model emits the hashtag block without a blank-line separator
 * from preceding content (e.g., the hashtags appear on the line
 * immediately after the compliance line with only a single `\n`), the
 * trailing-block detection splits on blank lines and would see the
 * compliance line + hashtags as one paragraph. That paragraph is not
 * pure #-tokens, so detection falls through to append mode and the
 * canonical hashtags get appended a second time — producing duplicates.
 * This is a direct consequence of the trailing-only assumption; the
 * prompt template requests a blank line before hashtags, and all
 * observed model outputs honor it. If duplicate-hashtag output starts
 * appearing in production logs, the fix is either (a) tighten the
 * prompt instruction, or (b) replace the blank-line split with a
 * smarter trailing-#-token scan.
 *
 * @param {object} parsed Model output, expected to contain caption + hashtags
 * @returns {object} Same shape, with caption canonicalized (or original if no-op)
 */
export function canonicalizeHashtags(parsed) {
  if (!parsed || typeof parsed !== "object") return parsed;
  const { caption, hashtags } = parsed;

  if (!Array.isArray(hashtags) || hashtags.length === 0) return parsed;
  if (typeof caption !== "string")                       return parsed;

  const canonicalBlock = hashtags.join(" ");

  // Split into paragraphs on blank lines (tolerant of trailing spaces).
  const paragraphs = caption.split(/\n\s*\n/);

  // Walk backward to find the last non-empty paragraph.
  let lastIdx = -1;
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    if (paragraphs[i].trim() !== "") { lastIdx = i; break; }
  }

  // Caption is empty / whitespace-only — append canonical block.
  if (lastIdx === -1) {
    return { ...parsed, caption: canonicalBlock };
  }

  // Pure-hashtag paragraph: one-or-more whitespace-separated #-tokens,
  // possibly across multiple lines, nothing else. Anchors prevent the
  // compliance line ("… TREC License #0123456") from matching, since
  // it has words between the `#` and the line boundary.
  const PURE_HASHTAG_PARAGRAPH = /^(?:\s*#\S+\s*)+$/;

  if (PURE_HASHTAG_PARAGRAPH.test(paragraphs[lastIdx])) {
    // Replace the trailing block. Preserve everything above exactly,
    // including any trailing paragraphs that were empty (rare; the
    // join below reconstructs the same separator the split used).
    paragraphs[lastIdx] = canonicalBlock;
    return { ...parsed, caption: paragraphs.join("\n\n") };
  }

  // No trailing hashtag paragraph — append canonical block after a
  // blank line. We rebuild from the original caption (not the split
  // array) so we don't accidentally collapse any non-blank-line
  // whitespace runs the split was tolerant of.
  return { ...parsed, caption: caption.replace(/\s+$/, "") + "\n\n" + canonicalBlock };
}
