// Only the opaque application session id is persisted. The authoritative
// session collection validates it without assuming an id format.
export interface LastSessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const storageKey = "noisedeck.last-session-id";

export function readLastSession(storage: LastSessionStorage): string | null {
  try {
    return storage.getItem(storageKey) ?? null;
  } catch {
    return null;
  }
}

export function writeLastSession(storage: LastSessionStorage, id: string): void {
  try {
    storage.setItem(storageKey, id);
  } catch {
    // Storage denial loses last-session reopen, not current selection.
  }
}

export function clearLastSession(storage: LastSessionStorage): void {
  try {
    storage.removeItem(storageKey);
  } catch {
    // Storage denial leaves a stale id that membership checks already guard.
  }
}

export function pickInitialSession(
  storedID: string | null,
  sessions: readonly { id: string; presentation_state: string }[],
): string | null {
  if (storedID !== null && sessions.some((s) =>
    s.id === storedID && s.presentation_state === "running")) {
    return storedID;
  }
  return sessions.find((s) => s.presentation_state === "running")?.id ?? null;
}
