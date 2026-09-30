/** In-memory stand-in for the custom-font store, shared by the tests that mock it.
 * Bun's `mock.module` is global and a later registration doesn't reliably replace an
 * earlier one, so both test files hand back the same exports and read the same state.
 * A mock missing an export makes whichever module imports it fail to load. */

export interface FakeFont {
	id: string;
	name: string;
	family: string;
	sourceUrl: string;
	addedAt: number;
	data?: ArrayBuffer;
}

let fonts: FakeFont[] = [];
let sizes = new Map<string, number>();

export function fakeFonts(): FakeFont[] {
	return fonts;
}

/** Replace the store; sizes default to the byte length of each font's data. */
export function setFakeFonts(
	next: FakeFont[],
	nextSizes?: Map<string, number>,
): void {
	fonts = next;
	sizes =
		nextSizes ?? new Map(next.map((f) => [f.id, f.data?.byteLength ?? 0]));
}

/** The module shape both mocks hand back. */
export function fakeFontModule() {
	return {
		customFonts: () => fonts.map(({ data: _data, ...rest }) => rest),
		getCustomFontSizes: async () => new Map(sizes),
		getCustomFontData: async (id: string) =>
			fonts.find((f) => f.id === id)?.data ?? null,
		addCustomFont: async (url: string) => {
			const font: FakeFont = {
				id: `font-${fonts.length}`,
				name: "Fetched",
				family: "'Fetched'",
				sourceUrl: url,
				addedAt: Date.now(),
				data: new ArrayBuffer(0),
			};
			fonts = [...fonts, font];
			return font;
		},
		addCustomFontData: async (
			name: string,
			sourceUrl: string,
			data: ArrayBuffer,
		) => {
			const font: FakeFont = {
				id: `font-${fonts.length}`,
				name,
				family: `'${name.replace(/'/g, "")}'`,
				sourceUrl,
				addedAt: Date.now(),
				data,
			};
			fonts = [...fonts, font];
			return font;
		},
		removeCustomFont: async (id: string) => {
			fonts = fonts.filter((f) => f.id !== id);
			sizes.delete(id);
		},
	};
}
