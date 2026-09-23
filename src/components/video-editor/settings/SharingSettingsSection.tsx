import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useScopedT } from "@/contexts/I18nContext";
import { loadAppSetting, saveAppSetting } from "@/lib/appSettings";
import { SectionHeading } from "./AiSettingsSection";

/**
 * Settings "Sharing" section: bring-your-own S3-compatible bucket. The
 * endpoint is https-only (validated here and again in the main process); the
 * secret key is safeStorage-encrypted in the main process and never returned
 * to the renderer — this UI only knows whether one is stored.
 */

function isHttpsEndpoint(value: string): boolean {
	try {
		const url = new URL(value.trim());
		return url.protocol === "https:" && Boolean(url.hostname);
	} catch {
		return false;
	}
}

export function SharingSettingsSection() {
	const t = useScopedT("settings");
	const [endpoint, setEndpoint] = useState("");
	const [region, setRegion] = useState("us-east-1");
	const [bucket, setBucket] = useState("");
	const [accessKey, setAccessKey] = useState("");
	const [publicBaseUrl, setPublicBaseUrl] = useState("");
	const [keyPrefix, setKeyPrefix] = useState("morec/");
	const [hasSecretKey, setHasSecretKey] = useState(false);
	const [secretDraft, setSecretDraft] = useState("");
	const [endpointError, setEndpointError] = useState(false);
	const [secretStatus, setSecretStatus] = useState<string | null>(null);

	useEffect(() => {
		setEndpoint(loadAppSetting<string>("sharingEndpoint") ?? "");
		setRegion(loadAppSetting<string>("sharingRegion") ?? "us-east-1");
		setBucket(loadAppSetting<string>("sharingBucket") ?? "");
		setAccessKey(loadAppSetting<string>("sharingAccessKey") ?? "");
		setPublicBaseUrl(loadAppSetting<string>("sharingPublicBaseUrl") ?? "");
		setKeyPrefix(loadAppSetting<string>("sharingKeyPrefix") ?? "morec/");
		window.electronAPI
			?.hasShareSecretKey?.()
			.then((result) => {
				if (result?.success) {
					setHasSecretKey(result.hasSecretKey);
				}
			})
			.catch(() => undefined);
	}, []);

	const commitEndpoint = useCallback(
		(value: string) => {
			const trimmed = value.trim();
			setEndpoint(trimmed);
			if (trimmed && !isHttpsEndpoint(trimmed)) {
				setEndpointError(true);
				return;
			}
			setEndpointError(false);
			saveAppSetting("sharingEndpoint", trimmed);
		},
		[],
	);

	const saveSecret = useCallback(async () => {
		const trimmed = secretDraft.trim();
		if (!trimmed) {
			return;
		}
		try {
			const result = await window.electronAPI.setShareSecretKey(trimmed);
			if (result?.success) {
				setHasSecretKey(true);
				setSecretDraft("");
				// The persistent hasSecretKey line already shows the stored state.
				setSecretStatus(null);
			} else {
				setSecretStatus(
					result?.error ?? t("sharing.keySaveFailed", "The key could not be saved."),
				);
			}
		} catch {
			setSecretStatus(t("sharing.keySaveFailed", "The key could not be saved."));
		}
	}, [secretDraft, t]);

	const clearSecret = useCallback(async () => {
		try {
			await window.electronAPI.clearShareSecretKey();
		} catch {
			// best-effort
		}
		setHasSecretKey(false);
		setSecretDraft("");
		setSecretStatus(null);
	}, []);

	const persistText = (key: string) => (value: string) => {
		saveAppSetting(key, value.trim());
	};

	return (
		<section className="flex flex-col gap-2">
			<SectionHeading label={t("sharing.sharingSection", "Sharing")} />
			<p className="text-[10px] leading-relaxed text-muted-foreground/70">
				{t(
					"sharing.endpointHint",
					"Works with any S3-compatible bucket (AWS S3, Cloudflare R2, Backblaze B2, MinIO). Endpoint examples: https://s3.amazonaws.com, https://<account-id>.r2.cloudflarestorage.com, https://s3.<region>.backblazeb2.com.",
				)}
			</p>
			<div className="rounded-lg bg-foreground/[0.03] px-2.5 py-2.5 space-y-2.5">
				<FieldRow label={t("sharing.sharingEndpoint", "Endpoint (https)")}>
					<Input
						value={endpoint}
						onChange={(event) => setEndpoint(event.target.value)}
						onBlur={(event) => commitEndpoint(event.target.value)}
						placeholder="https://s3.amazonaws.com"
						className="h-8 rounded-md border border-foreground/10 bg-background/60 px-2 text-xs text-foreground"
					/>
				</FieldRow>
				{endpointError ? (
					<p className="text-[10px] text-red-400">
						{t("sharing.invalidEndpoint", "The endpoint must be an https:// URL.")}
					</p>
				) : null}
				<div className="grid grid-cols-2 gap-2">
					<FieldRow label={t("sharing.sharingRegion", "Region")}>
						<Input
							value={region}
							onChange={(event) => setRegion(event.target.value)}
							onBlur={(event) => persistText("sharingRegion")(event.target.value)}
							placeholder="us-east-1"
							className="h-8 rounded-md border border-foreground/10 bg-background/60 px-2 text-xs text-foreground"
						/>
					</FieldRow>
					<FieldRow label={t("sharing.sharingBucket", "Bucket")}>
						<Input
							value={bucket}
							onChange={(event) => setBucket(event.target.value)}
							onBlur={(event) => persistText("sharingBucket")(event.target.value)}
							placeholder="my-bucket"
							className="h-8 rounded-md border border-foreground/10 bg-background/60 px-2 text-xs text-foreground"
						/>
					</FieldRow>
				</div>
				<FieldRow label={t("sharing.sharingAccessKey", "Access key ID")}>
					<Input
						value={accessKey}
						onChange={(event) => setAccessKey(event.target.value)}
						onBlur={(event) => persistText("sharingAccessKey")(event.target.value)}
						className="h-8 rounded-md border border-foreground/10 bg-background/60 px-2 text-xs text-foreground"
					/>
				</FieldRow>
				<FieldRow label={t("sharing.sharingSecretKey", "Secret key")}>
					<div className="flex items-center gap-2">
						<Input
							type="password"
							value={secretDraft}
							onChange={(event) => setSecretDraft(event.target.value)}
							placeholder={hasSecretKey ? "••••••••" : ""}
							className="h-8 flex-1 rounded-md border border-foreground/10 bg-background/60 px-2 text-xs text-foreground"
						/>
						<Button
							type="button"
							onClick={() => void saveSecret()}
							disabled={secretDraft.trim().length === 0}
							className="h-8 rounded-md bg-[#2563EB] px-2.5 text-xs font-medium text-white hover:bg-[#2563EB]/90 disabled:opacity-50"
						>
							{t("ai.saveKey", "Save key")}
						</Button>
						{hasSecretKey ? (
							<Button
								type="button"
								variant="outline"
								onClick={() => void clearSecret()}
								className="h-8 rounded-md border-foreground/10 bg-foreground/5 px-2.5 text-xs text-muted-foreground hover:bg-foreground/10"
							>
								{t("ai.clearKey", "Remove")}
							</Button>
						) : null}
					</div>
				</FieldRow>
				{hasSecretKey ? (
					<p className="text-[10px] text-muted-foreground/70">
						{t("sharing.secretKeyStored", "Secret key saved (encrypted on this device).")}
					</p>
				) : null}
				{secretStatus ? <p className="text-[10px] text-amber-500/80">{secretStatus}</p> : null}
				<FieldRow label={t("sharing.sharingPublicBaseUrl", "Public base URL")}>
					<Input
						value={publicBaseUrl}
						onChange={(event) => setPublicBaseUrl(event.target.value)}
						onBlur={(event) => persistText("sharingPublicBaseUrl")(event.target.value)}
						placeholder="https://cdn.example.com/recordings/"
						className="h-8 rounded-md border border-foreground/10 bg-background/60 px-2 text-xs text-foreground"
					/>
				</FieldRow>
				<FieldRow label={t("sharing.sharingKeyPrefix", "Key prefix")}>
					<Input
						value={keyPrefix}
						onChange={(event) => setKeyPrefix(event.target.value)}
						onBlur={(event) => persistText("sharingKeyPrefix")(event.target.value)}
						placeholder="morec/"
						className="h-8 rounded-md border border-foreground/10 bg-background/60 px-2 text-xs text-foreground"
					/>
				</FieldRow>
			</div>
		</section>
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
