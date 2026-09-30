import { detectCapabilities, type CapabilityReport } from "./capabilities";

let report = $state<CapabilityReport | null>(null);
let probing: Promise<CapabilityReport> | null = null;

/** Null until the first probe settles. */
export function getCapabilityReport(): CapabilityReport | null {
	return report;
}

export function probeCapabilities(): Promise<CapabilityReport> {
	probing ??= detectCapabilities().then((r) => (report = r));
	return probing;
}
