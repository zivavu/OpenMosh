/** Action: moves the node to the page's body, so no panel that clips or makes its
 * own frame for fixed children can cut it off. */
export function toBody(node: HTMLElement) {
	document.body.appendChild(node);
	return { destroy: () => node.remove() };
}
