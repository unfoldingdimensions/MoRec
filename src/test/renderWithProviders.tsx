import { render, screen } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

export { render, screen };

/**
 * Renders a component wrapped in the providers most components expect
 * (I18n for `useI18n`/`useScopedT`). Extend `wrappers` when a component
 * additionally needs routing, theme, or feature contexts.
 */
export function renderWithProviders(
	ui: ReactElement,
	options: { wrappers?: Array<(children: ReactNode) => ReactElement> } = {},
) {
	const { wrappers = [] } = options;
	let tree: ReactNode = ui;
	for (const wrap of [...wrappers].reverse()) {
		tree = wrap(tree);
	}
	return render(tree);
}
