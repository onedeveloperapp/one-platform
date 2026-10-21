/**
 * How well the photo of a document can be read, as the screens say it
 * (migration 0024, `case_documents.quality`). A rule of the backend measures
 * the photo where it arrives (`@flyee/documents/quality`): its size, how
 * sharp it is, how its light is spread. This file holds what a screen reads
 * of that measure and the words for it; it measures nothing, so a browser
 * may load it.
 *
 * The rule measures and a person decides: a client told their photo is hard
 * to read takes another or sends it all the same, and the firm then sees the
 * photo beside what was measured of it.
 */

/** What keeps a photo from being read, in the rule's own words. */
export const PHOTO_PROBLEMS = ["too_small", "blurry", "too_dark", "too_bright", "flat"] as const;
export type PhotoProblem = (typeof PHOTO_PROBLEMS)[number];

export const isPhotoProblem = (value: unknown): value is PhotoProblem =>
  typeof value === "string" && (PHOTO_PROBLEMS as readonly string[]).includes(value);

/** What was measured of a photo, as a screen reads it. */
export type DocumentQuality = {
  /** What keeps the photo from being read: none when it can be. */
  problems: PhotoProblem[];
  /** The client was told so and sent it all the same. */
  insisted: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * What the database keeps of a measure, as a screen reads it: null when it is
 * no measure, and when it names no limits it was read against (what nobody
 * judged is never shown as a photo with nothing against it).
 */
export function readQuality(value: unknown): DocumentQuality | null {
  if (!isRecord(value) || !Array.isArray(value.problems) || !isRecord(value.limits)) return null;
  const problems = value.problems.filter(isPhotoProblem);
  return { problems, insisted: problems.length > 0 && value.insisted === true };
}

/** What a client reads of each problem: what happened to the photo and how to take the next one (`product` namespace). */
export const CLIENT_PHOTO_PROBLEM_KEY: Record<PhotoProblem, string> = {
  too_small: "client-photo-too-small",
  blurry: "client-photo-blurry",
  too_dark: "client-photo-too-dark",
  too_bright: "client-photo-too-bright",
  flat: "client-photo-flat",
};

/** What the firm reads of each problem, in a word or two. */
export const PHOTO_PROBLEM_KEY: Record<PhotoProblem, string> = {
  too_small: "case-document-photo-too-small",
  blurry: "case-document-photo-blurry",
  too_dark: "case-document-photo-too-dark",
  too_bright: "case-document-photo-too-bright",
  flat: "case-document-photo-flat",
};

/**
 * What a link answers when the photo a client sent is hard to read, with what
 * keeps it from being read: the client takes another, or sends it all the same.
 */
export const PHOTO_POOR = "photo_poor";
