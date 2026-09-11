import { canonicalBiliRecording } from "../shared/video-refresh.js";

// Return provenance, never a CDN URL or credentials. Absence of a clipping
// record is not evidence of an untrimmed recording.
export function recordingSource(store, song) {
  const record = store.get("recording-source:" + song.id);
  const replacement = store.get("video-source:" + song.id);
  let selection;
  try {
    selection = JSON.parse(song.evidence || "[]")
      .reverse()
      .find((item) => item.kind === "user-selection" && item.url);
  } catch {}
  const url =
    record?.url ||
    replacement?.url ||
    selection?.url ||
    store.get("source:" + song.id)?.canonicalUrl ||
    store.get("download-quality:" + song.id)?.sourceUrl;
  if (!url) return null;
  try {
    const canonical = canonicalBiliRecording(url);
    const proof = record || selection;
    const sameAudio =
      proof?.url && canonicalBiliRecording(proof.url) === canonical;
    const independentPicture =
      (replacement?.keepAudio && !replacement.recordingMatched) ||
      Number(replacement?.offset || 0) !== 0 ||
      (replacement?.url &&
        canonicalBiliRecording(replacement.url) !== canonical);
    return {
      url: canonical,
      clip: proof?.clip || null,
      untrimmed:
        !!sameAudio &&
        !independentPicture &&
        Object.hasOwn(proof, "clip") &&
        proof.clip === null,
      updated: record?.updated || null,
    };
  } catch {
    return null;
  }
}
