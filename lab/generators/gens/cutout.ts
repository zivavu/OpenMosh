import { makeNoise, TAU, type Generator } from "../kit";
import {
	begin,
	fullscreen,
	FULLSCREEN_VS,
	GLSL_COMMON,
	loc,
	present,
	program,
	setInks,
	texture,
} from "../gl";

// Every layer edge is a formula, so one pass resolves each pixel's layer, its
// antialiasing and the soft shadows of the layers above it. An edge's wobble
// varies along one axis only (x, or the angle around a centre), so it is
// tabulated once per layer in uLut rather than evaluated per pixel.
const FS = `#version 300 es
precision highp float;
out vec4 o;
${GLSL_COMMON}
uniform vec2 uRes;
uniform float uU, uSeed, uWobble, uShadow, uLightFront, uGrain, uSunLayer, uArchX, uRows;
uniform int uScene, uLayers, uIsleCount;
uniform vec4 uSun, uTunnel;
uniform vec4 uIsles[5];
uniform sampler2D uLut;

float lut(float u, int row){ return texture(uLut, vec2(u, (float(row)+0.5)/uRows)).r; }
float around(vec2 d){ return atan(d.y,d.x)/(2.0*PI)+0.5; }

float layerSd(int i, vec2 p){
  float L=float(uLayers), fi=float(i);
  if(uScene==0){
    float base=uRes.y*(0.22+0.7*fi/L);
    float amp=uU*(0.04+0.18*uWobble)*(1.0-fi/(L*1.6));
    return p.y-(base+amp*lut(clamp(p.x/uRes.x,0.,1.),i));
  }
  if(uScene==1){
    float t=fi/(L-1.0);
    vec2 d=p-(uTunnel.xy+uTunnel.zw*(1.0-t));
    return length(d)-uU*(0.08+t*0.55)*(1.0+uWobble*0.35*lut(around(d),i));
  }
  if(uScene==2){
    float t=1.0-(fi-1.0)/(L-1.0), best=-1e9;
    for(int k=0;k<5;k++){
      if(k>=uIsleCount) break;
      vec2 d=p-uIsles[k].xy;
      best=max(best,uIsles[k].z*t*(1.0+uWobble*0.45*lut(around(d),i*5+k))-length(d));
    }
    return best;
  }
  vec2 c=vec2(uArchX,uRes.y+uU*0.05);
  float maxR=length(vec2(max(c.x,uRes.x-c.x),uRes.y))*1.05;
  vec2 d=p-c;
  float u=clamp(atan(d.y,d.x)/PI+1.0,0.,1.);
  return maxR*(1.0-(fi-1.0)/L)*(1.0+uWobble*0.05*lut(u,i))-length(d);
}

vec3 tone(float i){
  float t=i/(float(uLayers)-1.0);
  return ramp(uLightFront>0.5?t:1.0-t);
}

float cover(float sd){ return clamp(sd/max(fwidth(sd),1e-3)+0.5,0.,1.); }

void main(){
  vec2 p=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y);
  vec3 col=tone(0.);
  float blur=max(uU*0.018*uShadow,1.0);
  vec2 off=vec2(0.004,0.008)*uU*uShadow;
  float sa=0.55*uShadow;
  if(uScene==0 && uSun.w>0.5){
    col*=1.0-sa*smoothstep(-blur,blur,uSun.z-length(p-off-uSun.xy));
    col=mix(col,tone(uSunLayer),cover(uSun.z-length(p-uSun.xy)));
  }
  for(int i=1;i<14;i++){
    if(i>=uLayers) break;
    col*=1.0-sa*smoothstep(-blur,blur,layerSd(i,p-off));
    col=mix(col,tone(float(i)),cover(layerSd(i,p)));
  }
  col+=(hash12(gl_FragCoord.xy+fract(uSeed)*917.0)-0.5)*uGrain;
  o=vec4(col,1.);
}`;

const SCENES = ["Hills", "Tunnel", "Islands", "Arches"];

