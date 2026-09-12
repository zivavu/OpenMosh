/*{
    "CATEGORIES": [
        "Color Effect",
        "Distortion"
    ],
    "CREDIT": "by VIDVOX",
    "DESCRIPTION": "Radial lens-style chromatic aberration: red and blue channels are displaced along the line from a chromatic center.",
    "ISFVSN": "2",
    "INPUTS": [
        {
            "NAME": "inputImage",
            "TYPE": "image"
        },
        {
            "DEFAULT": 0.02,
            "LABEL": "Amount",
            "MAX": 0.2,
            "MIN": 0.0,
            "NAME": "amount",
            "TYPE": "float"
        },
        {
            "DEFAULT": 2.0,
            "LABEL": "Falloff",
            "MAX": 4.0,
            "MIN": 1.0,
            "NAME": "falloff",
            "TYPE": "float"
        },
        {
            "DEFAULT": 0.0,
            "LABEL": "Red / Blue Balance",
            "MAX": 1.0,
            "MIN": -1.0,
            "NAME": "balance",
            "TYPE": "float"
        },
        {
            "DEFAULT": [
                0.5,
                0.5
            ],
            "LABEL": "Center",
            "MAX": [
                1.0,
                1.0
            ],
            "MIN": [
                0.0,
                0.0
            ],
            "NAME": "center",
            "TYPE": "point2D"
        },
        {
            "DEFAULT": 0,
            "LABEL": "Direction",
            "LABELS": [
                "Outward (lens-style)",
                "Inward (inverted)"
            ],
            "NAME": "direction",
            "TYPE": "long",
            "VALUES": [
                0,
                1
            ]
        }
    ]
}*/


void main()	{
	vec2 uv         = isf_FragNormCoord;
	vec2 fromCenter = uv - center;
	
	//	Radius from chromatic center, normalized so the vertical edge midpoint
	//	sits at scale = 1; corners of wide-aspect frames intentionally exceed
	//	1.0, which matches how real lenses behave (more fringing in corners).
	float r     = length(fromCenter);
	float scale = pow(r * 2.0, falloff);
	
	//	Per-channel displacement.
	//	balance > 0  →  red moves more than blue
	//	balance < 0  →  blue moves more than red
	//	balance = 0  →  symmetric
	float redAmt  = amount * (1.0 + balance);
	float blueAmt = amount * (1.0 - balance);
	
	//	Outward (default): red samples farther from center, blue samples closer.
	//	Inward: swap, for a stylized "inverse lens" look.
	float dirSign = (direction == 0) ? 1.0 : -1.0;
	
	vec2 redOffset  = fromCenter * ( scale * redAmt  * dirSign);
	vec2 blueOffset = fromCenter * (-scale * blueAmt * dirSign);
	
	vec2 redUV   = uv + redOffset;
	vec2 greenUV = uv;
	vec2 blueUV  = uv + blueOffset;
	
	//	Three independent samples, one per channel.
	vec4 greenSample = IMG_NORM_PIXEL(inputImage, greenUV);
	float r_chan = IMG_NORM_PIXEL(inputImage, redUV ).r;
	float g_chan = greenSample.g;
	float b_chan = IMG_NORM_PIXEL(inputImage, blueUV).b;
	
	gl_FragColor = vec4(r_chan, g_chan, b_chan, greenSample.a);
}
