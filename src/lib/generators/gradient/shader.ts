/** Ported from alGrad's studio: a domain-warped fbm / vortex field lit by its
 * own creases, mapped through a five-stop ramp, with an optional blob mask. */

export const VERT = `#version 300 es
const vec2 v[3] = vec2[3](vec2(-1.,-1.),vec2(3.,-1.),vec2(-1.,3.));
void main(){ gl_Position = vec4(v[gl_VertexID],0.,1.); }`;

export const FRAG = `#version 300 es
precision highp float;
out vec4 outColor;

uniform vec2  uRes;
uniform vec2  uOffset;
uniform float uSeed;
uniform float uScale;
uniform float uWarp;
uniform float uAngle;
uniform float uLight;
uniform float uContrast;
uniform float uGamma;
uniform float uSpread;
uniform float uThresh;
uniform float uSoft;
uniform vec3  uC0,uC1,uC2,uC3,uC4;
uniform int   uMode;

float hash21(vec2 p){
  p=fract(p*vec2(123.34,345.45)); p+=dot(p,p+34.345); return fract(p.x*p.y);
}
float vnoise(vec2 p){
  vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);
  float a=hash21(i),b=hash21(i+vec2(1,0)),c=hash21(i+vec2(0,1)),d=hash21(i+vec2(1,1));
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
}
float fbm(vec2 p){
  float v=0.,a=0.6; mat2 m=mat2(1.4,1.,-1.,1.4);
  for(int i=0;i<3;i++){v+=a*vnoise(p);p=m*p;a*=0.5;} return v;
}

// Sum the swirl velocity of every nearby vortex at grid-space point g. Each
// vortex is an angular field under a compact C² bump, so the field is seamless
// even after the derivative-based crease lighting.
vec2 scatterVel(vec2 g, float sd){
  vec2 vel=vec2(0.0);
  vec2 gi=floor(g);
  for(int dy=-2;dy<=2;dy++) for(int dx=-2;dx<=2;dx++){
    vec2 cell=gi+vec2(float(dx),float(dy));
    vec2 jit=vec2(hash21(cell*1.7 +sd),
                  hash21(cell*2.3 +vec2(sd,sd+7.0)))*2.0-1.0;
    vec2 c=cell+0.5+0.42*jit;
    float sgn=hash21(cell*3.1+sd+2.9)<0.5?1.0:-1.0;
    float str=1.0+(hash21(cell*5.3+sd+0.7)-0.5)*1.56;
    float R2=mix(4.0,2.4,hash21(cell*7.7+sd+4.1));
    vec2 d=g-c; float r2=dot(d,d);
    float w=max(1.0-r2/R2,0.0); w=w*w*w;
    vel+=vec2(-d.y,d.x)*sgn*str*w/(r2+0.35);
  }
  return vel;
}

float modeScatter(vec2 p){
  const float gs=0.30;
  float sd=uSeed*0.07+1.3;
  vec2 bend=vec2(fbm(p*0.5+sd),fbm(p*0.5+vec2(5.7,1.9)+sd))-0.5;
  vec2 g=(p+bend*1.4)*gs;
  float step=uWarp*0.017;
  for(int it=0;it<7;it++){ g+=scatterVel(g,sd)*step; }
  return fbm((g/gs)*0.8 + uSeed*0.1);
}

float modeFlow(vec2 p){
  vec2 q=vec2(fbm(p+uSeed),fbm(p+vec2(5.2,1.3)+uSeed));
  vec2 r=vec2(fbm(p+uWarp*q+vec2(1.7,9.2)),fbm(p+uWarp*q+vec2(8.3,2.8)));
  return fbm(p+uWarp*r);
}

vec3 palette(float t){
  t=clamp(t,0.,1.);
  if(t<0.25) return mix(uC0,uC1,t/0.25);
  if(t<0.50) return mix(uC1,uC2,(t-0.25)/0.25);
  if(t<0.75) return mix(uC2,uC3,(t-0.50)/0.25);
  return            mix(uC3,uC4,(t-0.75)/0.25);
}

void main(){
  vec2 c=(gl_FragCoord.xy-0.5*uRes)/uRes.y;
  vec2 p=c*uScale+uOffset;

  float h = uMode==0 ? modeFlow(p) : modeScatter(p);

  vec2 g=vec2(dFdx(h),dFdy(h))*uRes.y;
  vec3 n=normalize(vec3(-g*uLight,1.));
  vec2 ld=vec2(cos(uAngle),sin(uAngle));
  float lam=dot(n,normalize(vec3(ld,0.7)))*0.5+0.5;

  float v=h*0.60+lam*0.62;
  v=(v-0.5)*uContrast+0.5;
  v=pow(clamp(v,0.,1.),1./uGamma);

  vec2 q2=vec2(fbm(p+uSeed),fbm(p+vec2(5.2,1.3)+uSeed));
  vec2 r2=vec2(fbm(p+uWarp*q2+vec2(1.7,9.2)),fbm(p+uWarp*q2+vec2(8.3,2.8)));
  float spine=1.-smoothstep(0.,uSpread,abs(c.x));
  float vfade=1.-smoothstep(0.40,0.52,abs(c.y));
  float blob=fbm(p*0.45+r2*0.5+uSeed*1.7)*0.6+spine*0.7;
  blob*=mix(0.55,1.,vfade);
  float mask=smoothstep(uThresh-uSoft,uThresh+uSoft,blob);

  outColor=vec4(max(palette(v)*mask,0.),1.);
}`;

/** Supersample resolve via mip LOD, with grain added at output resolution. */
export const VERT_BLIT = `#version 300 es
out vec2 vUv;
const vec2 v[3]=vec2[3](vec2(-1.,-1.),vec2(3.,-1.),vec2(-1.,3.));
void main(){ vec2 p=v[gl_VertexID]; vUv=p*0.5+0.5; gl_Position=vec4(p,0.,1.); }`;

export const FRAG_BLIT = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uTex;
uniform float uLod;
uniform float uGrain;
float hash21(vec2 p){ p=fract(p*vec2(123.34,345.45)); p+=dot(p,p+34.345); return fract(p.x*p.y); }
void main(){
  vec3 c=textureLod(uTex,vUv,uLod).rgb;
  c+=(hash21(gl_FragCoord.xy)-0.5)*(uGrain*0.02);
  o=vec4(max(c,0.),1.);
}`;
