import { describe, expect, it } from "bun:test";
import { diagnoseModel, isOtherModelFile } from "./support";

function binaryFbx(version: number): Uint8Array {
	const bytes = new Uint8Array(64);
	bytes.set(new TextEncoder().encode("Kaydara FBX Binary  \0"));
	bytes[21] = 0x1a;
	new DataView(bytes.buffer).setUint32(23, version, true);
	return bytes;
}

function glb(version: number, json: object): Uint8Array {
	const text = new TextEncoder().encode(JSON.stringify(json));
	const bytes = new Uint8Array(20 + text.length);
	const dv = new DataView(bytes.buffer);
	dv.setUint32(0, 0x46546c67, true);
	dv.setUint32(4, version, true);
	dv.setUint32(8, bytes.length, true);
	dv.setUint32(12, text.length, true);
	dv.setUint32(16, 0x4e4f534a, true);
	bytes.set(text, 20);
	return bytes;
}

const file = (name: string, bytes: Uint8Array | string) =>
	new File([bytes as BlobPart], name);

describe("diagnoseModel", () => {
	it("names an old binary FBX by its version", async () => {
		const p = await diagnoseModel(file("pigeon.fbx", binaryFbx(6100)));
		expect(p.format).toBe("FBX 6.1 (binary)");
		expect(p.reason).toContain("FBX 7");
	});

	it("tells a text FBX from a binary one", async () => {
		const p = await diagnoseModel(
			file(
				"a.fbx",
				"; FBX 7.3.0 project file\nFBXHeaderExtension:  {\n FBXVersion: 7300",
			),
		);
		expect(p.format).toBe("FBX 7.3 (text)");
	});

	it("blames an FBX 7 file's contents, not its version", async () => {
		const p = await diagnoseModel(file("a.fbx", binaryFbx(7400)));
		expect(p.format).toBe("FBX 7.4 (binary)");
		expect(p.reason).toContain("no mesh in it");
	});

	it("spots mesh compression a GLB requires", async () => {
		const p = await diagnoseModel(
			file(
				"a.glb",
				glb(2, { extensionsRequired: ["KHR_draco_mesh_compression"] }),
			),
		);
		expect(p.reason).toContain("KHR_draco_mesh_compression");
	});

	it("names glTF 1.0", async () => {
		const p = await diagnoseModel(file("a.glb", glb(1, {})));
		expect(p.format).toBe("glTF 1.0");
	});

	it("names formats it doesn't read at all", async () => {
		const blend = file("scene.blend", "BLENDER");
		expect(isOtherModelFile(blend)).toBe(true);
		expect((await diagnoseModel(blend)).format).toBe("Blender scene");
		expect(isOtherModelFile(file("a.fbx", ""))).toBe(false);
	});
});
