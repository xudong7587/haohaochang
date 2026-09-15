// A sustained stream of job updates must still flush; a trailing debounce can
// postpone updates forever. Playback/state messages are always immediate.
export function liveEvents(clients, snapshot, interval = 2000) {
  const pending = new Map();
  let timer;
  function send(type, data, roomId) {
    const messages = new Map();
    for (const client of clients) {
      if (roomId !== undefined && (client.roomId || "legacy") !== roomId)
        continue;
      const key = client.roomId || "legacy";
      if (!messages.has(key))
        messages.set(
          key,
          `event: ${type}\ndata: ${JSON.stringify(data ?? snapshot(client.roomId))}\n\n`,
        );
      const message = messages.get(key);
      if (client.writableLength > 256 * 1024) {
        client.destroy();
        clients.delete(client);
      } else client.write(message);
    }
  }
  return {
    emit(type = "state", data, roomId) {
      if (!["library", "tasks"].includes(type)) return send(type, data, roomId);
      pending.set(type, data ?? {});
      if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          for (const [type, data] of pending) send(type, data);
          pending.clear();
        }, interval);
        timer.unref();
      }
    },
    close() {
      clearTimeout(timer);
      pending.clear();
    },
  };
}
