import {KLIPY_API_BASE_URL, KLIPY_API_KEY} from '../../config/klipy';

export type KlipyMediaType = 'gif' | 'sticker';

export type KlipyItem = {
  id: string;
  title: string;
  url: string;
  preview: string;
};

type KlipyRecord = Record<string, any>;

export async function searchKlipy(query: string, type: KlipyMediaType, limit = 30): Promise<KlipyItem[]> {
  const params = new URLSearchParams({
    key: KLIPY_API_KEY,
    limit: String(limit),
    locale: 'vi_VN',
    contentfilter: 'medium',
  });
  if (type === 'sticker') {
    params.set('searchfilter', 'sticker');
  }
  const cleanQuery = query.trim();
  const endpoint = cleanQuery ? 'search' : 'featured';
  if (cleanQuery) {
    params.set('q', cleanQuery);
  }
  const response = await fetch(`${KLIPY_API_BASE_URL}/${endpoint}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Không tải được ${type === 'sticker' ? 'sticker' : 'GIF'} từ KLIPY.`);
  }
  const payload = await response.json() as KlipyRecord;
  const source = klipyResults(payload);
  return source.map(item => {
    const url = mediaUrl(item);
    const preview = previewUrl(item) ?? url;
    return url ? {
      id: String(item.id ?? url),
      title: String(item.title ?? item.content_description ?? (type === 'sticker' ? 'Sticker' : 'GIF')),
      url,
      preview: preview ?? url,
    } : undefined;
  }).filter((item): item is KlipyItem => Boolean(item));
}

function klipyResults(payload: KlipyRecord): KlipyRecord[] {
  const candidates = [payload.results, payload.data, payload.data?.data, payload.data?.results];
  return candidates.find(Array.isArray) ?? [];
}

function mediaUrl(item: KlipyRecord): string | undefined {
  const formats = item.media_formats ?? item.media ?? {};
  return firstUrl(
    formats.gif,
    formats.mediumgif,
    formats.tinygif,
    formats.nanogif,
    formats.webp,
    item.url,
    item.gif_url,
    item.image_url,
  );
}

function previewUrl(item: KlipyRecord): string | undefined {
  const formats = item.media_formats ?? item.media ?? {};
  return firstUrl(formats.tinygif, formats.nanogif, formats.webp, formats.gif);
}

function firstUrl(...values: any[]): string | undefined {
  for (const value of values) {
    const candidate = Array.isArray(value) ? value[0]?.url : typeof value === 'object' ? value?.url : value;
    if (typeof candidate === 'string' && /^https?:\/\//i.test(candidate)) {
      return candidate;
    }
  }
  return undefined;
}
