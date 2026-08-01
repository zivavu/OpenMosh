/** Optional inline button, e.g. "Undo" on a destructive action. Running it
 * dismisses the toast. */
export interface ToastAction {
	label: string;
	run: () => void;
}

export interface Toast {
	id: number;
	message: string;
	type: "error" | "info";
	duration: number;
	action?: ToastAction;
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
	action?: ToastAction,
) {
	const id = nextId++;
	toasts = [...toasts, { id, message, type, duration, action }];
	if (duration > 0) {
		setTimeout(() => dismissToast(id), duration);
	}
	return id;
}

/** Run a toast's action and dismiss it. */
export function runToastAction(id: number) {
	const toast = toasts.find((t) => t.id === id);
	if (!toast?.action) return;
	dismissToast(id);
	toast.action.run();
}

export function dismissToast(id: number) {
	toasts = toasts.filter((t) => t.id !== id);
}
