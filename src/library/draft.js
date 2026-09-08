export const draftValues = (row) => ({
  title: row.title || "",
  artist: row.artist || "",
  lyrics: row.lyrics || "",
  url: row.sourceUrl || "",
  lyricsSource: row.lyricsSource || null,
});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function createDraft(row) {
  const values = draftValues(row),
    revision = Number(row.metadataRevision ?? row.expectedRevision ?? 0);
  return {
    values,
    base: values,
    revision,
    latest: { values, revision },
    dirty: false,
    conflict: false,
  };
}
export function draftReducer(state, event) {
  switch (event.type) {
    case "edit": {
      const values = { ...state.values, ...event.patch };
      return { ...state, values, dirty: !same(values, state.base) };
    }
    case "refresh": {
      const next = createDraft(event.row);
      if (next.revision < state.revision) return state;
      if (
        next.revision === state.latest.revision &&
        same(next.values, state.latest.values)
      )
        return state;
      if (!state.dirty && !state.conflict) return next;
      return { ...state, latest: next.latest, conflict: true };
    }
    case "conflict":
      return { ...state, conflict: true };
    case "adopt":
      return {
        ...state,
        values: state.latest.values,
        base: state.latest.values,
        revision: state.latest.revision,
        dirty: false,
        conflict: false,
      };
    case "rebase":
      return {
        ...state,
        base: state.latest.values,
        revision: state.latest.revision,
        dirty: !same(state.values, state.latest.values),
        conflict: false,
      };
    case "saved": {
      const revision = Number(event.revision ?? state.revision + 1),
        values = event.values;
      return {
        ...state,
        base: values,
        revision,
        latest: { values, revision },
        dirty: !same(state.values, values),
        conflict: false,
      };
    }
    default:
      return state;
  }
}
export const isRevisionConflict = (error) =>
  error?.code === "REVISION_CONFLICT";
