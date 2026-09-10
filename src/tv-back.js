// Android evaluates this return value before deciding whether to exit the app.
export function handleTvBack(doc = document) {
  const dialog = doc.querySelector("dialog[open]");
  if (dialog) {
    const event = new Event("cancel", { cancelable: true });
    if (dialog.dispatchEvent(event)) dialog.close();
    return true;
  }
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  doc.dispatchEvent(event);
  return event.defaultPrevented;
}
