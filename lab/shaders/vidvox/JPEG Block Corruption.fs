/*{
    "CATEGORIES": [
        "Glitch",
        "Stylize"
    ],
    "CREDIT": "by VIDVOX",
    "DESCRIPTION": "Simulates the visual artifacts of an over-compressed or partially-corrupted JPEG.",
    "ISFVSN": "2",
    "INPUTS": [
        {
            "NAME": "inputImage",
            "TYPE": "image"
        },
        {
            "DEFAULT": 8.0,
            "LABEL": "Block Size (px)",
            "MAX": 64.0,
            "MIN": 2.0,
            "NAME": "blockSize",
            "TYPE": "float"
        },
        {
            "DEFAULT": 0.5,
            "LABEL": "Quantize (Flatten)",
            "MAX": 1.0,
            "MIN": 0.0,
            "NAME": "quantize",
            "TYPE": "float"
        },
        {
            "DEFAULT": 2.0,
            "LABEL": "Chroma Subsample",
            "MAX": 4.0,
            "MIN": 1.0,
            "NAME": "chromaSubsample",
            "TYPE": "float"
        },
        {
            "DEFAULT": 0.0,
            "LABEL": "DC Corruption",
            "MAX": 0.5,
            "MIN": 0.0,
            "NAME": "dcCorrupt",
            "TYPE": "float"
        },
        {
            "DEFAULT": 0.0,
            "LABEL": "Block Displace",
            "MAX": 1.0,
            "MIN": 0.0,
            "NAME": "blockDisplace",
            "TYPE": "float"
        },
        {
            "DEFAULT": 0.0,
            "LABEL": "Seed",
            "MAX": 100.0,
            "MIN": 0.0,
            "NAME": "seed",
            "TYPE": "float"
        }
    ]
}*/


//	2D hash returning (0..1, 0..1) per integer-grid input.
vec2 hash2(vec2 p)	{
	p = vec2(dot(p, vec2(127.1, 311.7)),
			 dot(p, vec2(269.5, 183.3)));
	return fract(sin(p) * 43758.5453);
}


void main()	{
	vec2  uv         = isf_FragNormCoord;
	vec2  pixelUV    = vec2(1.0) / RENDERSIZE;
	
	//	Luma block grid (8x8 by default).
	float lumaPx          = max(blockSize, 1.0);
	vec2  lumaBlockUV     = vec2(lumaPx) * pixelUV;
	vec2  lumaBlockCoord  = floor(uv / lumaBlockUV);
	vec2  lumaBlockCenter = (lumaBlockCoord + 0.5) * lumaBlockUV;
	
	//	Chroma block grid (typically 2x bigger per axis, mimicking 4:2:0 subsampling).
	float chromaPx          = lumaPx * max(chromaSubsample, 1.0);
	vec2  chromaBlockUV     = vec2(chromaPx) * pixelUV;
	vec2  chromaBlockCoord  = floor(uv / chromaBlockUV);
	vec2  chromaBlockCenter = (chromaBlockCoord + 0.5) * chromaBlockUV;
	
	//	Per-luma-block hash drives displacement and DC corruption.
	//	Shared vertex of seed offset means animating seed wanders the pattern.
	vec2 h = hash2(lumaBlockCoord + seed);
	
	//	Block displacement: each block samples from a different location,
	//	up to ±1 block in each axis. Same displacement applies to luma + chroma
	//	so we preserve the block's color identity, just move it spatially.
	vec2 displace = (h - 0.5) * 2.0 * blockDisplace * lumaBlockUV;
	
	//	Quantize: blend between full-resolution UV (no flattening) and
	//	block-center UV (DC-only flat block).
	vec2 lumaSampleUV   = mix(uv + displace, lumaBlockCenter   + displace, quantize);
	vec2 chromaSampleUV = mix(uv + displace, chromaBlockCenter + displace, quantize);
	
	//	Two samples — one for luma, one for chroma.
	vec4 lumaSrc   = IMG_NORM_PIXEL(inputImage, lumaSampleUV);
	vec4 chromaSrc = IMG_NORM_PIXEL(inputImage, chromaSampleUV);
	
	//	RGB -> Y from luma sample, Cb/Cr from chroma sample (BT.601 coefficients).
	//	The two samples can come from different positions when chromaSubsample > 1
	//	or blockDisplace > 0, which is what produces JPEG-style color bleed.
	float Y      = dot(lumaSrc.rgb,   vec3(0.299, 0.587, 0.114));
	float Y_chr  = dot(chromaSrc.rgb, vec3(0.299, 0.587, 0.114));
	float Cb     = (chromaSrc.b - Y_chr) * 0.564;
	float Cr     = (chromaSrc.r - Y_chr) * 0.713;
	
	//	Per-block DC corruption: shift the luminance up or down by a fraction
	//	determined by the block's hash. This is the "wrong AC=0 coefficient"
	//	artifact you see in deliberately mangled JPEG files.
	Y += (h.y - 0.5) * 2.0 * dcCorrupt;
	
	//	YCbCr -> RGB.
	float R = Y + 1.402 * Cr;
	float G = Y - 0.344 * Cb - 0.714 * Cr;
	float B = Y + 1.772 * Cb;
	
	gl_FragColor = vec4(R, G, B, lumaSrc.a);
}
