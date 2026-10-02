/** An error's stack without the "Name: message" line V8 puts on top, which the report
 * already quotes; Firefox and Safari stacks start straight at the frames. */
export function stackFrames(error: Error): string | undefined {
	const stack = error.stack;
	if (!stack) return undefined;
	const heading = `${error.name}: ${error.message}`;
	const frames = stack.startsWith(heading)
		? stack.slice(heading.length).replace(/^\n/, "")
		: stack;
	return frames.trim() ? frames : undefined;
}
