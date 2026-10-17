import type { Attachment } from "svelte/attachments";

/** Close on a click on the backdrop itself, pressed there too: a text selection or a
 * drag that only ends outside the dialog leaves it open. */
export function backdropClose(close: () => void): Attachment<HTMLElement> {
	return (node) => {
		let pressedHere = false;
		const onDown = (e: PointerEvent) => (pressedHere = e.target === node);
		const onClick = (e: MouseEvent) => {
			if (pressedHere && e.target === node) close();
			pressedHere = false;
		};
		node.addEventListener("pointerdown", onDown);
		node.addEventListener("click", onClick);
		return () => {
			node.removeEventListener("pointerdown", onDown);
			node.removeEventListener("click", onClick);
		};
	};
}
