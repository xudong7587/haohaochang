// One complete round before repeats; new imports join the current round immediately.
export function selectAmbient(
  songs,
  history = {},
  { random = Math.random, now = Date.now() } = {},
) {
  if (!songs.length) return { song: null, history };
  const ids = new Set(songs.map((song) => song.id));
  let seen = (history.seen || []).filter((id) => ids.has(id));
  const played = new Set(seen);
  let candidates = songs.filter((song) => !played.has(song.id));
  if (!candidates.length) {
    seen = [];
    candidates = songs;
  }
  if (candidates.length > 1)
    candidates = candidates.filter((song) => song.id !== history.last);
  const weights = candidates.map((song) =>
    now - song.created < 7 * 86400000 ? 3 : 1,
  );
  let ticket = random() * weights.reduce((sum, weight) => sum + weight, 0);
  let index = 0;
  while (index < weights.length - 1 && (ticket -= weights[index]) >= 0) index++;
  const song = candidates[index];
  return { song, history: { seen: [...seen, song.id], last: song.id } };
}
