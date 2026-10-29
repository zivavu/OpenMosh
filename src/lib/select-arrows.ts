/** Chromium's `appearance: base-select` opens the list on ↑/↓ instead of stepping a
 * closed select the way a native one does, so step it here. The open list keeps the
 * browser's own keys. */

/** The next pickable option from `from` in `dir`, or `from` at either end. */
export function stepIndex(
	pickable: readonly boolean[],
	from: number,
	dir: 1 | -1,
): number {
	for (let i = from + dir; i >= 0 && i < pickable.length; i += dir) {
		if (pickable[i]) return i;
	}
	return from;
}

function isOpen(select: HTMLSelectElement): boolean {
	try {
		return select.matches(":open");
	} catch {
		return false;
	}
}

function onKeydown(e: KeyboardEvent) {
	if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
	if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.defaultPrevented)
		return;
	const select = e.target;
	if (!(select instanceof HTMLSelectElement)) return;
	if (select.multiple || select.disabled || isOpen(select)) return;

	e.preventDefault();
	const pickable = Array.from(select.options, (o) => {
		const group = o.parentElement;
		const groupDisabled =
			group instanceof HTMLOptGroupElement && group.disabled;
		return !o.disabled && !o.hidden && !groupDisabled;
	});
	const next = stepIndex(
		pickable,
		select.selectedIndex,
		e.key === "ArrowDown" ? 1 : -1,
	);
	if (next === select.selectedIndex) return;
	select.selectedIndex = next;
	select.dispatchEvent(new Event("input", { bubbles: true }));
	select.dispatchEvent(new Event("change", { bubbles: true }));
}

if (typeof CSS !== "undefined" && CSS.supports("appearance", "base-select")) {
	document.addEventListener("keydown", onKeydown, true);
}
