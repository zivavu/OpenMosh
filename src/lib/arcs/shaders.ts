import { GLSL_COMMON } from "../generators/gpu";

export const ARC_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aEnds;
layout(location=2) in vec2 aRadii;
uniform vec2 uRes;
out vec2 vAt;
flat out vec4 vEnds;
flat out vec2 vRadii;
void main(){
  vAt=aCorner;
  vEnds=aEnds;
  vRadii=aRadii;
  gl_Position=vec4(aCorner/(uRes*.5),0.,1.);
}`;

/** What arcDrawer got from a separable blur of a hard capsule, worked out per pixel: a
 * band of half width r convolved with a gaussian is a difference of two erfs. MAX-blended
 * into one stroke's scratch, so its capsules union the way hard shapes do. */
export const ARC_FS = `#version 300 es
precision highp float;
in vec2 vAt;
flat in vec4 vEnds;
flat in vec2 vRadii;
uniform float uBlur;
out vec4 o;
float erf(float x){
  float a=abs(x);
  float d=1.+a*(.278393+a*(.230389+a*(.000972+a*.078108)));
  d*=d; d*=d;
  return sign(x)*(1.-1./d);
}
void main(){
  vec2 pa=vAt-vEnds.xy;
  vec2 ba=vEnds.zw-vEnds.xy;
  float h=clamp(dot(pa,ba)/max(dot(ba,ba),1e-5),0.,1.);
  float d=length(pa-ba*h);
  float r=mix(vRadii.x,vRadii.y,h);
  float k=.7071068/uBlur;
  o=vec4(.5*(erf((d+r)*k)-erf((d-r)*k)));
}`;

/** One stroke's scratch onto the picture, premultiplied for arcDrawer's "over": strokes
 * pile up to the ink and never past it. */
export const STROKE_FS = `#version 300 es
precision highp float;
${GLSL_COMMON}
uniform sampler2D uStroke;
uniform float uAlpha, uTone;
out vec4 o;
void main(){
  float a=texelFetch(uStroke,ivec2(gl_FragCoord.xy),0).r*uAlpha;
  o=vec4(ramp(uTone)*a,a);
}`;

export const PRESENT_FS = `#version 300 es
precision highp float;
uniform sampler2D uStrokes;
uniform float uClear, uHeight;
out vec4 o;
float noise(vec2 p){
  vec3 q=fract(vec3(p.xyx)*.1031); q+=dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z);
}
void main(){
  ivec2 at=ivec2(gl_FragCoord.xy);
  // A layer's texture runs top down, where the canvas runs bottom up.
  if(uClear>.5) at.y=int(uHeight)-1-at.y;
  vec4 c=texelFetch(uStrokes,at,0);
  float dither=(noise(gl_FragCoord.xy)-.5)/255.;
  // Over other layers the colour comes out straight, with its coverage as alpha.
  if(uClear>.5) o=vec4(c.a>0.?c.rgb/c.a:vec3(0.),c.a+dither);
  else o=vec4(c.rgb+dither,1.);
}`;
