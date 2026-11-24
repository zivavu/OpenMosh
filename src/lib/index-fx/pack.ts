import type { CatalogEffect } from "../effects/catalog";
import { toIndexHtml } from "./html";
import { toIndexManifest, type IndexFxManifest } from "./manifest";
import { INDEX_FX, INDEX_FX_HELD, UPSTREAM } from "./shortlist";

export const INDEX_FX_VERSION = "1.0";
export const OPENMOSH_URL = "https://github.com/zivavu/OpenMosh";

export interface PackOptions {
	catalog: CatalogEffect[];
	/** OpenMosh's LICENSE, carried whole. */
	license: string;
	/** Link to an effect's source file at the commit it was exported from. */
	sourceUrl: (id: string) => string;
}

export interface PackFile {
	name: string;
	contents: string;
}

export function fileName(name: string) {
	return `${name.replace(/[^A-Za-z0-9]+/g, "_")}-v${INDEX_FX_VERSION}.html`;
}

const MIT_PERMISSION = (license: string) =>
	license.slice(license.indexOf("Permission is hereby granted"));

function upstreamNotice(id: string, license: string) {
	const up = UPSTREAM[id];
	if (!up) return null;
	return `Ported to OpenMosh from ${up.project} (${up.url}).\n\nMIT License\n\n${up.notice}\n\n${MIT_PERMISSION(license)}`;
}

/** Every file the pack folder holds: one HTML per effect, its README and LICENSE. */
export function buildPack({
	catalog,
	license,
	sourceUrl,
}: PackOptions): PackFile[] {
	const files: PackFile[] = [];
	const rows: {
		manifest: IndexFxManifest;
		file: string;
		description: string;
	}[] = [];
	for (const [id, description] of Object.entries(INDEX_FX)) {
		const entry = catalog.find((c) => c.definition.id === id);
		if (!entry) throw new Error(`no effect "${id}" in the catalog`);
		const up = UPSTREAM[id];
		const manifest = toIndexManifest(entry, {
			version: `v${INDEX_FX_VERSION}`,
			provenance: {
				author: "OpenMosh",
				source: sourceUrl(id),
				adaptation:
					"Exported by OpenMosh's INDEX FX exporter. The shader body is OpenMosh's; a header maps its uniforms, y direction and texture sampling onto the INDEX host's, and Speed scales uTime.",
				license: "MIT",
				notice: up
					? `Copyright (c) 2026 OpenMosh; ported from ${up.project}, ${up.notice}, MIT`
					: "Copyright (c) 2026 OpenMosh",
			},
		});
		const notices = [license.trim()];
		const extra = upstreamNotice(id, license);
		if (extra) notices.push(extra.trim());
		const file = fileName(manifest.name);
		files.push({
			name: file,
			contents: toIndexHtml(manifest, {
				description,
				notices,
				homepage: OPENMOSH_URL,
			}),
		});
		rows.push({ manifest, file, description });
	}
	files.push({ name: "README.md", contents: readme(rows) });
	files.push({ name: "LICENSE.md", contents: licenseFile(license) });
	return files;
}

function controlList(m: IndexFxManifest) {
	return [
		...m.params.map((p) =>
			p.type === "choice"
				? `${p.label} (${p.options!.map((o) => o.label).join(" / ")})`
				: p.type === "toggle"
					? `${p.label} (on/off)`
					: p.label,
		),
		...m.colors.map((c) => `${c.label} (colour)`),
	].join(", ");
}

function readme(
	rows: { manifest: IndexFxManifest; file: string; description: string }[],
) {
	const table = rows
		.map(
			({ manifest: m, file, description }) =>
				`| [${m.name}](${file}) | ${description} | ${controlList(m)} |${m.effect.history ? " Yes |" : " |"}`,
		)
		.join("\n");
	const held = Object.entries(INDEX_FX_HELD)
		.map(([id, why]) => `- **${id}**: ${why}`)
		.join("\n");
	return `# OpenMosh FX

${rows.length} effects from [OpenMosh](${OPENMOSH_URL}), exported as INDEX \`fragment-webgl2\` effects (effect API v2, provisional). Each file is standalone: drop it into the INDEX Playground on a layer above a generator, or open it in a browser to try it on a test card or your own image or video.

These files are generated. Fix an effect in OpenMosh and export again rather than editing them here.

## Effects

| Effect | What it does | Controls | History |
| --- | --- | --- | --- |
${table}

"History" marks the effects that read their own last frame (\`effect.history: true\`); Reset History in the Playground clears it.

## Controls

- Every control is a number, so any host that draws sliders can run every effect.
- On/off controls carry \`type: "toggle"\` and send 0 or 1.
- Multiple-choice controls carry \`type: "choice"\` with \`options: [{ value, label }]\` and send the option's index.
- Hosts that don't read \`type\` yet show those as sliders over the same numbers.
- Plain sliders are listed in \`audio\`, so a host may modulate them.

## How an OpenMosh effect becomes an INDEX pass

The GLSL body of each pass is OpenMosh's own. The exporter only swaps its header:

- \`uInput\`, \`uHistory\`, \`uTime\`, \`uDelta\` and \`vUV\` stand in for OpenMosh's \`u_texture\`, \`u_feedback\`, \`u_time\`, \`u_delta\` and \`v_uv\`.
- OpenMosh measures sizes in a frame 720 pixels on its short side; \`u_resolution\` is rebuilt from \`uResolution\` that way, so an effect looks the same at any output size.
- OpenMosh's image runs top to bottom and its textures repeat mirrored and sample nearest unless an effect asks otherwise. Every texture read goes through a small sampler that does the same on the host's textures.
- OpenMosh runs an effect's clock at its Speed. Here \`uTime\` is multiplied by Speed, so moving Speed while it plays also jumps the motion along.

## Left out

- OpenMosh can lock an effect's clock to a song's beats. INDEX hosts don't pass a tempo yet, so these effects run on Speed alone.
- A few OpenMosh sliders give more of their travel to the low end. Here every slider is linear.
- These picked effects are held back until the INDEX FX host offers what they need:

${held}

## License

MIT, © 2026 OpenMosh; see [LICENSE.md](LICENSE.md). Effects OpenMosh ported from X-PostProcessing-Library and Vidvox ISF-Files (both MIT) carry those notices as well. Every HTML file holds its own licenses in its first comment.
`;
}

function licenseFile(license: string) {
	const byProject = new Map<string, string[]>();
	for (const [id, up] of Object.entries(UPSTREAM)) {
		if (!(id in INDEX_FX)) continue;
		const who = `[${up.project}](${up.url}), ${up.notice}`;
		byProject.set(who, [...(byProject.get(who) ?? []), id]);
	}
	const ports = [...byProject].map(
		([who, ids]) => `- ${who}: ${ids.join(", ")}`,
	);
	return `# Licenses

The effects in this folder come from OpenMosh under the MIT License below. They are not covered by the repository's PolyForm Noncommercial license.

\`\`\`
${license.trim()}
\`\`\`

Some were ported to OpenMosh from other MIT-licensed projects, and their files carry that notice next to OpenMosh's:

${ports.join("\n")}
`;
}
