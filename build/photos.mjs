/*
 * photos.mjs — choose which image attachments become a submission's gallery.
 *
 * The challenge rule is "starter-post images only". But ~17 threads have a
 * text-only starter post and the author posted their photos in follow-up
 * messages/replies — which left those submission cards blank. So when the
 * starter carries no image, we fall back to images the SAME author attached
 * later in the thread. We never borrow another member's photos, so a card's
 * picture is always genuinely the submitter's.
 *
 * Pure + dependency-free (slug is injected) so it can be unit-tested without
 * running the whole builder.
 */

const isImage = (a) => (a?.content_type || "").startsWith("image/");

/**
 * @param {{attachments?: Array}} starter      the thread's starter post
 * @param {{author_posts?: Array, comments?: Array}} thread  the full thread
 * @param {string} submittedBy                 the submitter's contributor key (a slug)
 * @param {(s: string) => string} slugFn       slugifier matching submittedBy's scheme
 * @returns {Array} the image attachments to use, in order (starter, else author's own)
 */
export function selectImageAttachments(starter, thread, submittedBy, slugFn) {
  const starterImgs = (starter?.attachments || []).filter(isImage);
  if (starterImgs.length) return starterImgs;

  // The owner's non-starter posts are all theirs; comments must be matched to
  // the submitter by author slug so we only ever surface the submitter's photos.
  const ownFollowups = [
    ...(thread?.author_posts || []).filter((p) => !p.is_starter),
    ...(thread?.comments || []).filter(
      (c) => slugFn(c.author?.display_name || c.author?.name || "") === submittedBy
    ),
  ].sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));

  return ownFollowups.flatMap((p) => (p.attachments || []).filter(isImage));
}
