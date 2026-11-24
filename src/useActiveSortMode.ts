import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { isActiveSortMode, type ActiveSortMode } from "./inbox-layout";
import { activeSortCodec } from "./lib/inbox-preference-codecs";
import { readStorageRaw, writeStoredValue } from "./lib/storage-codec";
import { STORAGE_KEYS } from "./lib/storage-keys";

function readInitialSortPreference(): ActiveSortMode | null {
  const stored = readStorageRaw(STORAGE_KEYS.activeSort.key);
  if (stored && isActiveSortMode(stored)) return stored;
  // Preserve one-way migration from the legacy project-grouping toggle.
  return readStorageRaw(STORAGE_KEYS.activeGrouping.key) === "true" ? "project" : null;
}

/**
 * Effective Active sort mode. When the user has not persisted an explicit mode,
 * default to collapsible section groups whenever BB sections exist and fall
 * back to manual order otherwise.
 */
function resolveActiveSortMode(stored: ActiveSortMode | null, hasSections: boolean): ActiveSortMode {
  if (stored === "section" && !hasSections) return "manual";
  if (stored !== null) return stored;
  return hasSections ? "section" : "manual";
}

export function useActiveSortMode(hasSections: boolean): [ActiveSortMode, Dispatch<SetStateAction<ActiveSortMode>>] {
  const [stored, setStored] = useState<ActiveSortMode | null>(readInitialSortPreference);
  const mode = resolveActiveSortMode(stored, hasSections);

  useEffect(() => {
    if (stored !== null) writeStoredValue(STORAGE_KEYS.activeSort.key, activeSortCodec, stored);
  }, [stored]);

  const setMode = useCallback<Dispatch<SetStateAction<ActiveSortMode>>>(
    (next) => {
      setStored((current) => {
        const resolved = resolveActiveSortMode(current, hasSections);
        return typeof next === "function" ? next(resolved) : next;
      });
    },
    [hasSections],
  );

  return [mode, setMode];
}
