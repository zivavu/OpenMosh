import { GLSL_COMMON } from "../../src/lib/generators/gpu";

// Every point's place comes from its index and the uniforms alone, with no history
// and no vertex buffer. The same index lands in each form, so a morph flies the points
// across rather than cutting. A point's random spot in the shutter blends two cameras,
// which is motion blur in one draw.
export const POINTS_VS = `#version 300 es
precision highp float;
precision highp int;
${GLSL_COMMON}
uniform mat4 uNow, uPast;
uniform int uFormA, uFormB;
uniform uint uSeed, uSparkleTick;
uniform float uMix, uSwell, uWaveR, uWaveAmp, uTwist, uFar, uWeight;
uniform float uFocus, uDof, uSparkle, uResScale, uSpin, uBend, uDustR;
uniform float uWarp, uWarpFreq, uDust;
uniform vec4 uShapeA, uShapeB;
out float vW;
out float vC;
out float vS;

const float TAU = 6.28318530718;
const float MAX_POINT = 9.0;
const float FAR_BLUR = 5.0;
const float CORE_BOOST = 0.8;
uint st;
float rnd(){ st=pcg(st); return u01(st); }
float grid(float n){ return floor(rnd()*(n+1.))/n*2.-1.; }
vec3 ball(){ return normalize(vec3(rnd(),rnd(),rnd())-.5+1e-4); }

const vec3 MENGER[20]=vec3[20](
  vec3(-1,-1,-1),vec3(0,-1,-1),vec3(1,-1,-1),vec3(-1,0,-1),vec3(1,0,-1),
  vec3(-1,1,-1),vec3(0,1,-1),vec3(1,1,-1),vec3(-1,-1,0),vec3(1,-1,0),
  vec3(-1,1,0),vec3(1,1,0),vec3(-1,-1,1),vec3(0,-1,1),vec3(1,-1,1),
  vec3(-1,0,1),vec3(1,0,1),vec3(-1,1,1),vec3(0,1,1),vec3(1,1,1));

vec4 lattice(){
  const float N=6.;
  vec3 g=vec3(grid(N),grid(N),grid(N));
  float kind=rnd();
  if(kind<.03) return vec4(g+ball()*.006,1.);
  int axis=int(rnd()*3.);
  // Most lines keep to the hull, so the cube reads before its insides.
  if(rnd()<.55) g[(axis+1)%3]=rnd()<.5?-1.:1.;
  if(rnd()<.55) g[(axis+2)%3]=rnd()<.5?-1.:1.;
  g[axis]=rnd()*2.-1.;
  return vec4(g,.3+.35*rnd());
}

vec4 sponge(){
  int axis=int(rnd()*3.);
  vec3 p=vec3(rnd()<.5?-1.:1.,rnd()<.5?-1.:1.,rnd()<.5?-1.:1.);
  p[axis]=rnd()*2.-1.;
  for(int i=0;i<4;i++) p=(p+MENGER[int(rnd()*20.)]*2.)/3.;
  return vec4(p*1.2,.35+.45*rnd());
}

vec4 globe(){
  float a=rnd()*TAU;
  if(rnd()<.16){
    float i=floor(rnd()*3.);
    float r=1.9+i*.45;
    vec3 p=vec3(cos(a),sin(a),0.)*r;
    float tilt=.5+i*.9, c=cos(tilt), s=sin(tilt);
    p=vec3(p.x,p.y*c-p.z*s,p.y*s+p.z*c);
    return vec4(p.y*sin(i)+p.x*cos(i),p.y*cos(i)-p.x*sin(i),p.z,.7);
  }
  vec3 p;
  if(rnd()<.5){
    float lat=(floor(rnd()*9.)+.5)/9.*3.14159265-1.5707963;
    p=vec3(cos(lat)*cos(a),sin(lat),cos(lat)*sin(a));
  } else {
    float lon=floor(rnd()*12.)/12.*TAU;
    p=vec3(cos(a)*cos(lon),sin(a),cos(a)*sin(lon));
  }
  return vec4(p*1.25,.35+.35*rnd());
}

vec4 burst(){
  if(rnd()<.62){
    float i=floor(rnd()*6.);
    float r=.3+pow(rnd(),2.6)*5.;
    float a=i/6.*TAU+.35+uSpin*.35+r*uBend;
    vec3 d=normalize(vec3(cos(a),sin(a),(mod(i,2.)-.5)*.25));
    return vec4(d*r+ball()*.015*(1.+r),.8);
  }
  float r=pow(rnd(),1.2)*2.2;
  return vec4(ball()*r,.4+.35*(1.-r/2.2));
}

vec4 towers(){
  vec3 p=vec3(grid(3.)*.75,0.,grid(2.)*.6);
  if(rnd()<.6){
    p.y=(rnd()*2.-1.)*1.9;
    return vec4(p,.3+.3*rnd());
  }
  p.y=grid(10.)*1.9;
  if(rnd()<.5) p.x=(rnd()*2.-1.)*.75; else p.z=(rnd()*2.-1.)*.6;
  return vec4(p,.6);
}

vec4 helix(){
  float y=rnd()*2.-1.;
  float strand=floor(rnd()*3.)/3.*TAU;
  float a=y*7.+strand+uSpin*.5;
  float r=.65;
  // Rungs join the strands at fixed heights.
  if(rnd()<.18){
    y=floor((y+1.)*9.)/9.-1.;
    a=y*7.+strand+uSpin*.5;
    r*=rnd()*2.-1.;
  }
  return vec4(cos(a)*r,y*1.9,sin(a)*r,.35+.4*rnd());
}

// Gimbals: each ring turns at its own rate, so the shape never repeats.
vec4 rings(){
  float i=floor(rnd()*7.);
  float r=.3+i*.3;
  float a=rnd()*TAU;
  vec3 p=vec3(cos(a)*r,sin(a)*r,0.)+ball()*.008;
  float t=uSpin*(.3+.12*i)+i*1.1, c=cos(t), s=sin(t);
  p=vec3(p.x,p.y*c-p.z*s,p.y*s+p.z*c);
  float u=t*.6+i, cu=cos(u), su=sin(u);
  p=vec3(p.x*cu-p.z*su,p.y,p.x*su+p.z*cu);
  return vec4(p,.35+.4*rnd());
}

vec4 sheet(){
  float u=rnd()*2.-1., v=grid(14.);
  if(rnd()<.5){ float t=u; u=v; v=t; }
  vec2 q=vec2(u,v)*2.2;
  float y=.45*sin(q.x*2.3+uSpin*1.1)*cos(q.y*1.9-uSpin*.7);
  return vec4(q.x,y,q.y,.35+.35*rnd());
}

// A section's own take on a form: copied around into mirrored wedges, then stretched.
vec3 shaped(vec3 p, vec4 s){
  if(s.w>1.5){
    float n=TAU/s.w;
    float a=abs(mod(atan(p.y,p.x),n)-n*.5);
    float flip=rnd()<.5?-1.:1.;
    a=a*flip+floor(rnd()*s.w)*n;
    float r=length(p.xy);
    p.xy=vec2(cos(a),sin(a))*r;
  }
  return p*s.xyz;
}

vec4 form(int k, uint id){
  st=pcg(id^(uint(k+1)*0x9e3779b9u));
  if(k==0) return lattice();
  if(k==1) return sponge();
  if(k==2) return globe();
  if(k==3) return burst();
  if(k==4) return towers();
  if(k==5) return helix();
  if(k==6) return rings();
  return sheet();
}

void main(){
  uint id=uint(gl_VertexID)^uSeed;
  st=pcg(id^0x51ed270bu);
  float shutter=rnd();
  float isFar=rnd();
  vec3 fly=ball();
  float isDust=rnd();
  vec3 dustDir=ball();
  float dustR=rnd();
  vec3 p;
  float c;
  float core=1.;
  if(isFar<uFar){
    // The dim, out-of-focus structure around the main one.
    vec4 f=form(0,id^0x2f6e2b1u);
    p=f.xyz*vec3(5.,5.,7.)+vec3(0.,0.,-2.);
    c=.25;
  } else {
    vec4 a=form(uFormA,id);
    a.xyz=shaped(a.xyz,uShapeA);
    vec4 b=a;
    if(uMix>0.){
      b=form(uFormB,id);
      b.xyz=shaped(b.xyz,uShapeB);
    }
    p=mix(a.xyz,b.xyz,uMix)+fly*sin(uMix*3.14159265)*.7;
    c=mix(a.w,b.w,uMix);
    // Fine dust fills the middle of every form, where the lines alone leave it dark.
    if(isDust<uDust){
      p=dustDir*pow(dustR,.8)*uDustR;
      // Spins fastest at the middle, so the core swirls instead of sitting still.
      float spin=uSpin/(.35+length(p)), sc=cos(spin), ss=sin(spin);
      p.xz=vec2(p.x*sc-p.z*ss,p.x*ss+p.z*sc);
      c=.7;
    }
    // Rolling through space bends every form, so none of them moves as a rigid body.
    p+=sin(p.yzx*uWarpFreq+uSpin)*uWarp;
    float tw=uTwist*p.y, tc=cos(tw), ts=sin(tw);
    p.xz=vec2(p.x*tc-p.z*ts,p.x*ts+p.z*tc);
    float d=length(p)-uWaveR;
    p*=1.+uSwell+uWaveAmp*exp(-d*d*9.);
    core=.6+CORE_BOOST*exp(-dot(p,p)*2.5);
  }
  vec4 clip=mix(uNow*vec4(p,1.),uPast*vec4(p,1.),shutter);
  gl_Position=clip;

  float coc=abs(1./max(clip.w,.05)-1./uFocus)*uDof*uResScale;
  if(isFar<uFar) coc+=FAR_BLUR*uResScale;
  float size=clamp(1.+coc,1.,MAX_POINT);
  gl_PointSize=size;
  float w=uWeight*core/(size*size);
  if(u01(pcg(id^(uSparkleTick*2654435761u)))<uSparkle) w*=30.;
  vW=w;
  vC=c;
  vS=size;
}`;

