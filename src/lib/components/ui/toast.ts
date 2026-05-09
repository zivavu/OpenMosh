import { tick } from "svelte";

export interface Toast {
	id: number;
	message: string;
	type: "error" | "info";
	duration: number;
}

let toasts = $state<Toast[]>([]);
let nextId = 0;

export function getToasts() {
	return toasts;
}

export function showToast(
	message: string,
	type: "error" | "info" = "info",
	duration = 4000,
) {
	const id = nextId++;
	toasts = [...toasts, { id, message, type, duration }];
	if (duration > 0) {
		setTimeout(() => dismissToast(id), duration);
	}
}

export function dismissToast(id: number) {
	toasts = toasts.filter((t) => t.id !== id);
}
