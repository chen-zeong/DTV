export const DTV_CONFIG_KIND = 'dtv-config';
export const DTV_CONFIG_VERSION = 1;

type ConfigSource = {
  appVersion?: string | null;
  client: string;
};

export type PortableConfigEntries = Record<string, string>;

export interface DtvConfigPayload {
  kind: typeof DTV_CONFIG_KIND;
  version: typeof DTV_CONFIG_VERSION;
  exportedAt: string;
  source: ConfigSource;
  entries: PortableConfigEntries;
}

const EXACT_EXPORTABLE_KEYS = new Set<string>([
  'bilibili_cookie',
  'danmu_block_keywords',
  'dtv_custom_categories_v1',
  'dtv_danmu_preferences_v1',
  'dtv_player_danmu_collapsed',
  'dtv_player_volume_v1',
  'followedStreamers',
  'followFolders',
  'followListOrder',
  'theme_preference',
]);

const PORTABLE_PLATFORM_KEYS = ['DOUYU', 'DOUYIN', 'HUYA', 'BILIBILI'] as const;
const EXPORTABLE_KEY_PATTERNS = [
  new RegExp(`^(${PORTABLE_PLATFORM_KEYS.join('|')})_preferred_quality$`),
  new RegExp(`^(${PORTABLE_PLATFORM_KEYS.join('|')})_preferred_line$`),
];

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === 'object' && !Array.isArray(value);
};

export const isExportableStorageKey = (key: string): boolean => {
  if (EXACT_EXPORTABLE_KEYS.has(key)) {
    return true;
  }
  return EXPORTABLE_KEY_PATTERNS.some((pattern) => pattern.test(key));
};

const sortEntries = (entries: PortableConfigEntries): PortableConfigEntries => {
  return Object.keys(entries)
    .sort((left, right) => left.localeCompare(right))
    .reduce<PortableConfigEntries>((result, key) => {
      result[key] = entries[key];
      return result;
    }, {});
};

export const collectPortableConfigEntries = (storage: Storage): PortableConfigEntries => {
  const entries: PortableConfigEntries = {};
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || !isExportableStorageKey(key)) {
      continue;
    }
    const value = storage.getItem(key);
    if (typeof value === 'string') {
      entries[key] = value;
    }
  }
  return sortEntries(entries);
};

export const createPortableConfigPayload = (
  storage: Storage,
  source: Partial<ConfigSource> = {},
): DtvConfigPayload => {
  return {
    kind: DTV_CONFIG_KIND,
    version: DTV_CONFIG_VERSION,
    exportedAt: new Date().toISOString(),
    source: {
      client: source.client ?? 'desktop',
      appVersion: source.appVersion ?? null,
    },
    entries: collectPortableConfigEntries(storage),
  };
};

export const parsePortableConfigPayload = (raw: string): DtvConfigPayload => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Config file is not valid JSON.');
  }

  if (!isRecord(parsed)) {
    throw new Error('Config file format is invalid.');
  }

  if (parsed.kind !== DTV_CONFIG_KIND) {
    throw new Error('This is not a DTV config export.');
  }

  if (parsed.version !== DTV_CONFIG_VERSION) {
    throw new Error(`Unsupported config file version: ${String(parsed.version)}.`);
  }

  if (!isRecord(parsed.source) || typeof parsed.source.client !== 'string' || !parsed.source.client.trim()) {
    throw new Error('Config file source is invalid.');
  }

  if (typeof parsed.exportedAt !== 'string' || Number.isNaN(Date.parse(parsed.exportedAt))) {
    throw new Error('Config file exportedAt is invalid.');
  }

  if (!isRecord(parsed.entries)) {
    throw new Error('Config file entries are missing.');
  }

  const sanitizedEntries: PortableConfigEntries = {};
  Object.entries(parsed.entries).forEach(([key, value]) => {
    if (!isExportableStorageKey(key) || typeof value !== 'string') {
      return;
    }
    sanitizedEntries[key] = value;
  });

  return {
    kind: DTV_CONFIG_KIND,
    version: DTV_CONFIG_VERSION,
    exportedAt: parsed.exportedAt,
    source: {
      client: parsed.source.client,
      appVersion: typeof parsed.source.appVersion === 'string' ? parsed.source.appVersion : null,
    },
    entries: sortEntries(sanitizedEntries),
  };
};

export const replacePortableConfigEntries = (
  storage: Storage,
  entries: PortableConfigEntries,
): void => {
  const keysToClear: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && isExportableStorageKey(key)) {
      keysToClear.push(key);
    }
  }

  keysToClear.forEach((key) => storage.removeItem(key));
  Object.entries(sortEntries(entries)).forEach(([key, value]) => storage.setItem(key, value));
};

const pad = (value: number) => String(value).padStart(2, '0');

export const buildPortableConfigFileName = (now = new Date()): string => {
  const datePart = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const timePart = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `dtv-config-${datePart}-${timePart}.json`;
};
