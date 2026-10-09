/** Why a 3D file didn't open, read from its name and header, for the dialog that says so. */

import { MESH_EXTENSIONS } from "./index";

export interface ModelProblem {
	name: string;
	/** What the file turned out to be, e.g. "FBX 6.1". */
	format: string;
	reason: string;
	fix: string;
}

const EXPORT_GLB = "Export it from your 3D app as GLB.";

/** 3D formats we don't read, so a drop of one can say what it is. */
const OTHER_FORMATS: Record<string, { format: string; fix: string }> = {
	".gltf": {
		format: "glTF with separate files",
		fix: "Export it as GLB instead. A GLB puts the model, its textures and animation in one file.",
	},
	".blend": {
		format: "Blender scene",
		fix: "In Blender, use File → Export → glTF 2.0 and pick the GLB format.",
	},
	".dae": { format: "Collada", fix: EXPORT_GLB },
	".3ds": { format: "3D Studio", fix: EXPORT_GLB },
	".max": { format: "3ds Max scene", fix: EXPORT_GLB },
	".ma": { format: "Maya scene", fix: EXPORT_GLB },
	".mb": { format: "Maya scene", fix: EXPORT_GLB },
	".c4d": { format: "Cinema 4D scene", fix: EXPORT_GLB },
	".usd": { format: "USD", fix: EXPORT_GLB },
	".usda": { format: "USD", fix: EXPORT_GLB },
	".usdc": { format: "USD", fix: EXPORT_GLB },
	".usdz": { format: "USDZ", fix: EXPORT_GLB },
	".abc": { format: "Alembic", fix: EXPORT_GLB },
	".x3d": { format: "X3D", fix: EXPORT_GLB },
	".vrm": { format: "VRM avatar", fix: EXPORT_GLB },
};

function extension(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot < 0 ? "" : name.slice(dot).toLowerCase();
}

/** A 3D file in a format we don't read at all. */
export function isOtherModelFile(file: File): boolean {
	return extension(file.name) in OTHER_FORMATS;
}

/** A model the pool turned down: what it is, and what to do about it. */
export async function diagnoseModel(file: File): Promise<ModelProblem> {
	const ext = extension(file.name);
	const other = OTHER_FORMATS[ext];
	if (other) {
		return {
			name: file.name,
			format: other.format,
			reason: "OpenMosh can't read this format.",
			fix: other.fix,
		};
	}
	if (!MESH_EXTENSIONS.includes(ext)) {
		return {
			name: file.name,
			format: "Unknown",
			reason: "This doesn't look like a 3D model.",
			fix: EXPORT_GLB,
		};
	}
	const head = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
	return { name: file.name, ...describe(ext, head) };
}

function describe(ext: string, head: Uint8Array): Omit<ModelProblem, "name"> {
	const text = new TextDecoder().decode(head);
	const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
	switch (ext) {
		case ".fbx": {
			if (text.startsWith("Kaydara FBX Binary") && head.length >= 27) {
				const version = dv.getUint32(23, true);
				const label = `FBX ${Math.floor(version / 1000)}.${Math.floor((version % 1000) / 100)}`;
				if (version < 7000) {
					return {
						format: `${label} (binary)`,
						reason:
							"This FBX version is from before 2011. OpenMosh reads FBX 7 and newer.",
						fix: "Blender can't open it either. Convert it with Autodesk FBX Converter to FBX 2013 or newer (with media embedded), or to GLB.",
					};
				}
				return {
					format: `${label} (binary)`,
					reason: "There's no mesh in it to draw.",
					fix: "Make sure the export includes the mesh, not just the skeleton or animation, or export it as GLB.",
				};
			}
			if (text.includes("FBXHeaderExtension") || /^\s*;\s*FBX/.test(text)) {
				const v = text.match(/FBXVersion:\s*(\d+)/)?.[1];
				return {
					format: v ? `FBX ${Number(v) / 1000} (text)` : "FBX (text)",
					reason: "This is a text FBX. OpenMosh only reads binary FBX.",
					fix: "Export it again as binary FBX, or as GLB.",
				};
			}
			return {
				format: "Unknown",
				reason: "This isn't an FBX file, whatever its name says.",
				fix: EXPORT_GLB,
			};
		}
		case ".glb": {
			if (head.length < 12 || dv.getUint32(0, true) !== 0x46546c67) {
				return {
					format: text.trimStart().startsWith("{") ? "glTF (text)" : "Unknown",
					reason: "This isn't a binary GLB file, whatever its name says.",
					fix: EXPORT_GLB,
				};
			}
			const version = dv.getUint32(4, true);
			if (version !== 2) {
				return {
					format: `glTF ${version}.0`,
					reason: "OpenMosh reads glTF 2.0.",
					fix: "Export it again from a current 3D app.",
				};
			}
			const required = text.match(/"extensionsRequired"\s*:\s*\[([^\]]*)\]/);
			const compressed = required?.[1].match(
				/KHR_draco_mesh_compression|EXT_meshopt_compression/,
			);
			if (compressed) {
				return {
					format: "GLB (glTF 2.0), compressed",
					reason: `It's compressed with ${compressed[0]}, and it didn't unpack.`,
					fix: "Export it again with mesh compression turned off.",
				};
			}
			return {
				format: "GLB (glTF 2.0)",
				reason: "There's no mesh in it to draw.",
				fix: "Make sure the export includes the mesh, not just the skeleton or animation.",
			};
		}
		case ".ply":
			return {
				format: "PLY",
				reason: head.subarray(0, 3).every((b, i) => b === "ply".charCodeAt(i))
					? "OpenMosh couldn't find any points or faces in it."
					: "This isn't a PLY file, whatever its name says.",
				fix: "Check that it opens in a 3D app, or export it as GLB.",
			};
		default:
			return {
				format: ext === ".stl" ? "STL" : "OBJ",
				reason: "OpenMosh couldn't find any triangles in it.",
				fix: "Check that it opens in a 3D app, or export it as GLB.",
			};
	}
}
