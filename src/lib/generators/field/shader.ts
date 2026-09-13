/**
 * One program for every height-field generator: `uField` picks the field,
 * `uDomain` bends the plane first, and the finish (crease lighting, ramp
 * cycles, contrast/gamma) is shared — so a new field is one function here
 * plus a plan.
 */

export { VERT } from "../gradient/shader";

export const FRAG_FIELD = `#version 300 es
precision highp float;
out vec4 outColor;

#define TAU 6.28318530718

uniform vec2  uRes;
uniform vec2  uOffset;
uniform float uSeed;
uniform float uScale;
uniform float uAngle;
uniform float uLight;
uniform float uContrast;
uniform float uGamma;
uniform float uCycles;
uniform vec4  uParams;
uniform int   uField;
uniform int   uDomain;
uniform vec3  uC0,uC1,uC2,uC3,uC4;

float hash21(vec2 p){
  p=fract(p*vec2(123.34,345.45)); p+=dot(p,p+34.345); return fract(p.x*p.y);
}
vec2 hash22(vec2 p){
  return vec2(hash21(p), hash21(p+vec2(17.3,91.7)));
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

// ── domains ──
vec2 bend(vec2 p){
  if(uDomain==1){
    // tunnel: log-polar, three turns around
    float r=length(p)+0.02;
    return vec2(log(r)*1.5, atan(p.y,p.x)*3.0/TAU*2.0);
  }
  if(uDomain==2){
    // six-fold kaleidoscope
    float r=length(p), a=atan(p.y,p.x);
    float sector=TAU/6.0;
    a=mod(a,sector); a=abs(a-sector*0.5);
    return vec2(cos(a),sin(a))*r;
  }
  return p;
}

// ── fields ──
float fieldVoronoi(vec2 p){
  float jitter=uParams.x; int metric=int(uParams.y+0.5); int look=int(uParams.z+0.5);
  p+=(vec2(fbm(p*0.5+uSeed),fbm(p*0.5+vec2(3.1,7.7)+uSeed))-0.5)*uParams.w;
  vec2 n=floor(p), f=fract(p);
  float f1=8., f2=8., soft=0.; vec2 id=vec2(0);
  // 5×5 so the smooth-min below has settled to nothing by the window's edge;
  // a 3×3 leaves a faint grid where cells drop out of the sum
  for(int y=-2;y<=2;y++) for(int x=-2;x<=2;x++){
    vec2 g=vec2(float(x),float(y));
    vec2 o=hash22(n+g+uSeed)*jitter;
    vec2 r=g+o-f;
    float d = metric==1 ? abs(r.x)+abs(r.y) : metric==2 ? max(abs(r.x),abs(r.y)) : dot(r,r);
    if(d<f1){ f2=f1; f1=d; id=n+g; } else if(d<f2){ f2=d; }
    // smooth-min of every distance: blobs with no ridge where the nearest
    // cell changes hands, which is where the crease lighting bites
    soft+=exp2(-8.0*(metric==0?sqrt(d):d));
  }
  if(metric==0){ f1=sqrt(f1); f2=sqrt(f2); }
  if(look==0) return clamp(-log2(soft)/8.0*1.4,0.,1.);
  if(look==1) return clamp((f2-f1)*1.6,0.,1.);
  if(look==2){
    // flat cells: a soft fall-off toward the seam instead of a hard id step,
    // which the derivative lighting would otherwise pick out as a dotted line
    float seam=smoothstep(0.0,0.12,f2-f1);
    float tone=hash21(id*1.3+uSeed);
    return mix(0.15,1.0,seam)*(tone*0.8+0.2)*(1.0-0.25*f1);
  }
  return 0.0;
}

float fieldStripes(vec2 p){
  float freq=uParams.x, warp=uParams.y, hard=uParams.z, ang=uParams.w;
  vec2 dir=vec2(cos(ang),sin(ang));
  float w=(fbm(p*0.7+uSeed)-0.5)*warp;
  float s=sin((dot(p,dir)+w)*freq*TAU);
  s=clamp(s*(1.0+hard*24.0),-1.,1.);
  return s*0.5+0.5;
}

float fieldPlasma(vec2 p){
  float a=uParams.x,b=uParams.y,c=uParams.z,d=uParams.w;
  vec2 c1=vec2(sin(uSeed*0.7),cos(uSeed*1.3))*1.5;
  float v=sin(p.x*a+uSeed)+sin(p.y*b+uSeed*0.5)+sin((p.x+p.y)*c*0.5)+sin(length(p-c1)*d);
  return v*0.125+0.5;
}

float fieldRings(vec2 p){
  int count=int(uParams.x+0.5); float freq=uParams.y, decay=uParams.z, lin=uParams.w;
  float v=0.;
  for(int i=0;i<4;i++){
    if(i>=count) break;
    vec2 c=(hash22(vec2(float(i)*3.7+uSeed, uSeed*0.3))-0.5)*4.0;
    float r=length(p-c);
    v+=sin(r*freq*TAU)*exp(-decay*r);
  }
  v+=lin*sin(p.x*freq*TAU);
  return clamp(v/(float(count)+lin)*0.5+0.5,0.,1.);
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
  vec2 p=bend(c*uScale+uOffset);

  float h = uField==0 ? fieldVoronoi(p)
          : uField==1 ? fieldStripes(p)
          : uField==2 ? fieldPlasma(p)
          : fieldRings(p);

  // flat cells carry their own shading; derivative lighting only adds seams
  float lightAmt = (uField==0 && int(uParams.z+0.5)==2) ? 0.0 : uLight;
  vec2 g=vec2(dFdx(h),dFdy(h))*uRes.y;
  vec3 n=normalize(vec3(-g*lightAmt,1.));
  vec2 ld=vec2(cos(uAngle),sin(uAngle));
  float lam=dot(n,normalize(vec3(ld,0.7)))*0.5+0.5;

  float v=h*0.60+lam*0.62;
  v=(v-0.5)*uContrast+0.5;
  v=pow(clamp(v,0.,1.),1./uGamma);
  // ramp cycles as a triangle wave, so repeats meet without a seam
  v=1.0-abs(fract(v*uCycles*0.5)*2.0-1.0);

  outColor=vec4(max(palette(v),0.),1.);
}`;
