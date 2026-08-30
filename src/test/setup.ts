// Global vitest setup: registers @testing-library/jest-dom matchers
// (toBeInTheDocument, toHaveValue, ...) for all jsdom-environment tests,
// and stubs browser APIs jsdom lacks.
import "@testing-library/jest-dom/vitest";

// Some components (marquee labels, popovers) observe their own size.
class ResizeObserverStub {
	observe = () => undefined;
	unobserve = () => undefined;
	disconnect = () => undefined;
}

if (typeof globalThis.ResizeObserver === "undefined") {
	globalThis.ResizeObserver =
		ResizeObserverStub as unknown as typeof globalThis.ResizeObserver;
}
