import { areDeepEqual } from "@/lib/utils";
import type { EditorProjectData } from "./projectPersistence";

export function hasUnsavedProjectChanges(
	currentProjectSnapshot: EditorProjectData | null,
	lastSavedSnapshot: EditorProjectData | null,
): boolean {
	return Boolean(
		currentProjectSnapshot &&
			(!lastSavedSnapshot || !areDeepEqual(currentProjectSnapshot, lastSavedSnapshot)),
	);
}
