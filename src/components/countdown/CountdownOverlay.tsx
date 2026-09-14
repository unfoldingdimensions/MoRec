import { useCallback, useEffect, useState } from "react";
import { useScopedT } from "../../contexts/I18nContext";

export function CountdownOverlay() {
	const t = useScopedT("launch");
	const [countdown, setCountdown] = useState<number | null>(null);

	useEffect(() => {
		void window.electronAPI.getActiveCountdown().then((result) => {
			if (result.success && typeof result.seconds === "number") {
				setCountdown(result.seconds);
			}
		});

		const cleanup = window.electronAPI.onCountdownTick((seconds: number) => {
			setCountdown(seconds);
		});

		return cleanup;
	}, []);

	const handleCancel = useCallback(() => {
		window.electronAPI.cancelCountdown();
	}, []);

	const handleKeyDown = useCallback(
		(event: KeyboardEvent) => {
			if (event.key === "Escape") {
				handleCancel();
			}
		},
		[handleCancel],
	);

	useEffect(() => {
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [handleKeyDown]);

	if (countdown === null) {
		return null;
	}

	// Cancel is bound to the badge only: the countdown window is a centered
	// 200x200 overlay, and a full-surface click-to-cancel let stray clicks near
	// the screen center silently abort the recording start.
	return (
		<div className="fixed inset-0 flex items-center justify-center select-none">
			<button
				type="button"
				onClick={handleCancel}
				aria-label={t("recording.cancel")}
				className="flex flex-col items-center justify-center rounded-3xl border-none cursor-pointer transition-opacity hover:opacity-90"
				style={{
					width: 160,
					height: 160,
					gap: 4,
					padding: 0,
					background: "rgba(0, 0, 0, 0.85)",
					backdropFilter: "blur(20px)",
				}}
			>
				<span
					role="timer"
					aria-live="assertive"
					aria-atomic="true"
					className="text-white font-bold tabular-nums"
					style={{
						fontSize: 76,
						lineHeight: 1,
						textShadow: "0 0 30px rgba(255,255,255,0.2)",
					}}
				>
					{countdown}
				</span>
				<span
					className="text-white/70 font-medium"
					style={{
						fontSize: 10,
						textShadow: "0 1px 4px rgba(0,0,0,0.8)",
					}}
				>
					{t("recording.countdownCancelHint")}
				</span>
			</button>
		</div>
	);
}
