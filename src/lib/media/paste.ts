import { isTextEntryTarget } from "../editor/shortcut-target";
import { isModalKeyboardOpen } from "../modal-keyboard";

/** Browsers name every pasted screenshot "image.png", so each would land in the
 * pool under the same name. */
const GENERIC_NAME = /^image\.\w+$/i;

function pasteName(file: File, now: number): string {
	if (file.name && !GENERIC_NAME.test(file.name)) return file.name;
	const ext = file.type.split("/")[1]?.split("+")[0] || "png";
	return `pasted-${now}.${ext}`;
}

/** The files a paste carries, screenshots given a name of their own. */
export function filesFromClipboard(
	data: { files: ArrayLike<File> } | null,
	now = Date.now(),
): File[] {
	if (!data) return [];
	return Array.from(data.files, (file) => {
		const name = pasteName(file, now);
		return name === file.name
			? file
			: new File([file], name, {
					type: file.type,
					lastModified: file.lastModified,
				});
	});
}

/** Files pasted onto the page itself; a text field or open dialog keeps its paste. */
export function pastedFiles(e: ClipboardEvent): File[] {
	if (isTextEntryTarget(e.target) || isModalKeyboardOpen()) return [];
	const files = filesFromClipboard(e.clipboardData);
	if (files.length > 0) e.preventDefault();
	return files;
}
