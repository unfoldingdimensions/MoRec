import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Represents a Windows monitor handle and its physical desktop coordinates.
 */
export interface WinMonitorHandle {
	handle: number;
	x: number;
	y: number;
	width: number;
	height: number;
}

// PowerShell snippet that uses P/Invoke to call EnumDisplayMonitors and return raw handles + bounds.
// The process claims per-monitor-v2 DPI awareness before enumerating, so the
// rects are PHYSICAL pixels; Electron display bounds are DIPs and must be
// scaled by the display's scaleFactor before comparing (see
// findMonitorHandleForElectronDisplay). Add-Type compiles C# on every
// invocation, so results are cached with a TTL and production callers use the
// async variant to keep the main event loop responsive.
const MONITOR_ENUM_SCRIPT = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;

public class MonitorHelper {
    [DllImport("user32.dll")]
    public static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);

    [DllImport("user32.dll")]
    public static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr lprcClip, MonitorEnumProc lpfnEnum, IntPtr dwData);

    public delegate bool MonitorEnumProc(IntPtr hMonitor, IntPtr hdcMonitor, ref Rect lprcMonitor, IntPtr dwData);

    [StructLayout(LayoutKind.Sequential)]
    public struct Rect {
        public int left;
        public int top;
        public int right;
        public int bottom;
    }

    public static List<string> GetMonitors() {
        List<string> result = new List<string>();
        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (IntPtr hMonitor, IntPtr hdcMonitor, ref Rect lprcMonitor, IntPtr dwData) => {
            result.Add(string.Format("{0}|{1}|{2}|{3}|{4}", hMonitor.ToInt64(), lprcMonitor.left, lprcMonitor.top, lprcMonitor.right - lprcMonitor.left, lprcMonitor.bottom - lprcMonitor.top));
            return true;
        }, IntPtr.Zero);
        return result;
    }
}
"@
try {
    # DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2; best effort — if the OS
    # refuses, rects degrade to virtualized (scaled) coordinates as before.
    [MonitorHelper]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null
} catch {
}
[MonitorHelper]::GetMonitors()
`.trim();

const MONITOR_CACHE_TTL_MS = 10_000;
// Failures are cached only briefly: a full TTL on an empty result would make
// a transient PowerShell hiccup skip handle resolution (and its monitor
// matching) for record starts within the window. Hot-plugged monitors also
// refresh 10x sooner this way.
const MONITOR_FAILURE_CACHE_TTL_MS = 1_000;
let monitorHandleCache: {
	at: number;
	handles: WinMonitorHandle[];
	failed: boolean;
} | null = null;

function parseMonitorHandleLines(stdout: string): WinMonitorHandle[] {
	return stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => {
			const [handle, x, y, width, height] = line.split("|").map(Number);
			return { handle, x, y, width, height };
		});
}

/**
 * Async variant used on the record-start hot path. Enumerates raw HMONITOR
 * handles via PowerShell without blocking the main-process event loop
 * (spawnSync froze every window, IPC handler, and the tray for 1-5s), and
 * caches results so rapid retries don't recompile the Add-Type bridge.
 */
export async function getMonitorHandlesAsync(): Promise<WinMonitorHandle[]> {
	if (process.platform !== "win32") return [];

	if (monitorHandleCache) {
		const ttl = monitorHandleCache.failed
			? MONITOR_FAILURE_CACHE_TTL_MS
			: MONITOR_CACHE_TTL_MS;
		if (Date.now() - monitorHandleCache.at < ttl) {
			return monitorHandleCache.handles;
		}
	}

	try {
		const { stdout } = await execFileAsync(
			"powershell.exe",
			["-NoProfile", "-NonInteractive", "-Command", MONITOR_ENUM_SCRIPT],
			{
				encoding: "utf-8",
				timeout: 8000,
				windowsHide: true,
			},
		);
		monitorHandleCache = {
			at: Date.now(),
			handles: parseMonitorHandleLines(stdout),
			failed: false,
		};
	} catch {
		// Silent failure is preferred; the caller will fall back to
		// coordinate-based matching. Cache the empty result briefly so
		// immediate retries don't hammer PowerShell again.
		monitorHandleCache = {
			at: Date.now(),
			handles: [],
			failed: true,
		};
	}

	return monitorHandleCache.handles;
}

/**
 * Retrieves raw HMONITOR handles from the Windows OS using a PowerShell bridge.
 * This is necessary because Electron's display IDs are often internal hashes that
 * cannot be used directly with native Windows APIs like Graphics Capture (WGC).
 *
 * Synchronous helper kept for tests and one-off diagnostics; the record-start
 * path must use getMonitorHandlesAsync() to avoid freezing the main process.
 */
export function getMonitorHandles(): WinMonitorHandle[] {
	if (process.platform !== "win32") return [];

	const result = spawnSync(
		"powershell.exe",
		["-NoProfile", "-NonInteractive", "-Command", MONITOR_ENUM_SCRIPT],
		{
			encoding: "utf-8",
			timeout: 5000,
		},
	);

	if (result.error || result.status !== 0) {
		// Silent failure is preferred; the caller will fall back to coordinate-based matching.
		return [];
	}

	return parseMonitorHandleLines(result.stdout);
}

/**
 * Matches an Electron display (DIP bounds + scale factor) to a physical-pixel
 * monitor rect from the PowerShell probe, returning its HMONITOR handle.
 *
 * Physical rect = DIP bounds × display scaleFactor; a small tolerance absorbs
 * per-driver rounding. Falls back to an origin-only match before giving up so
 * the caller can decide between "trusted handle" and "coordinate fallback".
 */
export function findMonitorHandleForElectronDisplay(
	display: {
		bounds: { x: number; y: number; width: number; height: number };
		scaleFactor?: number;
	},
	monitors: WinMonitorHandle[],
	tolerancePx = 2,
): WinMonitorHandle | null {
	const sf = display.scaleFactor || 1;
	const expected = {
		x: Math.round(display.bounds.x * sf),
		y: Math.round(display.bounds.y * sf),
		width: Math.round(display.bounds.width * sf),
		height: Math.round(display.bounds.height * sf),
	};

	const near = (actual: number, expectedValue: number) =>
		Math.abs(actual - expectedValue) <= tolerancePx;

	for (const monitor of monitors) {
		if (
			near(monitor.x, expected.x) &&
			near(monitor.y, expected.y) &&
			near(monitor.width, expected.width) &&
			near(monitor.height, expected.height)
		) {
			return monitor;
		}
	}

	for (const monitor of monitors) {
		if (near(monitor.x, expected.x) && near(monitor.y, expected.y)) {
			return monitor;
		}
	}

	return null;
}
