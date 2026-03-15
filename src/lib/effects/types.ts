export function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export interface RangeParam {
  key: string;
  label: string;
  type: "range";
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  moshMin?: number;
  moshMax?: number;
  visibleWhen?: (values: Record<string, number | string>) => boolean;
}

export interface SelectParam {
  key: string;
  label: string;
  type: "select";
  defaultValue: string;
  options: { label: string; value: string }[];
  visibleWhen?: (values: Record<string, number | string>) => boolean;
}

export interface CheckboxParam {
  key: string;
  label: string;
  type: "checkbox";
  defaultValue: number;
  visibleWhen?: (values: Record<string, number | string>) => boolean;
}

export type EffectParam = RangeParam | SelectParam | CheckboxParam;

export interface EffectDefinition {
  id: string;
  name: string;
  params: EffectParam[];
}

/** When set, this range param is driven by music volume in [min, max]. */
export interface VolumeLink {
  min: number;
  max: number;
  /** Optional frequency range in Hz; when set, level is from this band only. */
  freqMin?: number;
  freqMax?: number;
  /** When true, lower volume produces higher effect value. */
  inverted?: boolean;
}

/** Frequency presets (Hz) for volume links. */
export const FREQ_PRESETS = {
  full: null as { min: number; max: number } | null,
  low: { min: 20, max: 500 },
  mid: { min: 500, max: 4000 },
  high: { min: 4000, max: 20000 },
} as const;

export interface EffectInstance {
  instanceId: string;
  defId: string;
  enabled: boolean;
  locked: boolean;
  expanded: boolean;
  values: Record<string, number | string>;
  /** For range params: key = param key, value = range (min/max) volume maps to. */
  volumeLinks?: Record<string, VolumeLink>;
}

export interface Preset {
  name: string;
  effects: {
    defId: string;
    enabled: boolean;
    values: Record<string, number | string>;
    volumeLinks?: Record<string, VolumeLink>;
  }[];
}
