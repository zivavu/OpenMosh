import type { TransitionType } from '../slideshow/types';

const H = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
uniform sampler2D u_texture2;
uniform float u_progress;
in vec2 v_uv;
out vec4 outColor;
`;

export const TRANSITION_SHADERS: Record<TransitionType, { fragment: string }> = {
	crossfade: {
		fragment:
			H +
			`void main() {
  vec4 a = texture(u_texture, v_uv);
  vec4 b = texture(u_texture2, v_uv);
  outColor = mix(a, b, u_progress);
}`,
	},

	'wipe-left': {
		fragment:
			H +
			`void main() {
  vec4 a = texture(u_texture, v_uv);
  vec4 b = texture(u_texture2, v_uv);
  float edge = smoothstep(u_progress - 0.05, u_progress + 0.05, v_uv.x);
  outColor = mix(b, a, edge);
}`,
	},

	'wipe-down': {
		fragment:
			H +
			`void main() {
  vec4 a = texture(u_texture, v_uv);
  vec4 b = texture(u_texture2, v_uv);
  float edge = smoothstep(u_progress - 0.05, u_progress + 0.05, 1.0 - v_uv.y);
  outColor = mix(b, a, edge);
}`,
	},

	zoom: {
		fragment:
			H +
			`void main() {
  vec2 center = vec2(0.5);
  vec2 uv = v_uv - center;
  float scaleB = mix(3.0, 1.0, u_progress);
  vec4 a = texture(u_texture, v_uv);
  vec4 b = texture(u_texture2, uv / scaleB + center);
  outColor = mix(a, b, u_progress);
}`,
	},

	pixelate: {
		fragment:
			H +
			`void main() {
  float t = u_progress;
  float blockSize = 1.0 + 80.0 * (1.0 - abs(t * 2.0 - 1.0));
  vec2 res = vec2(textureSize(u_texture, 0));
  vec2 blockUv = floor(v_uv * res / blockSize) * blockSize / res;
  vec4 a = texture(u_texture, blockUv);
  vec4 b = texture(u_texture2, blockUv);
  outColor = mix(a, b, step(0.5, t));
}`,
	},

	glitch: {
		fragment:
			H +
			`float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
void main() {
  float blockSize = 0.05 + 0.1 * hash(vec2(floor(u_progress * 10.0)));
  vec2 block = floor(v_uv / blockSize);
  float r = hash(block + floor(u_progress * 8.0));
  float threshold = smoothstep(0.0, 1.0, u_progress);
  vec4 a = texture(u_texture, v_uv);
  vec4 b = texture(u_texture2, v_uv);
  outColor = r < threshold ? b : a;
}`,
	},

	flash: {
		fragment:
			H +
			`void main() {
  vec4 a = texture(u_texture, v_uv);
  vec4 b = texture(u_texture2, v_uv);
  // Flash peaks at t=0.5, images swap at midpoint
  float flash = 1.0 - abs(u_progress * 2.0 - 1.0);
  // Sharpen the flash curve for a punchy burst
  flash = pow(flash, 0.6);
  vec4 base = u_progress < 0.5 ? a : b;
  outColor = mix(base, vec4(1.0), flash);
}`,
	},
};

export const TRANSITION_LABELS: Record<TransitionType, string> = {
	crossfade: 'Crossfade',
	'wipe-left': 'Wipe Left',
	'wipe-down': 'Wipe Down',
	zoom: 'Zoom',
	pixelate: 'Pixelate',
	glitch: 'Glitch',
	flash: 'Flash',
};
