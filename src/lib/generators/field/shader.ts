/** One program for every height-field generator; `uField` picks the field. */

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
uniform int   uStyle;
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

/** Distance to the nearest cell's centre, and the exact distance to its border (so
 * lines keep one width); the cell goes in id. */
vec2 voronoiBorder(vec2 p, float jitter, out vec2 id){
  vec2 n=floor(p), f=fract(p), mg=vec2(0), mr=vec2(0);
  float md=8.;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec2 g=vec2(float(x),float(y));
    vec2 r=g+hash22(n+g+uSeed)*jitter-f;
    float d=dot(r,r);
    if(d<md){ md=d; mr=r; mg=g; }
  }
  float bd=8.;
  for(int y=-2;y<=2;y++) for(int x=-2;x<=2;x++){
    vec2 g=mg+vec2(float(x),float(y));
    vec2 r=g+hash22(n+g+uSeed)*jitter-f;
    if(dot(mr-r,mr-r)>1e-5) bd=min(bd,dot(0.5*(mr+r),normalize(r-mr)));
  }
  id=n+mg;
  return vec2(sqrt(md),bd);
}

/** Style 1: 0 stained glass, 1 pebbles, 2 veins, 3 blobs. */
float fieldVoronoiArt(vec2 p){
  int look=int(uParams.z+0.5);
  p+=(vec2(fbm(p*0.5+uSeed),fbm(p*0.5+vec2(3.1,7.7)+uSeed))-0.5)*uParams.w;
  vec2 id;
  vec2 v=voronoiBorder(p,uParams.x,id);
  float f1=v.x, bd=v.y;
  float tone=hash21(id*1.3+uSeed);
  float aa=fwidth(bd);
  if(look==0){
    float lead=1.0-smoothstep(0.03,0.03+aa*1.5,bd);
    float dome=1.0-0.3*f1*f1;
    float glass=0.9+0.2*fbm(p*5.0+id);
    float rim=exp(-bd*14.0)*0.18;
    return clamp(((0.3+0.7*tone)*dome*glass+rim)*(1.0-lead),0.,1.);
  }
  if(look==1){
    float e=clamp(bd/0.22,0.,1.);
    return sqrt(1.0-(1.0-e)*(1.0-e))*(0.55+0.45*tone);
  }
  if(look==2){
    float w=0.035+aa;
    float line=exp(-bd*bd/(w*w));
    float halo=exp(-bd*7.0)*0.35;
    return clamp(line+halo+0.1*tone,0.,1.);
  }
  float soft=0.;
  vec2 n=floor(p), f=fract(p);
  for(int y=-2;y<=2;y++) for(int x=-2;x<=2;x++){
    vec2 g=vec2(float(x),float(y));
    soft+=exp2(-8.0*length(g+hash22(n+g+uSeed)*uParams.x-f));
  }
  return clamp(-log2(soft)/8.0*1.4,0.,1.);
}

float fieldVoronoi(vec2 p){
  if(uStyle==1) return fieldVoronoiArt(p);
  float jitter=uParams.x; int metric=int(uParams.y+0.5); int look=int(uParams.z+0.5);
  p+=(vec2(fbm(p*0.5+uSeed),fbm(p*0.5+vec2(3.1,7.7)+uSeed))-0.5)*uParams.w;
  vec2 n=floor(p), f=fract(p);
  float f1=8., f2=8., soft=0.; vec2 id=vec2(0);
  // 5×5 so the smooth-min below has settled by the window's edge; a 3×3 leaves a faint grid.
  for(int y=-2;y<=2;y++) for(int x=-2;x<=2;x++){
    vec2 g=vec2(float(x),float(y));
    vec2 o=hash22(n+g+uSeed)*jitter;
    vec2 r=g+o-f;
    float d = metric==1 ? abs(r.x)+abs(r.y) : metric==2 ? max(abs(r.x),abs(r.y)) : dot(r,r);
    if(d<f1){ f2=f1; f1=d; id=n+g; } else if(d<f2){ f2=d; }
    // smooth-min of every distance: blobs with no ridge where the nearest cell changes hands.
    soft+=exp2(-8.0*(metric==0?sqrt(d):d));
  }
  if(metric==0){ f1=sqrt(f1); f2=sqrt(f2); }
  if(look==0) return clamp(-log2(soft)/8.0*1.4,0.,1.);
  if(look==1) return clamp((f2-f1)*1.6,0.,1.);
  if(look==2){
    // flat cells: a soft fall-off toward the seam instead of a hard id step.
    float seam=smoothstep(0.0,0.12,f2-f1);
    float tone=hash21(id*1.3+uSeed);
    return mix(0.15,1.0,seam)*(tone*0.8+0.2)*(1.0-0.25*f1);
  }
  return 0.0;
}

/** Style 1: satin ribbons, light and dark in turn, each its own tone, meeting in a groove. */
float fieldStripesArt(vec2 p){
  float freq=uParams.x, warp=uParams.y, hard=uParams.z, ang=uParams.w;
  vec2 dir=vec2(cos(ang),sin(ang));
  float ph=(dot(p,dir)+(fbm(p*0.7+uSeed)-0.5)*warp)*freq*2.0;
  float k=floor(ph);
  float edge=min(fract(ph),1.0-fract(ph))*2.0;
  float tone=hash21(vec2(k,uSeed));
  tone=mod(k,2.0)<1.0 ? 0.2+0.25*tone : 0.65+0.35*tone;
  float profile=1.0-pow(1.0-edge,mix(2.0,10.0,hard));
  float h=0.12+profile*(tone-0.12);
  // Too dense to draw: settle on the average rather than shimmer.
  return mix(h,0.45,smoothstep(0.3,0.8,fwidth(ph)));
}

float fieldStripes(vec2 p){
  if(uStyle==1) return fieldStripesArt(p);
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
  float lightAmt = (uField==0 && uStyle==0 && int(uParams.z+0.5)==2) ? 0.0 : uLight;
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
