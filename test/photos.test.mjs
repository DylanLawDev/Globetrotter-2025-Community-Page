/* Unit tests for selectImageAttachments — the starter-then-own-replies photo
 * selection used by build_data.mjs. Pure module, imported directly. */
import test from "node:test";
import assert from "node:assert/strict";
import { selectImageAttachments } from "../build/photos.mjs";

// minimal slugifier matching the contributor-key scheme well enough for tests
const slug = (s = "") => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const img = (name, ct = "image/jpeg") => ({ original: name, content_type: ct });
const vid = (name) => ({ original: name, content_type: "video/mp4" });

test("uses starter-post images when present", () => {
  const starter = { is_starter: true, attachments: [img("a.jpg"), img("b.png", "image/png")] };
  const thread = { author_posts: [starter, { attachments: [img("late.jpg")] }] };
  const out = selectImageAttachments(starter, thread, "gia", slug);
  assert.deepEqual(out.map((a) => a.original), ["a.jpg", "b.png"]);
});

test("ignores non-image starter attachments but does not fall back if any image exists", () => {
  const starter = { is_starter: true, attachments: [vid("clip.mp4"), img("only.jpg")] };
  const thread = { author_posts: [starter] };
  const out = selectImageAttachments(starter, thread, "gia", slug);
  assert.deepEqual(out.map((a) => a.original), ["only.jpg"]);
});

test("falls back to the author's own follow-up posts when the starter is text-only", () => {
  const starter = { is_starter: true, attachments: [] };
  const thread = {
    author_posts: [
      starter,
      { is_starter: false, created_at: "2025-02-03T10:00:00", attachments: [img("reply1.jpg")] },
      { is_starter: false, created_at: "2025-02-03T11:00:00", attachments: [img("reply2.jpg"), vid("v.mp4")] },
    ],
    comments: [],
  };
  const out = selectImageAttachments(starter, thread, "gia", slug);
  assert.deepEqual(out.map((a) => a.original), ["reply1.jpg", "reply2.jpg"]);
});

test("falls back to the submitter's own reply comments", () => {
  const starter = { is_starter: true, attachments: [] };
  const thread = {
    author_posts: [starter],
    comments: [
      { author: { display_name: "Gia" }, created_at: "2025-02-03T12:00:00", attachments: [img("mine.jpg")] },
    ],
  };
  const out = selectImageAttachments(starter, thread, "gia", slug);
  assert.deepEqual(out.map((a) => a.original), ["mine.jpg"]);
});

test("never borrows another member's reply photos", () => {
  const starter = { is_starter: true, attachments: [] };
  const thread = {
    author_posts: [starter],
    comments: [
      { author: { display_name: "Someone Else" }, created_at: "2025-02-03T12:00:00", attachments: [img("theirs.jpg")] },
    ],
  };
  const out = selectImageAttachments(starter, thread, "gia", slug);
  assert.deepEqual(out, []); // stays blank rather than misattribute
});

test("orders fallback images chronologically across posts and own comments", () => {
  const starter = { is_starter: true, attachments: [] };
  const thread = {
    author_posts: [
      starter,
      { is_starter: false, created_at: "2025-02-03T11:00:00", attachments: [img("second.jpg")] },
    ],
    comments: [
      { author: { name: "gia" }, created_at: "2025-02-03T10:00:00", attachments: [img("first.jpg")] },
      { author: { name: "gia" }, created_at: "2025-02-03T12:00:00", attachments: [img("third.jpg")] },
    ],
  };
  const out = selectImageAttachments(starter, thread, "gia", slug);
  assert.deepEqual(out.map((a) => a.original), ["first.jpg", "second.jpg", "third.jpg"]);
});

test("returns [] when neither starter nor the author posted any image", () => {
  const starter = { is_starter: true, attachments: [vid("clip.mp4")] };
  const thread = { author_posts: [starter], comments: [] };
  assert.deepEqual(selectImageAttachments(starter, thread, "gia", slug), []);
});
