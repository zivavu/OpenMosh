import type { Mesh } from "./mesh";
import { parseObj } from "./obj";
import { parseStl } from "./stl";

export type { Mesh };

export const MESH_EXTENSIONS = [".obj", ".stl"];
/** For a file input's `accept`. */
export const MESH_ACCEPT = MESH_EXTENSIONS.join(",");

/** Browsers give these files no MIME type, or an inconsistent one, so the pool
 * keys them on this instead. */
export const MESH_TYPE = "model/x-openmosh-mesh";

function extension(name: string): string {
	return name.slice(name.lastIndexOf(".")).toLowerCase();
}

export function isMeshFile(file: File): boolean {
	return (
		file.type === MESH_TYPE || MESH_EXTENSIONS.includes(extension(file.name))
	);
}

/** The same file under MESH_TYPE; name and timestamp are kept, so its id is too. */
export function asMeshFile(file: File): File {
	if (file.type === MESH_TYPE) return file;
	return new File([file], file.name, {
		type: MESH_TYPE,
		lastModified: file.lastModified,
	});
}

/** Null for a file with no drawable triangles. */
export async function parseMesh(file: File): Promise<Mesh | null> {
	try {
		if (extension(file.name) === ".stl") {
			return parseStl(new Uint8Array(await file.arrayBuffer()));
		}
		return parseObj(await file.text());
	} catch {
		return null;
	}
}
