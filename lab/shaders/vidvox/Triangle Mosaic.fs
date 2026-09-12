/*{
    "CATEGORIES": [
        "Stylize"
    ],
    "CREDIT": "by VIDVOX",
    "DESCRIPTION": "Renders the input as a mesh of jittered triangles and lines.",
    "ISFVSN": "2",
    "INPUTS": [
        {
            "NAME": "inputImage",
            "TYPE": "image"
        },
        {
            "DEFAULT": 0.025,
            "LABEL": "Cell Size",
            "MAX": 0.25,
            "MIN": 0.005,
            "NAME": "cellSize",
            "TYPE": "float"
        },
        {
            "DEFAULT": 0.5,
            "LABEL": "Jitter",
            "MAX": 1.0,
            "MIN": 0.0,
            "NAME": "jitter",
            "TYPE": "float"
        },
        {
            "DEFAULT": 0.0,
            "LABEL": "Seed",
            "MAX": 100.0,
            "MIN": 0.0,
            "NAME": "seed",
            "TYPE": "float"
        },
        {
            "DEFAULT": 1.0,
            "LABEL": "Outline Width",
            "MAX": 5.0,
            "MIN": 0.0,
            "NAME": "outlineWidth",
            "TYPE": "float"
        },
        {
            "DEFAULT": [
                0.0,
                0.0,
                0.0,
                1.0
            ],
            "LABEL": "Outline Color",
            "NAME": "outlineColor",
            "TYPE": "color"
        }
    ]
}*/


//	2D hash returning (0..1, 0..1) per integer-grid input.
//	Standard "iq" sin-based hash; deterministic per input vec2.
vec2 hash2(vec2 p)	{
    p = vec2(dot(p, vec2(127.1, 311.7)),
             dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}


//	Distance from point p to line segment a-b, in the same coordinate space.
float segDist(vec2 p, vec2 a, vec2 b)	{
    vec2  ab = b - a;
    vec2  ap = p - a;
    float t  = clamp(dot(ap, ab) / max(dot(ab, ab), 0.000001), 0.0, 1.0);
    return length(ap - ab * t);
}


void main()	{
    vec2 uv = isf_FragNormCoord;

    //	Cell size in UV space, adjusted so cells render visually square in screen space.
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2  cellUV = vec2(cellSize, cellSize * aspect);

    //	Grid coordinate: which cell we're in + position within that cell (0..1).
    vec2 grid  = uv / cellUV;
    vec2 cell  = floor(grid);
    vec2 local = fract(grid);

    //	Per-vertex jittered offsets for the four cell corners.
    //	Adjacent cells share corners; the hash is purely a function of the
    //	corner's absolute grid coordinate, so the shared vertex agrees on both
    //	sides and triangles don't tear at cell boundaries.
    vec2 j00 = (hash2(cell + vec2(0.0, 0.0) + seed) - 0.5) * jitter;
    vec2 j10 = (hash2(cell + vec2(1.0, 0.0) + seed) - 0.5) * jitter;
    vec2 j01 = (hash2(cell + vec2(0.0, 1.0) + seed) - 0.5) * jitter;
    vec2 j11 = (hash2(cell + vec2(1.0, 1.0) + seed) - 0.5) * jitter;

    vec2 p00 = vec2(0.0, 0.0) + j00;
    vec2 p10 = vec2(1.0, 0.0) + j10;
    vec2 p01 = vec2(0.0, 1.0) + j01;
    vec2 p11 = vec2(1.0, 1.0) + j11;

    //	Each cell is split into two triangles along its main diagonal p10 -> p01.
    //	The 2D cross product of (diagonal) x (point - p10) is positive on the
    //	upper-left side, negative on the lower-right.
    vec2  edge = p01 - p10;
    vec2  toPt = local - p10;
    float side = edge.x * toPt.y - edge.y * toPt.x;

    vec2 va, vb, vc;
    if (side > 0.0)	{
        //	Upper-left triangle: (p00, p10, p01).
        va = p00; vb = p10; vc = p01;
    }
    else	{
        //	Lower-right triangle: (p10, p11, p01).
        va = p10; vb = p11; vc = p01;
    }

    //	Sample the input at the triangle's centroid -> flat-shaded fill.
    //	(local var named triCenter — 'centroid' is a reserved GLSL keyword.)
    vec2 triCenter = (va + vb + vc) / 3.0;
    vec2 sampleUV = (cell + triCenter) * cellUV;
    sampleUV = clamp(sampleUV, vec2(0.0), vec2(1.0));

    vec4 fillColor = IMG_NORM_PIXEL(inputImage, sampleUV);

    //	Optional outline: distance from the current pixel to the nearest
    //	triangle edge, in cell-local UV; convert to screen pixels via cellUV.
    vec3 finalColor = fillColor.rgb;
    if (outlineWidth > 0.0)	{
        float d        = min(min(segDist(local, va, vb),
                                 segDist(local, vb, vc)),
                                 segDist(local, vc, va));
        float dPixels  = d * cellUV.x * RENDERSIZE.x;
        float edgeAA   = 1.0 - smoothstep(outlineWidth * 0.5,
                                          outlineWidth * 0.5 + 1.0,
                                          dPixels);
        finalColor = mix(finalColor, outlineColor.rgb, edgeAA * outlineColor.a);
    }

    gl_FragColor = vec4(finalColor, fillColor.a);
}
