import { Platform as StreamingPlatform } from '../../platforms/common/types';
import type { LineOption } from './plugins';

const lineOptionsByPlatform: Partial<Record<StreamingPlatform, LineOption[]>> = {
  [StreamingPlatform.DOUYU]: [
    { key: 'ws-h5', label: '主线路' },
    { key: 'tct-h5', label: '线路5' },
    { key: 'ali-h5', label: '线路6' },
    { key: 'hs-h5', label: '线路13' },
  ],
  [StreamingPlatform.HUYA]: [
    { key: 'tx', label: '腾讯线路' },
    { key: 'al', label: '阿里线路' },
    { key: 'hs', label: '字节线路' },
  ],
};

export const getLineOptionsForPlatform = (platform?: StreamingPlatform | null): LineOption[] => {
  if (!platform) {
    return [];
  }
  return lineOptionsByPlatform[platform] ?? [];
};

export const resolveStoredLine = (platform?: StreamingPlatform | null): string | null => {
  const options = getLineOptionsForPlatform(platform);
  if (!options.length) {
    return null;
  }
  if (typeof window === 'undefined' || !platform) {
    return options[0]?.key ?? null;
  }
  try {
    const saved = window.localStorage.getItem(`${platform}_preferred_line`);
    if (saved && options.some((opt) => opt.key === saved)) {
      return saved;
    }
  } catch (error) {
    console.warn('[Player] Failed to read stored line preference:', error);
  }
  return options[0]?.key ?? null;
};

export const persistLinePreference = (platform?: StreamingPlatform | null, lineKey?: string | null) => {
  if (!platform || !lineKey || typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(`${platform}_preferred_line`, lineKey);
  } catch (error) {
    console.warn('[Player] Failed to persist line preference:', error);
  }
};

export const resolveCurrentLineFor = (platform: StreamingPlatform, currentLine: string | null): string | null => {
  const options = getLineOptionsForPlatform(platform);
  if (!options.length) {
    return null;
  }
  if (currentLine && options.some((option) => option.key === currentLine)) {
    return currentLine;
  }
  return options[0]?.key ?? null;
};

export const getLineLabel = (lineOptions: LineOption[], key?: string | null): string => {
  if (!key) {
    return '线路';
  }
  const option = lineOptions.find((item) => item.key === key);
  return option?.label ?? '线路';
};
