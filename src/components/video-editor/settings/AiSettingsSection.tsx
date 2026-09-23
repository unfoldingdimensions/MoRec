import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useScopedT } from "@/contexts/I18nContext";
import { loadAppSetting, saveAppSetting } from "@/lib/appSettings";

const DEFAULT_ENDPOINT = "https://api.openai.com/v1/chat/completions";

/**
 * Settings "AI" section: BYO OpenAI-compatible endpoint for titles,
 * summaries, and chapters. The API key is sent to the main process once and
 * stored safeStorage-encrypted; the renderer only ever learns whether a key
 * exists — there is no read-back and no plaintext display.
 */
export function AiSettingsSection() {
	const t = useScopedT("settings");
	const [endpoint, setEndpoint] = useState(DEFAULT_ENDPOINT);
	const [model, setModel] = useState("");
	const [hasKey, setHasKey] = useState(false);
	const [keyDraft, setKeyDraft] = useState("");
	const [keyStatus, setKeyStatus] = useState<string | null>(null);

	useEffect(() => {
		setEndpoint(loadAppSetting<string>("aiEndpoint") ?? DEFAULT_ENDPOINT);
		setModel(loadAppSetting<string>("aiModel") ?? "");
		window.electronAPI
			?.hasAiApiKey?.()
			.then((result) => {
				if (result?.success) {
					setHasKey(result.hasKey);
				}
			})
			.catch(() => undefined);
	}, []);

	const commitEndpoint = useCallback(
		(value: string) => {
			setEndpoint(value);
			saveAppSetting("aiEndpoint", value.trim());
		},
		[],
	);

	const commitModel = useCallback((value: string) => {
		setModel(value);
		saveAppSetting("aiModel", value.trim());
	}, []);

	const saveKey = useCallback(async () => {
		const trimmed = keyDraft.trim();
		if (!trimmed) {
			return;
		}
		try {
			const result = await window.electronAPI.setAiApiKey(trimmed);
			if (result?.success) {
				setHasKey(true);
				setKeyDraft("");
				// The persistent hasKey line already shows the stored state.
				setKeyStatus(null);
			} else {
				setKeyStatus(result?.error ?? t("ai.keySaveFailed", "The key could not be saved."));
			}
		} catch {
			setKeyStatus(t("ai.keySaveFailed", "The key could not be saved."));
		}
	}, [keyDraft, t]);

	const clearKey = useCallback(async () => {
		try {
			await window.electronAPI.clearAiApiKey();
		} catch {
			// best-effort
		}
		setHasKey(false);
		setKeyDraft("");
		setKeyStatus(null);
	}, []);

	return (
		<section className="flex flex-col gap-2">
			<SectionHeading label={t("ai.aiSection", "AI")} />
			<p className="text-[10px] leading-relaxed text-muted-foreground/70">
				{t(
					"ai.heuristicModeNote",
					"Titles, summaries, and chapters work without a key using built-in heuristics. Add an OpenAI-compatible endpoint for AI-generated results.",
				)}
			</p>
			<div className="rounded-lg bg-foreground/[0.03] px-2.5 py-2.5 space-y-2.5">
				<FieldRow label={t("ai.aiEndpoint", "Endpoint URL")}>
					<Input
						value={endpoint}
						onChange={(event) => setEndpoint(event.target.value)}
						onBlur={(event) => commitEndpoint(event.target.value)}
						placeholder={DEFAULT_ENDPOINT}
						className="h-8 rounded-md border border-foreground/10 bg-background/60 px-2 text-xs text-foreground"
					/>
				</FieldRow>
				<FieldRow label={t("ai.aiModel", "Model")}>
					<Input
						value={model}
						onChange={(event) => setModel(event.target.value)}
						onBlur={(event) => commitModel(event.target.value)}
						placeholder="gpt-4o-mini"
						className="h-8 rounded-md border border-foreground/10 bg-background/60 px-2 text-xs text-foreground"
					/>
				</FieldRow>
				<FieldRow label={t("ai.aiApiKey", "API key")}>
					<div className="flex items-center gap-2">
						<Input
							type="password"
							value={keyDraft}
							onChange={(event) => setKeyDraft(event.target.value)}
							placeholder={hasKey ? "••••••••" : "sk-..."}
							className="h-8 flex-1 rounded-md border border-foreground/10 bg-background/60 px-2 text-xs text-foreground"
						/>
						<Button
							type="button"
							onClick={() => void saveKey()}
							disabled={keyDraft.trim().length === 0}
							className="h-8 rounded-md bg-[#2563EB] px-2.5 text-xs font-medium text-white hover:bg-[#2563EB]/90 disabled:opacity-50"
						>
							{t("ai.saveKey", "Save key")}
						</Button>
						{hasKey ? (
							<Button
								type="button"
								variant="outline"
								onClick={() => void clearKey()}
								className="h-8 rounded-md border-foreground/10 bg-foreground/5 px-2.5 text-xs text-muted-foreground hover:bg-foreground/10"
							>
								{t("ai.clearKey", "Remove")}
							</Button>
						) : null}
					</div>
				</FieldRow>
				{hasKey ? (
					<p className="text-[10px] text-muted-foreground/70">
						{t("ai.apiKeyStored", "API key saved (encrypted on this device).")}
					</p>
				) : null}
				{keyStatus ? <p className="text-[10px] text-amber-500/80">{keyStatus}</p> : null}
			</div>
		</section>
	);
}

export function SectionHeading({ label }: { label: string }) {
	return (
		<div className="rounded-lg bg-foreground/[0.03] px-2.5 py-2">
			<span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
				{label}
			</span>
		</div>
	);
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<label className="flex flex-col gap-1">
			<span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
				{label}
			</span>
			{children}
		</label>
	);
}
