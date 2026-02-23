export interface RangeParam {
  key: string;
  label: string;
  type: 'range';
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  moshMin?: number;
  moshMax?: number;
}

export interface SelectParam {
  key: string;
  label: string;
  type: 'select';
  defaultValue: string;
  options: { label: string; value: string }[];
}

export type EffectParam = RangeParam | SelectParam;

export interface EffectDefinition {
  id: string;
  name: string;
  params: EffectParam[];
}

export interface EffectInstance {
  instanceId: string;
  defId: string;
  enabled: boolean;
  locked: boolean;
  expanded: boolean;
  values: Record<string, number | string>;
}

export const EFFECT_DEFINITIONS: EffectDefinition[] = [
  {
    id: 'pixelate',
    name: 'Pixelate',
    params: [
      { key: 'size', label: 'Size', type: 'range', min: 1, max: 100, step: 1, defaultValue: 10 },
    ],
  },
  {
    id: 'posterize',
    name: 'Posterize',
    params: [
      { key: 'levels', label: 'Levels', type: 'range', min: 2, max: 32, step: 1, defaultValue: 8 },
    ],
  },
  {
    id: 'solarize',
    name: 'Solarize',
    params: [
      { key: 'threshold', label: 'Threshold', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
    ],
  },
  {
    id: 'edges',
    name: 'Edges',
    params: [
      { key: 'strength', label: 'Strength', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
      { key: 'mix', label: 'Mix', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 1 },
    ],
  },
  {
    id: 'bleach',
    name: 'Bleach',
    params: [
      { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
    ],
  },
  {
    id: 'sharpen',
    name: 'Sharpen',
    params: [
      { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
    ],
  },
  {
    id: 'mirror',
    name: 'Mirror',
    params: [
      { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 1 },
      { key: 'side', label: 'Side', type: 'range', min: 0, max: 3, step: 1, defaultValue: 0 },
      { key: 'position', label: 'Position', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
    ],
  },
  {
    id: 'kaleido',
    name: 'Kaleido',
    params: [
      { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 1 },
      { key: 'sides', label: 'Sides', type: 'range', min: 2, max: 12, step: 1, defaultValue: 6 },
      { key: 'angle', label: 'Angle', type: 'range', min: 0, max: 360, step: 1, defaultValue: 0 },
    ],
  },
  {
    id: 'rgb-shift',
    name: 'RGB Shift',
    params: [
      { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 50, step: 1, defaultValue: 10 },
      { key: 'angle', label: 'Angle', type: 'range', min: 0, max: 360, step: 1, defaultValue: 0 },
    ],
  },
  {
    id: 'color-correction',
    name: 'Color Correction',
    params: [
      { key: 'brightness', label: 'Brightness', type: 'range', min: -1, max: 1, step: 0.01, defaultValue: 0, moshMin: -0.3 },
      { key: 'contrast', label: 'Contrast', type: 'range', min: -1, max: 1, step: 0.01, defaultValue: 0 },
      { key: 'hue', label: 'Hue', type: 'range', min: -180, max: 180, step: 1, defaultValue: 0 },
      { key: 'saturation', label: 'Saturation', type: 'range', min: -1, max: 1, step: 0.01, defaultValue: 0 },
    ],
  },
  {
    id: 'vignette',
    name: 'Vignette',
    params: [
      { key: 'size', label: 'Size', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
      { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
    ],
  },
  {
    id: 'scanlines',
    name: 'Scanlines',
    params: [
      { key: 'count', label: 'Count', type: 'range', min: 1, max: 500, step: 1, defaultValue: 100 },
      { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
    ],
  },
  {
    id: 'bulge',
    name: 'Bulge',
    params: [
      { key: 'amount', label: 'Amount', type: 'range', min: -1, max: 1, step: 0.01, defaultValue: 0.5 },
      { key: 'radius', label: 'Radius', type: 'range', min: 0.01, max: 1, step: 0.01, defaultValue: 0.5 },
    ],
  },
  {
    id: 'jitter',
    name: 'Jitter',
    params: [
      { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 100, step: 1, defaultValue: 20 },
      { key: 'seed', label: 'Seed', type: 'range', min: 0, max: 1000, step: 1, defaultValue: 0 },
      { key: 'speed', label: 'Speed', type: 'range', min: 0.1, max: 5, step: 0.1, defaultValue: 1 },
    ],
  },
  {
    id: 'wobble',
    name: 'Wobble',
    params: [
      { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 100, step: 1, defaultValue: 20 },
      { key: 'frequency', label: 'Frequency', type: 'range', min: 1, max: 20, step: 0.1, defaultValue: 5 },
    ],
  },
  {
    id: 'slices',
    name: 'Slices',
    params: [
      { key: 'count', label: 'Count', type: 'range', min: 1, max: 50, step: 1, defaultValue: 10 },
      { key: 'offset', label: 'Offset', type: 'range', min: 0, max: 100, step: 1, defaultValue: 20 },
      {
        key: 'direction',
        label: 'Direction',
        type: 'select',
        defaultValue: 'horizontal',
        options: [
          { label: 'Horizontal', value: 'horizontal' },
          { label: 'Vertical', value: 'vertical' },
        ],
      },
    ],
  },
  {
    id: 'shake',
    name: 'Shake',
    params: [
      { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 50, step: 1, defaultValue: 10 },
    ],
  },
  {
    id: 'glow',
    name: 'Glow',
    params: [
      { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 2, step: 0.01, defaultValue: 0.5 },
      { key: 'cutoff', label: 'Cutoff', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
    ],
  },
  {
    id: 'soft-glitch',
    name: 'Soft Glitch',
    params: [
      { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 100, step: 1, defaultValue: 30 },
      { key: 'speed', label: 'Speed', type: 'range', min: 0.1, max: 5, step: 0.1, defaultValue: 1 },
    ],
  },
  {
    id: 'hard-glitch',
    name: 'Hard Glitch',
    params: [
      { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 200, step: 1, defaultValue: 50 },
      { key: 'scale', label: 'Scale', type: 'range', min: 0.1, max: 2, step: 0.1, defaultValue: 1 },
      { key: 'speed', label: 'Speed', type: 'range', min: 0.1, max: 5, step: 0.1, defaultValue: 1 },
    ],
  },
  {
    id: 'optical-flow',
    name: 'Optical Flow',
    params: [
      { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.65 },
      { key: 'distortion', label: 'Distortion', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
      { key: 'speed', label: 'Speed', type: 'range', min: 0.1, max: 5, step: 0.1, defaultValue: 0.5 },
    ],
  },
  {
    id: 'feedback',
    name: 'Feedback',
    params: [
      { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.64 },
      { key: 'scale', label: 'Scale', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
      { key: 'rotate', label: 'Rotate', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
      { key: 'warp', label: 'Warp', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
      { key: 'hueShift', label: 'Hue Shift', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.39 },
    ],
  },
  {
    id: 'vhs',
    name: 'VHS',
    params: [
      { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
      { key: 'speed', label: 'Speed', type: 'range', min: 0.1, max: 5, step: 0.1, defaultValue: 1 },
      { key: 'tracking', label: 'Tracking', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
    ],
  },
  {
    id: 'duotone',
    name: 'Duotone',
    params: [
      { key: 'shadowHue', label: 'Shadow Hue', type: 'range', min: 0, max: 360, step: 1, defaultValue: 220 },
      { key: 'highlightHue', label: 'Highlight Hue', type: 'range', min: 0, max: 360, step: 1, defaultValue: 40 },
      { key: 'intensity', label: 'Intensity', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 1 },
    ],
  },
  {
    id: 'chromatic-aberration',
    name: 'Chromatic Aberration',
    params: [
      { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.3 },
      { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
    ],
  },
  {
    id: 'static',
    name: 'Static',
    params: [
      { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.3 },
      { key: 'size', label: 'Size', type: 'range', min: 1, max: 10, step: 1, defaultValue: 1 },
    ],
  },
  {
    id: 'grain',
    name: 'Grain',
    params: [
      { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.3 },
      { key: 'size', label: 'Size', type: 'range', min: 0.5, max: 3, step: 0.1, defaultValue: 1 },
    ],
  },
  {
    id: 'polar',
    name: 'Polar',
    params: [
      { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 1 },
      { key: 'angle', label: 'Angle', type: 'range', min: 0, max: 360, step: 1, defaultValue: 0 },
    ],
  },
  {
    id: 'tile',
    name: 'Tile',
    params: [
      { key: 'size', label: 'Size', type: 'range', min: 1, max: 10, step: 0.1, defaultValue: 2 },
      { key: 'offset', label: 'Offset', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0 },
    ],
  },
];

export function createEffectInstance(def: EffectDefinition): EffectInstance {
  return {
    instanceId: crypto.randomUUID(),
    defId: def.id,
    enabled: false,
    locked: false,
    expanded: false,
    values: Object.fromEntries(def.params.map((p) => [p.key, p.defaultValue])),
  };
}

export function getDefinition(defId: string): EffectDefinition | undefined {
  return EFFECT_DEFINITIONS.find((d) => d.id === defId);
}