export const POINTS_FS = `#version 300 es
precision highp float;
in float vW;
in float vC;
in float vS;
out vec4 o;
void main(){
  float f=1.;
  if(vS>1.5){
    vec2 q=gl_PointCoord*2.-1.;
    f=(1.-dot(q,q))*1.6;
    if(f<=0.) discard;
  }
  float w=vW*f;
  o=vec4(w,w*vC,0.,0.);
}`;

/** Fixed exposure rather than the attractor's peak scaling, or a loud frame's extra
 * light would be normalized straight back out. */
export const HDR_FS = `#version 300 es
precision highp float;
${GLSL_COMMON}
uniform sampler2D uDens;
uniform float uExposure;
out vec4 o;
const float CLAMP=16.;
void main(){
  vec2 d=texelFetch(uDens,ivec2(gl_FragCoord.xy),0).rg;
  o=vec4(0.,0.,0.,1.);
  if(d.r<=0.) return;
  float I=min(d.r*uExposure,CLAMP);
  // Lines stay in the ramp's saturated middle; only real pile-ups climb to its white.
  float hot=smoothstep(3.,16.,I);
  o.rgb=ramp(.3+.7*mix(d.g/d.r*.6,1.,hot))*I;
}`;

export const BRIGHT_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uRes;
uniform float uThreshold;
out vec4 o;
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  vec3 c=textureLod(uSrc,uv,1.).rgb;
  float l=max(c.r,max(c.g,c.b));
  // None from the middle: a glint there is the flare the arc knot replaces.
  float keep=smoothstep(.04,.2,length((uv-.5)*vec2(uRes.x/uRes.y,1.)));
  o=vec4(c*keep*max(l-uThreshold,0.)/max(l,1e-4),1.);
}`;

/** One iteration of Kawase's light streak; three, each four times longer, reach far
 * for few taps. */
export const STREAK_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uRes, uStep;
uniform float uFade;
out vec4 o;
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  vec3 c=vec3(0.);
  float total=0.;
  for(int s=-3;s<=3;s++){
    float w=pow(uFade,float(abs(s)));
    c+=w*texture(uSrc,uv+uStep*float(s)).rgb;
    total+=w;
  }
  o=vec4(c/total,1.);
}`;

