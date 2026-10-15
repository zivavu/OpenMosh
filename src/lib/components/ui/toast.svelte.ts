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

/** When each timed toast is due to go, so a hold can resume with what was left. */
const deadlines = new Map<number, number>();
/** Toasts under the pointer or holding focus: how many holds, and the time left
 * (null for one that stays until dismissed). */
const holds = new Map<number, { count: number; left: number | null }>();
/** A toast let go with almost no time left still stays long enough to read again. */
const MIN_AFTER_HOLD_MS = 1500;

function dismissAfter(id: number, duration: number) {
	clearTimeout(timers.get(id));
	timers.delete(id);
	deadlines.delete(id);
	// Changed while held (progress into done): it waits for the hold to end.
	const hold = holds.get(id);
	if (hold) {
		hold.left = duration > 0 ? duration : null;
		return;
	}
	if (duration <= 0) return;
	deadlines.set(id, Date.now() + duration);
	timers.set(
		id,
		setTimeout(() => dismissToast(id), duration),
	);
}

/** Keep a toast up while the pointer or focus is on it, so its action can be reached. */
export function holdToast(id: number) {
	const hold = holds.get(id);
	if (hold) {
		hold.count++;
		return;
	}
	if (!toasts.some((t) => t.id === id)) return;
	const deadline = deadlines.get(id);
	clearTimeout(timers.get(id));
	timers.delete(id);
	deadlines.delete(id);
	holds.set(id, {
		count: 1,
		left: deadline === undefined ? null : deadline - Date.now(),
	});
}

/** End a hold; the last one lets the toast's remaining time run again. */
export function releaseToast(id: number) {
	const hold = holds.get(id);
	if (!hold || --hold.count > 0) return;
	holds.delete(id);
	if (hold.left !== null) {
		dismissAfter(id, Math.max(hold.left, MIN_AFTER_HOLD_MS));
	}
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
	deadlines.delete(id);
	holds.delete(id);
	toasts = toasts.filter((t) => t.id !== id);
}
