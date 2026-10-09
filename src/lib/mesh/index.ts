import { parseFbx } from "./fbx";
import { parseGltf, readGlb } from "./glb";
import type { Mesh, MeshAnimation, Skin } from "./mesh";
import { parseObj } from "./obj";
import { parsePly } from "./ply";
import { parseStl } from "./stl";

export type { Mesh, MeshAnimation, Skin };

export const MESH_EXTENSIONS = [".obj", ".stl", ".glb", ".fbx", ".ply"];
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
		if (mesh?.images.length) {
			mesh.textures = await decodeTextures(mesh.images);
			mesh.images = [];
			// Textures that won't decode leave the model in its material colours.
			if (mesh.textures.length === 0) mesh.uvs = null;
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
			return parseGlbFile(new Uint8Array(await file.arrayBuffer()));
		case ".fbx":
			return parseFbx(new Uint8Array(await file.arrayBuffer()));
		case ".ply":
			return parsePly(new Uint8Array(await file.arrayBuffer()));
		default:
			return parseObj(await file.text());
	}
}

/** Draco and meshopt files load their decoders first. */
async function parseGlbFile(bytes: Uint8Array): Promise<Mesh | null> {
	const glb = readGlb(bytes);
	if (!glb) return null;
	const used = glb.json.extensionsUsed ?? [];
	const compressed = used.some((e) => COMPRESSIONS.includes(e));
	const unpacked = compressed
		? await (await import("./glb-unpack")).unpackGltf(glb.json, glb.bin)
		: undefined;
	return parseGltf(glb.json, glb.bin, unpacked);
}

/** Kept in step with glb-unpack, which stays out of the main chunk. */
const COMPRESSIONS = ["KHR_draco_mesh_compression", "EXT_meshopt_compression"];

/** Largest side of the shared texture size. */
const MAX_TEXTURE_SIDE = 2048;
/** Pixels across every layer, so a model with dozens of maps stays in memory. */
const TEXTURE_BUDGET = 64 * 1024 * 1024;

/** Every picture decoded and scaled to one size; one that won't decode becomes
 * white, so it shows its material colour. Empty when none decode. */
async function decodeTextures(images: Mesh["images"]): Promise<ImageBitmap[]> {
	const decoded = await Promise.all(
		images.map((image) =>
			createImageBitmap(
				new Blob([image.bytes as BlobPart], { type: image.mime }),
				{
					premultiplyAlpha: "none",
					colorSpaceConversion: "none",
				},
			).catch(() => null),
		),
	);
	const ok = decoded.filter((b): b is ImageBitmap => b !== null);
	if (ok.length === 0) return [];
	let w = Math.min(MAX_TEXTURE_SIDE, Math.max(...ok.map((b) => b.width)));
	let h = Math.min(MAX_TEXTURE_SIDE, Math.max(...ok.map((b) => b.height)));
	while (w * h * decoded.length > TEXTURE_BUDGET && w > 1 && h > 1) {
		w = Math.ceil(w / 2);
		h = Math.ceil(h / 2);
	}
	const white = new ImageData(1, 1);
	white.data.fill(255);
	return Promise.all(
		decoded.map(async (bitmap) => {
			if (bitmap && bitmap.width === w && bitmap.height === h) return bitmap;
			const sized = await createImageBitmap(bitmap ?? white, {
				resizeWidth: w,
				resizeHeight: h,
				resizeQuality: "high",
				premultiplyAlpha: "none",
				colorSpaceConversion: "none",
			});
			bitmap?.close();
			return sized;
		}),
	);
}
