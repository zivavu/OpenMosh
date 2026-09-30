/** Column-major 4x4 matrices as plain arrays, the layout glTF, FBX and GLSL share. */
export type Mat4 = number[];

export function identity(): Mat4 {
	return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** a * b: b acts first. */
export function multiply(a: ArrayLike<number>, b: ArrayLike<number>): Mat4 {
	const out = new Array<number>(16);
	for (let c = 0; c < 4; c++) {
		for (let r = 0; r < 4; r++) {
			out[c * 4 + r] =
				a[r] * b[c * 4] +
				a[4 + r] * b[c * 4 + 1] +
				a[8 + r] * b[c * 4 + 2] +
				a[12 + r] * b[c * 4 + 3];
		}
	}
	return out;
}

/** Translation, unit quaternion (x, y, z, w) and scale, applied scale first. */
export function compose(
	t: ArrayLike<number>,
	q: ArrayLike<number>,
	s: ArrayLike<number>,
): Mat4 {
	const [x, y, z, w] = [q[0], q[1], q[2], q[3]];
	const xx = x * x;
	const yy = y * y;
	const zz = z * z;
	const xy = x * y;
	const xz = x * z;
	const yz = y * z;
	const wx = w * x;
	const wy = w * y;
	const wz = w * z;
	return [
		(1 - 2 * (yy + zz)) * s[0],
		2 * (xy + wz) * s[0],
		2 * (xz - wy) * s[0],
		0,
		2 * (xy - wz) * s[1],
		(1 - 2 * (xx + zz)) * s[1],
		2 * (yz + wx) * s[1],
		0,
		2 * (xz + wy) * s[2],
		2 * (yz - wx) * s[2],
		(1 - 2 * (xx + yy)) * s[2],
		0,
		t[0],
		t[1],
		t[2],
		1,
	];
}

export function translation(x: number, y: number, z: number): Mat4 {
	const m = identity();
	m[12] = x;
	m[13] = y;
	m[14] = z;
	return m;
}

export function scaling(x: number, y: number, z: number): Mat4 {
	const m = identity();
	m[0] = x;
	m[5] = y;
	m[10] = z;
	return m;
}

/** Rotation about one axis (0 x, 1 y, 2 z), in radians. */
export function rotationAxis(axis: 0 | 1 | 2, angle: number): Mat4 {
	const c = Math.cos(angle);
	const s = Math.sin(angle);
	const m = identity();
	const [i, j] = [
		[1, 2],
		[2, 0],
		[0, 1],
	][axis];
	m[i * 4 + i] = c;
	m[i * 4 + j] = s;
	m[j * 4 + i] = -s;
	m[j * 4 + j] = c;
	return m;
}

/** General inverse; the identity for a singular matrix. */
export function invert(m: ArrayLike<number>): Mat4 {
	const a = Array.from(m);
	const inv = identity();
	for (let col = 0; col < 4; col++) {
		let pivot = col;
		for (let r = col + 1; r < 4; r++) {
			if (Math.abs(a[col * 4 + r]) > Math.abs(a[col * 4 + pivot])) pivot = r;
		}
		if (Math.abs(a[col * 4 + pivot]) < 1e-14) return identity();
		if (pivot !== col) {
			for (let k = 0; k < 4; k++) {
				[a[k * 4 + col], a[k * 4 + pivot]] = [a[k * 4 + pivot], a[k * 4 + col]];
				[inv[k * 4 + col], inv[k * 4 + pivot]] = [
					inv[k * 4 + pivot],
					inv[k * 4 + col],
				];
			}
		}
		const d = a[col * 4 + col];
		for (let k = 0; k < 4; k++) {
			a[k * 4 + col] /= d;
			inv[k * 4 + col] /= d;
		}
		for (let r = 0; r < 4; r++) {
			if (r === col) continue;
			const f = a[col * 4 + r];
			if (f === 0) continue;
			for (let k = 0; k < 4; k++) {
				a[k * 4 + r] -= f * a[k * 4 + col];
				inv[k * 4 + r] -= f * inv[k * 4 + col];
			}
		}
	}
	return inv;
}

/** Spherical interpolation between unit quaternions. */
export function slerp(
	a: ArrayLike<number>,
	b: ArrayLike<number>,
	t: number,
): number[] {
	let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
	const sign = dot < 0 ? -1 : 1;
	dot *= sign;
	let wa = 1 - t;
	let wb = t;
	if (dot < 0.9995) {
		const theta = Math.acos(dot);
		const sin = Math.sin(theta);
		wa = Math.sin((1 - t) * theta) / sin;
		wb = Math.sin(t * theta) / sin;
	}
	const q = [0, 1, 2, 3].map((i) => wa * a[i] + wb * sign * b[i]);
	const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
	return q.map((c) => c / len);
}
