import { WarningIcon } from "@phosphor-icons/react";
import { AudioLevelMeter } from "@/components/ui/audio-level-meter";
import { useScopedT } from "@/contexts/I18nContext";
import { useAudioLevelMeter } from "@/hooks/useAudioLevelMeter";

/**
 * Pre-flight card for the mic popover: live meter for the selected device
 * with non-blocking clipping / no-input warnings, plus an honest state chip
 * for system audio (the browser cannot meter loopback; capture is verified
 * by the post-recording companion-audio probe instead).
 */
export function MicPreflight({
	deviceId,
	systemAudioEnabled,
}: {
	deviceId?: string;
	systemAudioEnabled: boolean;
}) {
	const t = useScopedT("launch");
	const { level, clipping, noInput } = useAudioLevelMeter({ enabled: true, deviceId });

	return (
		<div className="px-3 pt-2 pb-1">
			<div className="flex items-center justify-between gap-2">
				<span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--launch-text-muted)]">
					{t("recording.preflightTitle", "Mic check")}
				</span>
				<AudioLevelMeter level={level} className="w-16 shrink-0" />
			</div>
			{clipping ? (
				<p
					className="mt-1.5 flex items-start gap-1.5 text-[11px] text-amber-400"
					role="status"
					data-testid="mic-clipping-warning"
				>
					<WarningIcon size={13} className="mt-0.5 shrink-0" />
					<span>{t("recording.micClipping", "Your mic is clipping — lower the input gain")}</span>
				</p>
			) : null}
			{noInput ? (
				<p
					className="mt-1.5 flex items-start gap-1.5 text-[11px] text-amber-400"
					role="status"
					data-testid="mic-no-input-warning"
				>
					<WarningIcon size={13} className="mt-0.5 shrink-0" />
					<span>{t("recording.noMicInput", "No input detected — check the selected device")}</span>
				</p>
			) : null}
			{systemAudioEnabled ? (
				<p
					className="mt-1.5 flex items-start gap-1.5 text-[11px] text-[var(--launch-text-muted)]"
					data-testid="system-audio-chip"
				>
					<span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
					<span>
						{t(
							"recording.systemAudioWillCapture",
							"System audio will be captured (verified after recording)",
						)}
					</span>
				</p>
			) : null}
		</div>
	);
}
