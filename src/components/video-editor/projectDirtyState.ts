import { areDeepEqual, isComparableObject } from "@/lib/utils";
import type { EditorProjectData } from "./projectPersistence";

function omitTransientWebcamMediaFields(project: EditorProjectData | null) {
	if (!project?.editor || typeof project.editor !== "object") {
		return project;
	}

	const editor = project.editor as Record<string, unknown>;
	const webcam = editor.webcam;
	if (!isComparableObject(webcam)) {
		return project;
	}

	const {
		enabled: _enabled,
		sourcePath: _sourcePath,
		timeOffsetMs: _timeOffsetMs,
		...persistentWebcamFields
	} = webcam;

	return {
		...project,
		editor: {
			...editor,
			webcam: persistentWebcamFields,
		},
	};
}

export function hasUnsavedProjectChanges(
	currentProjectSnapshot: EditorProjectData | null,
	lastSavedSnapshot: EditorProjectData | null,
): boolean {
	const comparableCurrentSnapshot = omitTransientWebcamMediaFields(currentProjectSnapshot);
	const comparableLastSavedSnapshot = omitTransientWebcamMediaFields(lastSavedSnapshot);

	return Boolean(
		comparableCurrentSnapshot &&
			(!comparableLastSavedSnapshot ||
				!areDeepEqual(comparableCurrentSnapshot, comparableLastSavedSnapshot)),
	);
}
