/** Optional inline button, e.g. "Undo" on a destructive action. Running it
 * dismisses the toast. */
export interface ToastAction {
	label: string;
	run: () => void;
}

export type ToastType = "error" | "info" | "success";

export interface Toast {
	id: number;
	message: string;
	type: ToastType;
	duration: number;
	action?: ToastAction;
}

let toasts = $state<Toast[]>([]);
let nextId = 0;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function dismissAfter(id: number, duration: number) {
	clearTimeout(timers.get(id));
	timers.delete(id);
	if (duration <= 0) return;
	timers.set(
		id,
		setTimeout(() => dismissToast(id), duration),
	);
}

export function getToasts() {
	return toasts;
}

export function showToast(
	message: string,
	type: ToastType = "info",
	duration = 4000,
	action?: ToastAction,
) {
	const id = nextId++;
	toasts = [...toasts, { id, message, type, duration, action }];
	dismissAfter(id, duration);
	return id;
}

/** Turn a toast into another where it stands, e.g. progress into done. Shown fresh
 * if it was dismissed meanwhile. */
export function updateToast(
	id: number,
	message: string,
	type: ToastType = "info",
	duration = 4000,
) {
	if (!toasts.some((t) => t.id === id))
		return showToast(message, type, duration);
	toasts = toasts.map((t) =>
		t.id === id ? { ...t, message, type, duration, action: undefined } : t,
	);
	dismissAfter(id, duration);
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
	clearTimeout(timers.get(id));
	timers.delete(id);
	toasts = toasts.filter((t) => t.id !== id);
}
