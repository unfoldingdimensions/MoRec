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
// Add-Type compiles C# on every invocation, so results are cached with a TTL and
// production callers use the async variant to keep the main event loop responsive.
const MONITOR_ENUM_SCRIPT = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;

public class MonitorHelper {
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
[MonitorHelper]::GetMonitors()
`.trim();

const MONITOR_CACHE_TTL_MS = 10_000;
let monitorHandleCache: { at: number; handles: WinMonitorHandle[] } | null = null;

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

	if (monitorHandleCache && Date.now() - monitorHandleCache.at < MONITOR_CACHE_TTL_MS) {
		return monitorHandleCache.handles;
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
		monitorHandleCache = { at: Date.now(), handles: parseMonitorHandleLines(stdout) };
	} catch {
		// Silent failure is preferred; the caller will fall back to
		// coordinate-based matching. Cache the empty result briefly so
		// immediate retries don't hammer PowerShell again.
		monitorHandleCache = { at: Date.now(), handles: [] };
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
