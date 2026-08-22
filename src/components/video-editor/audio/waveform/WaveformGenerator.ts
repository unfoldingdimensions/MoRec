import { WAVEFORM_DEFAULT_PEAK_COUNT } from "../../timeline/core/constants";
import type { AudioPeaksData } from "../../timeline/core/timelineTypes";
import { getAudioResourceCacheScope, getAudioResourceVersionKey } from "../audioResourceVersion";
import { VersionedWaveformCache } from "./waveformCache";

const MAX_WAVEFORM_PEAKS = 200_000;
const MAX_WAVEFORM_CACHE_ENTRIES = 24;

export class WaveformGenerator {
	private audioContext: AudioContext;
	private peaksCache = new VersionedWaveformCache<AudioPeaksData>(MAX_WAVEFORM_CACHE_ENTRIES);
	private pending = new Map<string, Promise<AudioPeaksData>>();

	constructor() {
		this.audioContext = new (
			window.AudioContext ||
			(window as typeof window & { webkitAudioContext?: typeof AudioContext })
				.webkitAudioContext
		)();
	}

	private extractPeaks(decoded: AudioBuffer, samples: number): Float32Array {
		if (samples <= 0 || decoded.length === 0) {
			return new Float32Array(0);
		}

		const numChannels = decoded.numberOfChannels;
		const totalSamples = decoded.length;
		const blockSize = totalSamples / samples;
		const peaks = new Float32Array(samples);

		// Read channel views directly without .slice() duplication
		const channels: Float32Array[] = [];
		for (let c = 0; c < numChannels; c++) {
			channels.push(decoded.getChannelData(c));
		}

		for (let i = 0; i < samples; i++) {
			const start = Math.floor(i * blockSize);
			const end = Math.min(totalSamples, Math.floor((i + 1) * blockSize));
			const actualEnd = Math.max(start + 1, end);
			let max = 0;

			for (let j = start; j < actualEnd && j < totalSamples; j++) {
				for (let c = 0; c < numChannels; c++) {
					const val = Math.abs(channels[c][j]);
					if (val > max) max = val;
				}
			}
			peaks[i] = max;
		}

		// Robust Normalization: Use 99.5th percentile to avoid being squashed by a single loud spike/pop
		let max = 0;
		const sortedPeaks = new Float32Array(peaks).sort();
		const percentileIndex = Math.floor(sortedPeaks.length * 0.995);
		const robustMax = sortedPeaks[percentileIndex] || 0;

		// Fallback to absolute max if the percentile is zero (very quiet file)
		if (robustMax === 0) {
			for (let i = 0; i < peaks.length; i++) {
				if (peaks[i] > max) max = peaks[i];
			}
		} else {
			max = robustMax;
		}

		if (max > 0) {
			for (let i = 0; i < peaks.length; i++) {
				peaks[i] = Math.min(1.0, peaks[i] / max);
			}
		}

		return peaks;
	}

	public async generate(
		url: string,
		peakCount = WAVEFORM_DEFAULT_PEAK_COUNT,
		resourceVersion = 0,
	): Promise<AudioPeaksData> {
		const cacheScope = `${getAudioResourceCacheScope(url)}::${peakCount}`;
		const cacheKey = getAudioResourceVersionKey(cacheScope, resourceVersion);
		this.peaksCache.activate(cacheScope, cacheKey);
		const cached = this.peaksCache.get(cacheKey);
		if (cached) return cached;

		const inflight = this.pending.get(cacheKey);
		if (inflight) return inflight;

		const request = (async () => {
			const response = await fetch(url);
			if (!response.ok) {
				throw new Error(`Failed to load media: ${response.status}`);
			}

			const arrayBuffer = await response.arrayBuffer();
			const decoded = await this.audioContext.decodeAudioData(arrayBuffer);
			const adaptivePeakCount = Math.max(peakCount, Math.floor(decoded.duration * 500));
			const boundedPeakCount = Math.min(adaptivePeakCount, MAX_WAVEFORM_PEAKS);

			const peaks = this.extractPeaks(decoded, boundedPeakCount);

			const result: AudioPeaksData = {
				peaks,
				durationMs: decoded.duration * 1000,
			};
			this.peaksCache.setIfCurrent(cacheScope, cacheKey, result);
			this.pending.delete(cacheKey);
			return result;
		})().catch((error) => {
			this.pending.delete(cacheKey);
			this.peaksCache.deactivateIfCurrent(cacheScope, cacheKey);
			throw error;
		});

		this.pending.set(cacheKey, request);
		return request;
	}
}

export const waveformGenerator = new WaveformGenerator();
