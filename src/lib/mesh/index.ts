import { parseFbx } from "./fbx";
import { parseGlb } from "./glb";
import type { Mesh, Skin } from "./mesh";
import { parseObj } from "./obj";
import { parseStl } from "./stl";

export type { Mesh, Skin };

export const MESH_EXTENSIONS = [".obj", ".stl", ".glb", ".fbx"];
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

/** Null for a file with no triangles or points to draw. */
export async function parseMesh(file: File): Promise<Mesh | null> {
	try {
		const mesh = await parseByExtension(file);
		if (mesh?.image) {
			mesh.texture = await decodeTexture(mesh.image).catch(() => null);
			mesh.image = null;
			// A texture that won't decode leaves the model in its material colours.
			if (!mesh.texture) mesh.uvs = null;
		}
		return mesh;
	} catch {
		return null;
	}
}

async function parseByExtension(file: File): Promise<Mesh | null> {
	switch (extension(file.name)) {
		case ".stl":
			return parseStl(new Uint8Array(await file.arrayBuffer()));
		case ".glb":
			return parseGlb(new Uint8Array(await file.arrayBuffer()));
		case ".fbx":
			return parseFbx(new Uint8Array(await file.arrayBuffer()));
		default:
			return parseObj(await file.text());
	}
}

function decodeTexture(
	image: NonNullable<Mesh["image"]>,
): Promise<ImageBitmap> {
	return createImageBitmap(
		new Blob([image.bytes as BlobPart], { type: image.mime }),
		{ premultiplyAlpha: "none", colorSpaceConversion: "none" },
	);
}
