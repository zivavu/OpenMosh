import { getFeedbackChain } from "../components/ui/feedback.svelte";

/** Web3Forms endpoint — a static-site form relay that emails submissions on.
 * The access key is public by design: it only allows posting to this one form,
 * and the bundle ships to the browser anyway. */
const ACCESS_KEY = "0cb8b3a2-3288-492e-b71f-65b36a0977dd";
const ENDPOINT = "https://api.web3forms.com/submit";

export type FeedbackKind = "bug" | "idea" | "other";

export interface FeedbackPayload {
	kind: FeedbackKind;
	message: string;
	/** Optional — only so a reply is possible. */
	email: string;
	/** Honeypot: bots fill every field they find, people never see this one. */
	botcheck: string;
}

const KIND_LABELS: Record<FeedbackKind, string> = {
	bug: "Bug",
	idea: "Idea",
	other: "Feedback",
};

/** The chain as it stood, stripped to what reproduces it: no instance ids, no
 * UI state, and only the effects that were actually on. Text rather than a
 * screenshot — this can be pasted back in, a picture can only be squinted at. */
function describeChain(): string {
	const effects = getFeedbackChain();
	if (!effects) return "Chain: none (upload screen)";
	const on = effects.filter((e) => e.enabled);
	if (on.length === 0) return "Chain: no effects enabled";
	const chain = on.map((e) => ({
		defId: e.defId,
		values: { ...e.values },
		...(e.volumeLinks &&
			Object.keys(e.volumeLinks).length > 0 && {
				volumeLinks: { ...e.volumeLinks },
			}),
	}));
	return `Chain (${on.length} enabled):
${JSON.stringify(chain)}`;
}

/** Where the reporter was and what they were running — the context that
 * otherwise takes three round trips to get out of a bug report. */
function collectContext(): string {
	const view = window.location.hash || "#";
	return [
		`View: ${view}`,
		`Screen: ${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio}x`,
		`UA: ${navigator.userAgent}`,
	].join("\n");
}

/** Posts to Web3Forms. Resolves on success, throws with a readable reason. */
export async function submitFeedback(payload: FeedbackPayload): Promise<void> {
	if (payload.botcheck) return; // silently drop bots

	const body = {
		access_key: ACCESS_KEY,
		subject: `OpenMosh — ${KIND_LABELS[payload.kind]}`,
		from_name: "OpenMosh",
		kind: KIND_LABELS[payload.kind],
		email: payload.email || undefined,
		message: `${payload.message}\n\n---\n${collectContext()}`,
	};

	let res: Response;
	try {
		res = await fetch(ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/json", Accept: "application/json" },
			body: JSON.stringify(body),
		});
	} catch {
		throw new Error("Couldn't reach the server — check your connection.");
	}

	const data = (await res.json().catch(() => null)) as
		| { success?: boolean; message?: string }
		| null;
	if (!res.ok || !data?.success) {
		throw new Error(data?.message || "Something went wrong sending that.");
	}
}
