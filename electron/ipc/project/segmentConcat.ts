import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";

const execFileAsync = promisify(execFile);

/**
 * Concatenation of multi-clip recording segments (P1 Feature 6 v2 finalize).
 *
 * Segments come from the same capture helper at identical codec/framerate, so
 * the ffmpeg concat demuxer with stream copy re-packages without re-encoding.
 * The output is staged next to the primary recording and moved over it only
 * after a successful, non-empty encode; every source segment (kept and
 * discarded) plus its per-segment session manifest is then deleted, so the
 * flubbed footage is truly gone from disk and the editor stays single-source.
 */

export type ConcatSegmentsResult =
	| {
			success: true;
			outputPath: string;
			keptCount: number;
			droppedCount: number;
	  }
	| { success: false; error: string };

const CONCAT_TIMEOUT_MS = 10 * 60 * 1000;

/** ffmpeg concat-demuxer list escaping: quote for the demuxer's own syntax. */
export function buildConcatListEntry(filePath: string): string {
	return `file '${filePath.replace(/'/g, "'\\''")}'`;
}

export async function concatRecordingSegments(options: {
	outputPath: string;
	keep: string[];
	discard: string[];
}): Promise<ConcatSegmentsResult> {
	const outputPath = path.resolve(options.outputPath ?? "");
	const keep = (options.keep ?? []).map((entry) => path.resolve(entry));
	const discard = (options.discard ?? []).map((entry) => path.resolve(entry));

	if (keep.length === 0) {
		return { success: false, error: "No segments were selected to keep." };
	}
	if (!keep.includes(outputPath)) {
		// The output must be one of the kept segments: concat replaces the
		// primary recording in place.
		return {
			success: false,
			error: "The output path must be one of the kept segments.",
		};
	}

	const outputExt = path.extname(outputPath) || ".mp4";
	const stagedPath = `${outputPath.slice(
		0,
		outputPath.length - outputExt.length,
	)}.concat-${Date.now()}${outputExt}`;
	const listPath = `${stagedPath}.list.txt`;
	const listContent = `${keep.map((entry) => buildConcatListEntry(entry)).join("\n")}\n`;

	try {
		await fs.writeFile(listPath, listContent, "utf-8");
		try {
			await execFileAsync(
				getFfmpegBinaryPath(),
				[
					"-y",
					"-f",
					"concat",
					"-safe",
					"0",
					"-i",
					listPath,
					"-c",
					"copy",
					"-movflags",
					"+faststart",
					stagedPath,
				],
				{ timeout: CONCAT_TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024 },
			);
		} catch (error) {
			const detail =
				error instanceof Error
					? `${error.message}${"stderr" in error ? `: ${String((error as { stderr?: unknown }).stderr).slice(-400)}` : ""}`
					: String(error);
			return { success: false, error: `Segment merge failed: ${detail}` };
		}

		const stat = await fs.stat(stagedPath).catch(() => null);
		if (!stat || stat.size <= 0) {
			return { success: false, error: "Segment merge produced an empty file." };
		}

		await fs.rm(outputPath, { force: true });
		await fs.rename(stagedPath, outputPath);
	} finally {
		await fs.rm(listPath, { force: true }).catch(() => undefined);
	}

	// Cleanup: kept sources (everything except the merged output), discarded
	// takes, and each source segment's own session manifest. Deletion is
	// best-effort per file — a failed unlink must not undo a successful merge.
	for (const segment of [...keep.filter((entry) => entry !== outputPath), ...discard]) {
		await fs.rm(segment, { force: true }).catch(() => undefined);
		const extension = path.extname(segment);
		const baseName = path.basename(segment, extension);
		const manifestPath = path.join(
			path.dirname(segment),
			`${baseName}.morec-session.json`,
		);
		await fs.rm(manifestPath, { force: true }).catch(() => undefined);
	}

	return {
		success: true,
		outputPath,
		keptCount: keep.length,
		droppedCount: discard.length,
	};
}