export const cutout: Generator = {
	id: "cutout",
	name: "Paper cutout",
	group: "Graphic & print",
	blurb:
		"Stacked layers of cut paper, each casting a soft shadow on the one behind: hills, a tunnel, islands or arches.",
	params: [
		{
			key: "scene",
			label: "Scene",
			type: "select",
			options: SCENES,
			value: "Hills",
		},
		{
			key: "layers",
			label: "Layers",
			type: "range",
			min: 3,
			max: 14,
			step: 1,
			value: 7,
		},
		{
			key: "shadow",
			label: "Shadow",
			type: "range",
			min: 0,
			max: 1,
			value: 0.6,
		},
		{
			key: "wobble",
			label: "Wobble",
			type: "range",
			min: 0,
			max: 1,
			value: 0.5,
		},
		{
			key: "lightFront",
			label: "Light layers in front",
			type: "bool",
			value: true,
		},
		{
			key: "grain",
			label: "Paper grain",
			type: "range",
			min: 0,
			max: 0.12,
			value: 0.04,
		},
	],
	render(env, p) {
		const { w, h, u, rng, inks } = env;
		const { gl } = begin(w, h);
		const prog = program(gl, FULLSCREEN_VS, FS);
		gl.useProgram(prog);
		const L = p.layers as number;
		const scene = SCENES.indexOf(p.scene as string);

		const sunOn = rng() < 0.7;
		const sunR = u * (0.08 + rng() * 0.12);
		gl.uniform4f(
			loc(gl, prog, "uSun"),
			w * (0.2 + rng() * 0.6),
			h * (0.15 + rng() * 0.25),
			sunR,
			sunOn ? 1 : 0,
		);
		gl.uniform1f(
			loc(gl, prog, "uSunLayer"),
			Math.min(L - 1, Math.round(L * 0.7)),
		);
		gl.uniform4f(
			loc(gl, prog, "uTunnel"),
			w * (0.35 + rng() * 0.3),
			h * (0.35 + rng() * 0.3),
			(rng() - 0.5) * u * 0.25,
			(rng() - 0.5) * u * 0.25,
		);
		const isles = 2 + Math.floor(rng() * 4);
		const data = new Float32Array(20);
		for (let k = 0; k < isles; k++)
			data.set(
				[rng() * w, rng() * h, u * (0.25 + rng() * 0.45), rng() * 100],
				k * 4,
			);
		gl.uniform4fv(loc(gl, prog, "uIsles"), data);
		gl.uniform1i(loc(gl, prog, "uIsleCount"), isles);
		gl.uniform1f(loc(gl, prog, "uArchX"), w * (0.3 + rng() * 0.4));

		gl.uniform2f(loc(gl, prog, "uRes"), w, h);
		gl.uniform1f(loc(gl, prog, "uU"), u);
		gl.uniform1f(loc(gl, prog, "uSeed"), rng() * 100);

		// One row per layer (per layer and island for Islands), sampled along x or angle.
		const N = 1024;
		const rows = scene === 2 ? L * 5 : L;
		const table = new Float32Array(N * rows * 4);
		const noise = makeNoise(rng);
		for (let i = 1; i < L; i++)
			for (let k = 0; k < N; k++) {
				const t = (k + 0.5) / N;
				const a = t * TAU - Math.PI;
				const put = (row: number, v: number) => (table[(row * N + k) * 4] = v);
				if (scene === 0) {
					const freq = (1.2 + i * 0.25) / u;
					const x = t * w;
					put(
						i,
						noise(x * freq, i * 3.1) + 0.35 * noise(x * freq * 3, i * 5.7),
					);
				} else if (scene === 1)
					put(
						i,
						noise(Math.cos(a) * 1.3 + i * 4.1, Math.sin(a) * 1.3 + i * 2.3),
					);
				else if (scene === 2)
					for (let c = 0; c < isles; c++) {
						const kc = data[c * 4 + 3];
						put(
							i * 5 + c,
							noise(Math.cos(a) * 1.6 + kc, Math.sin(a) * 1.6 + i * 0.35) +
								0.4 * noise(Math.cos(a) * 4 + kc, Math.sin(a) * 4 + i * 0.5),
						);
					}
				else put(i, noise(t * 9 + i * 9.1, i * 1.7));
			}
		const lutTex = texture(gl, N, rows, gl.RGBA16F, {
			data: table,
			filter: gl.LINEAR,
		});
		const wrap = scene === 1 || scene === 2 ? gl.REPEAT : gl.CLAMP_TO_EDGE;
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, lutTex);
		gl.uniform1i(loc(gl, prog, "uLut"), 0);
		gl.uniform1f(loc(gl, prog, "uRows"), rows);
		gl.uniform1i(loc(gl, prog, "uScene"), scene);
		gl.uniform1i(loc(gl, prog, "uLayers"), L);
		gl.uniform1f(loc(gl, prog, "uWobble"), p.wobble as number);
		gl.uniform1f(loc(gl, prog, "uShadow"), p.shadow as number);
		gl.uniform1f(loc(gl, prog, "uLightFront"), p.lightFront ? 1 : 0);
		gl.uniform1f(loc(gl, prog, "uGrain"), p.grain as number);
		setInks(gl, prog, inks);
		fullscreen(gl);
		present(env);
		gl.deleteTexture(lutTex);
	},
};
