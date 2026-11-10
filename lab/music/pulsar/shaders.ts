import { GLSL_COMMON } from "../../../src/lib/generators/gpu";

const NOISE = `
float hash(vec2 p){
  vec3 q=fract(vec3(p.xyx)*.1031); q+=dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z);
}
float vnoise(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
float fbm(vec2 p){
  float s=0., a=.5;
  for(int i=0;i<4;i++){ s+=a*vnoise(p); p=mat2(1.6,1.2,-1.2,1.6)*p+3.1; a*=.5; }
  return s/.9375;
}
mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,s,-s,c); }
`;

/** One step of the light field: last step's light carried outward, twisted and smeared,
 * under this moment's figure. Light is one HDR channel; colour comes in the post pass. */
export const FEED_FS = `#version 300 es
precision highp float;
#define PI 3.14159265359
uniform sampler2D uPrev;
uniform vec2 uRes;
uniform float uT, uFlow, uRot;
uniform float uScale, uBurst, uFlash, uWarp, uMid, uSpark, uLineW, uLight, uEnergy;
uniform float uFold, uStep, uOrbits, uSpin, uPhase;
uniform float uCore, uRays, uRings, uOrbit, uFractal, uField;
uniform float uKeep, uZoom, uTwist, uSmear;
out vec4 o;
${NOISE}
/** A thin hot line with a soft halo. */
float glow(float d, float w){ return exp(-d*d/(w*w)) + .25*w/(d+w*2.); }
float segment(vec2 p, vec2 a, vec2 b){
  vec2 pa=p-a, ba=b-a;
  return length(pa-ba*clamp(dot(pa,ba)/dot(ba,ba),0.,1.));
}
float ellipse(vec2 p, vec2 ab){
  float k0=length(p/ab), k1=length(p/(ab*ab));
  return abs(k0*(k0-1.)/max(k1,1e-4));
}

float scene(vec2 p){
  vec2 q=p/uScale;
  float r=length(q), a=atan(q.y,q.x);
  vec2 dir=vec2(cos(a),sin(a));
  // Noise in polar terms, read around a circle so it has no seam.
  a+=(fbm(dir*1.3+vec2(log(r+.05)*2.2-uFlow*.6,uPhase))-.5)*uWarp*1.6;
  r*=1.+(fbm(dir*2.+vec2(uPhase,r*3.-uFlow))-.5)*uWarp*.35;
  vec2 wq=r*vec2(cos(a),sin(a));
  float w=1.3*uLineW/(.5*min(uRes.x,uRes.y)*uScale);
  float L=0.;

  float cs=.05+.1*uFlash;
  L+=uCore*(exp(-r*r/(cs*cs))*(.8+2.5*uFlash)+.03*cs/(r+cs));

  float N=uFold;
  float ra=a+uRot*.5*uSpin;
  float id=floor(N*ra/(2.*PI)+.5);
  float len=(.3+.9*uBurst)*(.5+.8*hash(vec2(id,uPhase)));
  float rays=pow(max(cos(N*ra),0.),70.)*exp(-r/len);
  rays+=.5*pow(max(-cos(N*ra),0.),140.)*exp(-r/(len*.5));
  L+=uRays*rays*(.5+uBurst)*smoothstep(0.,.04,r);

  // Three star polygons turning against each other and tipping like wireframes in 3D.
  float wire=0., nodes=0.;
  mat2 stepR=rot(2.*PI/N), jumpR=rot(2.*PI*uStep/N);
  for(int k=0;k<3;k++){
    float fk=float(k);
    float R=(.3+.27*fk)*(1.+.1*uBurst*(fk+1.));
    float turn=uRot*uSpin*(k==1?-1.:1.)*(.4+.25*fk)+uPhase*fk;
    float axis=uPhase+uRot*.3+fk*2.1;
    float tilt=.55+.45*cos(uRot*.7+fk*1.7+uPhase);
    mat2 squash=rot(axis)*mat2(1.,0.,0.,max(tilt,.1))*rot(-axis);
    vec2 c0=rot(turn)*vec2(R,0.);
    float dl=1e3, dn=1e3;
    for(int i=0;i<16;i++){
      if(float(i)>=N) break;
      vec2 A=squash*c0;
      dl=min(dl,segment(wq,A,squash*(jumpR*c0)));
      dn=min(dn,length(wq-A));
      c0=stepR*c0;
    }
    float fade=1.-.25*fk;
    wire+=glow(dl,w)*fade;
    nodes+=glow(dn,w*3.*(1.+uBurst))*fade;
  }
  L+=uRings*(.7*wire+1.5*nodes);

  float orb=0.;
  for(int j=0;j<4;j++){
    if(float(j)>=uOrbits) break;
    float fj=float(j);
    vec2 e=rot(PI*fj/uOrbits+uRot*.25*uSpin+uPhase)*wq;
    float Ro=.55+.1*sin(uPhase*3.+fj);
    vec2 ab=vec2(Ro,Ro*abs(.22+.18*sin(uRot*.6+fj*1.3+uPhase))+.03);
    orb+=glow(ellipse(e,ab),w*.9);
    float phi=uFlow*(1.2+.4*fj)*(j==1||j==3?-1.:1.)+fj*2.;
    orb+=2.*glow(length(e-ab*vec2(cos(phi),sin(phi))),w*4.*(1.+uBurst));
  }
  L+=uOrbit*.8*orb;

  // Kaleidoscopic folding inside one wedge of the symmetry.
  float fa=mod(a+uRot*.2,2.*PI/N)-PI/N;
  vec2 f=r*vec2(cos(fa),abs(sin(fa)));
  float fs=1., fd=1e3;
  mat2 fr=rot(.5+uPhase*.3+uRot*.05);
  for(int i=0;i<5;i++){
    f=fr*(abs(f)-vec2(.28+.08*uMid,.12))*1.45;
    fs*=1.45;
    fd=min(fd,length(vec2(max(abs(f.x)-.5,0.),f.y))/fs);
  }
  L+=uFractal*glow(fd,w*.8)*exp(-r*1.2)*(.4+uMid);

  float streak=fbm(dir*1.7+vec2(log(r+.02)*3.-uFlow*1.4,uPhase*2.));
  L+=uField*3.*pow(streak,4.)*(.25+uEnergy)*exp(-r*.9)*smoothstep(0.,.15,r);

  vec2 cell=floor(p*90.);
  float spark=step(1.-.02*uSpark,hash(cell+floor(uT*24.)*vec2(13.,7.)));
  L+=.8*spark*uSpark*exp(-r*1.5);

  return L*uLight;
}

void main(){
  float side=min(uRes.x,uRes.y);
  vec2 p=(gl_FragCoord.xy-.5*uRes)/(.5*side);
  // Where this pixel's light was a step ago: nearer the centre, so the past drifts out.
  vec2 back=rot(-uTwist)*p/(1.+uZoom);
  back+=(vec2(fbm(back*2.5+uT*.3),fbm(back*2.5-uT*.3+9.))-.5)*uSmear;
  vec2 bu=back*(.5*side/uRes)+.5;
  vec2 inward=(bu-.5)*uZoom*.5;
  float past=0.;
  for(int i=0;i<3;i++) past+=textureLod(uPrev,bu-inward*float(i),0.).r;
  past*=step(abs(bu.x-.5),.5)*step(abs(bu.y-.5),.5)/3.;
  float now=scene(p);
  o=vec4(min(max(past*uKeep,now)+.2*now*uKeep,12.),0.,0.,1.);
}`;