export const COPY_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uRes;
out vec4 o;
void main(){ o=vec4(texture(uSrc,gl_FragCoord.xy/uRes).rgb,1.); }`;

export const COMPOSITE_FS = `#version 300 es
precision highp float;
uniform sampler2D uHdr, uStar;
uniform vec2 uRes;
uniform float uBloom, uGlint;
uniform vec3 uTint;
out vec4 o;
// Glow takes the ramp's colour: lit by white-hot pixels, it would grey the whole frame.
vec3 tinted(vec3 c){ return uTint*max(c.r,max(c.g,c.b)); }
vec3 mip(vec2 uv,float lod){
  vec2 px=exp2(lod)/uRes*.5;
  return (textureLod(uHdr,uv+px*vec2(1.,1.),lod).rgb+textureLod(uHdr,uv+px*vec2(-1.,1.),lod).rgb
    +textureLod(uHdr,uv+px*vec2(1.,-1.),lod).rgb+textureLod(uHdr,uv+px*vec2(-1.,-1.),lod).rgb)*.25;
}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  vec3 c=texelFetch(uHdr,ivec2(gl_FragCoord.xy),0).rgb;
  vec3 b=mip(uv,1.)*.5+mip(uv,2.)*.7+mip(uv,3.)*.9+mip(uv,4.)*1.1+mip(uv,5.)*1.3;
  // The middle's bloom would melt the arc knot into a ball.
  b*=mix(.15,1.,smoothstep(.04,.3,length((uv-.5)*vec2(uRes.x/uRes.y,1.))));
  o=vec4(c+tinted(b)*uBloom+tinted(texture(uStar,uv).rgb)*uGlint,1.);
}`;

export const PRESENT_FS = `#version 300 es
precision highp float;
uniform sampler2D uComp;
uniform vec2 uRes;
uniform float uZoom, uFocusBlur, uGamma;
out vec4 o;
float noise(vec2 p){
  vec3 q=fract(vec3(p.xyx)*.1031); q+=dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z);
}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  float r=length(uv-.5)*1.414;
  float lod=uFocusBlur*smoothstep(.15,1.,r);
  float jitter=noise(gl_FragCoord.xy);
  vec3 c=vec3(0.);
  for(int i=0;i<8;i++){
    float k=(float(i)+jitter)/8.;
    c+=textureLod(uComp,.5+(uv-.5)*(1.-uZoom*k*r),lod).rgb;
  }
  c*=.125*(1.-.55*r*r);
  // Compressed by the brightest channel so hue survives, then blown out only at the top.
  float peak=max(c.r,max(c.g,c.b));
  c*=(1.-exp(-peak))/max(peak,1e-4);
  c=mix(c,vec3(1.),smoothstep(1.5,9.,peak)*.9);
  c=pow(c,vec3(1./uGamma));
  o=vec4(c+(jitter-.5)/255.,1.);
}`;

export const ARC_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
layout(location=1) in float aAcross;
layout(location=2) in float aWidth;
layout(location=3) in float aHalo;
layout(location=4) in float aHeat;
out float vAcross;
out float vWidth;
out float vHalo;
out float vHeat;
void main(){
  vAcross=aAcross;
  vWidth=aWidth;
  vHalo=aHalo;
  vHeat=aHeat;
  gl_Position=vec4(aPos,0.,1.);
}`;

/** The profile arcDrawer got from blurring each stroke, worked out per pixel: a hard
 * core with a soft halo. */
export const ARC_FS = `#version 300 es
precision highp float;
${GLSL_COMMON}
in float vAcross;
in float vWidth;
in float vHalo;
in float vHeat;
out vec4 o;
void main(){
  float d=abs(vAcross);
  float core=1.-smoothstep(vWidth-.75,vWidth+.75,d);
  float halo=exp(-d*d/(2.*vHalo*vHalo));
  vec3 c=ramp(.62)*halo*.28+mix(ramp(.8),vec3(1.),.7)*core;
  o=vec4(c*vHeat,1.);
}`;
