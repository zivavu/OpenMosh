import type { Attachment } from "svelte/attachments";

const FOCUSABLE =
	"a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]";

/** Open dialogs, innermost last; only the innermost traps Tab. */
const stack: HTMLElement[] = [];

function onKeydown(e: KeyboardEvent) {
	const node = stack.at(-1);
	if (e.key !== "Tab" || !node) return;
	const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
		(el) => el.tabIndex >= 0 && el.offsetParent !== null,
	);
	if (items.length === 0) {
		e.preventDefault();
		node.focus();
		return;
	}
	const first = items[0];
	const last = items[items.length - 1];
	const active = document.activeElement;
	if (e.shiftKey && (active === first || !node.contains(active))) {
		e.preventDefault();
		last.focus();
	} else if (!e.shiftKey && (active === last || !node.contains(active))) {
		e.preventDefault();
		first.focus();
	}
}

/** Modal behaviour for a dialog element: focus moves in, Tab stays in, and focus
 * returns to where it was on close. Escape stays with each dialog. */
export function modalDialog(): Attachment<HTMLElement> {
	return (node) => {
		const returnTo = document.activeElement as HTMLElement | null;
		if (!node.hasAttribute("tabindex")) node.tabIndex = -1;
		if (stack.length === 0) document.addEventListener("keydown", onKeydown);
		stack.push(node);
		// Deferred so a child's own autofocus lands first.
		queueMicrotask(() => {
			if (!node.contains(document.activeElement))
				node.focus({ preventScroll: true });
		});

		return () => {
			stack.splice(stack.indexOf(node), 1);
			if (stack.length === 0)
				document.removeEventListener("keydown", onKeydown);
			if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
		};
	};
}