/** Radial blur with the channels pulled apart, bloom from the light field's mips, then
 * the light graded into one of three modes. */
export const POST_FS = `#version 300 es
precision highp float;
${GLSL_COMMON}
uniform sampler2D uFeed;
uniform vec2 uRes;
uniform float uBlur, uChroma, uBloom, uExposure, uMode, uGrain, uT;
out vec4 o;
float at(vec2 uv, float lod){ return textureLod(uFeed,uv,lod).r; }
vec3 blueField(float t){
  t=clamp(t,0.,1.);
  return t<.5?mix(uC2,uC3,t*2.):mix(uC3,uC4,t*2.-1.);
}
vec3 grade(float l){
  return uMode<.5?ramp(l):uMode<1.5?ramp(1.-l):blueField(l);
}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  vec2 d=uv-.5;
  vec3 L=vec3(0.);
  float total=0.;
  for(int i=0;i<12;i++){
    float f=float(i)/11.;
    float s=1.-uBlur*f*.35;
    float wgt=1.-.75*f;
    L+=wgt*vec3(at(.5+d*s*(1.+uChroma),0.),at(.5+d*s,0.),at(.5+d*s*(1.-uChroma),0.));
    total+=wgt;
  }
  L/=total;
  L+=uBloom*(.5*at(uv,2.)+.3*at(uv,4.)+.2*at(uv,6.));
  vec3 l=1.-exp(-L*uExposure);
  vec3 col=vec3(grade(l.r).r,grade(l.g).g,grade(l.b).b);
  if(uMode<.5||uMode>1.5) col*=1.-.6*dot(d,d);
  col+=(hash12(gl_FragCoord.xy+fract(uT)*vec2(311.,97.))-.5)*uGrain;
  o=vec4(col,1.);
}`;
