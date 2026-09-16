export const ATEMPO_FILTER_EPSILON = 0.0005;

export function buildAtempoFilters(tempoRatio: number): string[] {
	if (!Number.isFinite(tempoRatio) || tempoRatio <= 0) {
		return [];
	}

	const filters: string[] = [];
	let remaining = tempoRatio;

	while (remaining < 0.5) {
		filters.push("atempo=0.5");
		remaining /= 0.5;
	}

	while (remaining > 2) {
		filters.push("atempo=2.0");
		remaining /= 2.0;
	}

	if (Math.abs(remaining - 1) > ATEMPO_FILTER_EPSILON) {
		filters.push(`atempo=${remaining.toFixed(6)}`);
	}

	return filters;
}
