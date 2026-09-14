/**
 * Best-effort macOS detection.
 *
 * navigator.platform is deprecated; prefer userAgentData where available and
 * fall back to navigator.platform (Chromium still reports it).
 */
export function isMacOS(): boolean {
	const platform =
		(navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
			?.platform ?? navigator.platform;
	return /mac/i.test(platform);
}
