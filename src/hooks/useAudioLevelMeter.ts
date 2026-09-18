import { useEffect, useRef, useState } from "react";

export interface AudioLevelMeterOptions {
	enabled: boolean;
	deviceId?: string;
	smoothingFactor?: number;
	/**
	 * Pre-flight detection: level (0-100) that counts as clipping when
	 * sustained. Defaults to 97.
	 */
	clippingLevel?: number;
	/** Continuous time above the clipping level before clipping is reported (ms). Defaults to 500. */
	clippingHoldMs?: number;
	/** Level (0-100) at or below which the input counts as silent. Defaults to 2. */
	silenceLevel?: number;
	/**
	 * Continuous silence (from monitor start, broken by any louder sample)
	 * before "no input" is reported (ms). Defaults to 4000.
	 */
	silenceWindowMs?: number;
	/** Injectable clock for tests. */
	now?: () => number;
}

const DEFAULT_CLIPPING_LEVEL = 97;
const DEFAULT_CLIPPING_HOLD_MS = 500;
const DEFAULT_SILENCE_LEVEL = 2;
const DEFAULT_SILENCE_WINDOW_MS = 4000;

export function useAudioLevelMeter(options: AudioLevelMeterOptions) {
	const [level, setLevel] = useState(0);
	const [clipping, setClipping] = useState(false);
	const [noInput, setNoInput] = useState(false);
	const audioContextRef = useRef<AudioContext | null>(null);
	const analyserRef = useRef<AnalyserNode | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const animationFrameRef = useRef<number | null>(null);

	// Pre-flight detection state, keyed to the current monitoring session.
	const clippingStartedAtRef = useRef<number | null>(null);
	const lastLoudAtRef = useRef<number | null>(null);
	const monitorStartedAtRef = useRef<number | null>(null);

	// Pre-flight thresholds are read through a ref so callers can pass inline
	// values without restarting the capture graph on every render.
	const preflightConfigRef = useRef({
		getNow: options.now ?? (() => performance.now()),
		clippingLevel: options.clippingLevel ?? DEFAULT_CLIPPING_LEVEL,
		clippingHoldMs: options.clippingHoldMs ?? DEFAULT_CLIPPING_HOLD_MS,
		silenceLevel: options.silenceLevel ?? DEFAULT_SILENCE_LEVEL,
		silenceWindowMs: options.silenceWindowMs ?? DEFAULT_SILENCE_WINDOW_MS,
	});
	preflightConfigRef.current = {
		getNow: options.now ?? (() => performance.now()),
		clippingLevel: options.clippingLevel ?? DEFAULT_CLIPPING_LEVEL,
		clippingHoldMs: options.clippingHoldMs ?? DEFAULT_CLIPPING_HOLD_MS,
		silenceLevel: options.silenceLevel ?? DEFAULT_SILENCE_LEVEL,
		silenceWindowMs: options.silenceWindowMs ?? DEFAULT_SILENCE_WINDOW_MS,
	};

	useEffect(() => {
		const resetPreflight = () => {
			clippingStartedAtRef.current = null;
			lastLoudAtRef.current = null;
			monitorStartedAtRef.current = null;
			setClipping(false);
			setNoInput(false);
		};

		const cleanup = () => {
			if (animationFrameRef.current) {
				cancelAnimationFrame(animationFrameRef.current);
				animationFrameRef.current = null;
			}
			if (streamRef.current) {
				streamRef.current.getTracks().forEach((track) => track.stop());
				streamRef.current = null;
			}
			if (audioContextRef.current) {
				audioContextRef.current.close().catch(() => undefined);
				audioContextRef.current = null;
			}
			analyserRef.current = null;
			resetPreflight();
		};

		if (!options.enabled) {
			cleanup();
			setLevel(0);
			return cleanup;
		}

		let mounted = true;
		// Overlapping restarts (rapid devicechange bursts): only the latest
		// monitoring session may adopt its freshly acquired stream.
		let session = 0;

		const startMonitoring = async () => {
			const currentSession = ++session;
			try {
				const constraints: MediaStreamConstraints = {
					audio: options.deviceId ? { deviceId: { exact: options.deviceId } } : true,
					video: false,
				};

				const stream = await navigator.mediaDevices.getUserMedia(constraints);
				if (!mounted || currentSession !== session) {
					stream.getTracks().forEach((track) => track.stop());
					return;
				}

				streamRef.current = stream;

				const audioContext = new AudioContext();
				if (audioContext.state === "suspended") {
					await audioContext.resume();
				}
				audioContextRef.current = audioContext;

				const analyser = audioContext.createAnalyser();
				analyser.fftSize = 256;
				analyser.smoothingTimeConstant = options.smoothingFactor ?? 0.8;
				analyserRef.current = analyser;

				const source = audioContext.createMediaStreamSource(stream);
				source.connect(analyser);

				const dataArray = new Uint8Array(analyser.frequencyBinCount);

				const updateLevel = () => {
					if (!mounted || !analyserRef.current) return;

					analyser.getByteFrequencyData(dataArray);

					let sum = 0;
					for (let index = 0; index < dataArray.length; index++) {
						sum += dataArray[index] * dataArray[index];
					}

					const rms = Math.sqrt(sum / dataArray.length);
					const normalizedLevel = Math.min(100, (rms / 255) * 100 * 2);
					setLevel(normalizedLevel);

					// Pre-flight detection runs on the same frame ticks as the meter.
					const preflight = preflightConfigRef.current;
					const now = preflight.getNow();
					if (monitorStartedAtRef.current === null) {
						monitorStartedAtRef.current = now;
						lastLoudAtRef.current = now;
					}
					if (normalizedLevel > preflight.silenceLevel) {
						lastLoudAtRef.current = now;
						setNoInput(false);
					} else if (
						lastLoudAtRef.current !== null &&
						now - lastLoudAtRef.current >= preflight.silenceWindowMs
					) {
						setNoInput(true);
					}
					if (normalizedLevel >= preflight.clippingLevel) {
						if (clippingStartedAtRef.current === null) {
							clippingStartedAtRef.current = now;
						} else if (now - clippingStartedAtRef.current >= preflight.clippingHoldMs) {
							setClipping(true);
						}
					} else {
						clippingStartedAtRef.current = null;
						setClipping(false);
					}

					animationFrameRef.current = requestAnimationFrame(updateLevel);
				};

				updateLevel();
			} catch (error) {
				console.error("Error starting audio level monitoring:", error);
				if (mounted) {
					setLevel(0);
				}
			}
		};

		void startMonitoring();

		const handleDeviceChange = () => {
			if (!mounted || !options.enabled) {
				return;
			}
			// Hot-unplug leaves the current capture graph dead with the meter
			// stuck at 0; tear it down and open a fresh one.
			cleanup();
			void startMonitoring();
		};

		navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);

		return () => {
			mounted = false;
			cleanup();
			navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
		};
	}, [options.deviceId, options.enabled, options.smoothingFactor]);

	return { level, clipping, noInput };
}
