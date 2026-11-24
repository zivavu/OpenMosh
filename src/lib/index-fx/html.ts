import type { IndexFxManifest } from "./manifest";
import { standalonePreview } from "./preview";

export interface HtmlOptions {
	description: string;
	/** License texts to carry in the file, each kept whole. */
	notices: string[];
	homepage: string;
}

const escapeHtml = (s: string) =>
	s.replace(
		/[&<>"]/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
	);

/** JSON inside a <script>: no "</script" or "<!--" can close it early. */
const scriptJson = (value: unknown) =>
	JSON.stringify(value, null, 2).replace(/</g, "\\u003c");

const STYLE = `*{box-sizing:border-box}
html,body{margin:0;height:100%;background:#0d0d0f;color:#e8e6e1;font:14px/1.45 system-ui,sans-serif}
body{display:flex;min-height:100%}
.stage{position:relative;flex:1;min-width:0;min-height:60vh}
.stage canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.error{position:absolute;left:16px;right:16px;top:16px;margin:0;padding:12px;background:#3a1010;white-space:pre-wrap;font:12px/1.4 ui-monospace,monospace}
.panel{width:320px;flex:none;overflow:auto;padding:20px;border-left:1px solid #26262b;background:#141417}
.panel h1{margin:0 0 6px;font-size:20px}
.panel p{margin:0 0 12px;color:#b5b2ab}
.panel small{display:block;color:#7d7a74;margin-bottom:16px}
.panel a{color:#9fd8c4}
.controls{display:grid;gap:10px;margin:16px 0}
.row{display:grid;grid-template-columns:1fr auto;align-items:center;gap:4px 10px}
.row input[type=range]{grid-column:1/-1;width:100%}
.row output{grid-row:1;grid-column:2;font:12px ui-monospace,monospace;color:#b5b2ab}
.row select{max-width:170px}
.buttons{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
button,select{background:#222227;color:inherit;border:1px solid #3a3a40;border-radius:4px;padding:5px 9px;font:inherit}
button:hover{background:#2c2c33}
@media (max-width:760px){body{flex-direction:column}.panel{width:auto;border-left:0;border-top:1px solid #26262b}}`;

/** One self-contained INDEX FX file: the manifest a host reads, and a preview for a
 * browser that opens it directly. */
export function toIndexHtml(
	manifest: IndexFxManifest,
	opts: HtmlOptions,
): string {
	const name = escapeHtml(manifest.name);
	const notices = opts.notices
		.map((n) => `\n${n.replace(/--/g, "- -")}\n`)
		.join("\n");
	return `<!doctype html>
<!--${notices}-->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name} · OpenMosh FX for INDEX</title>
<style>${STYLE}</style>
</head>
<body>
<section id="about">
<h1>${name}</h1>
<p>${escapeHtml(opts.description)}</p>
<small>An OpenMosh effect for INDEX hosts (<code>fragment-webgl2</code>, effect API v2). Drop this file into the INDEX Playground above another layer, or try it here on the test card or your own image or video.</small>
<small>From <a href="${escapeHtml(opts.homepage)}">OpenMosh</a>, MIT licensed. The license is at the top of this file.</small>
</section>
<script>
window.INDEX_TOOL = ${scriptJson(manifest)};
</script>
<script>
(${standalonePreview.toString()})();
</script>
</body>
</html>
`;
}
