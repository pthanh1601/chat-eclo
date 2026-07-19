import {Buffer} from 'buffer';
import crypto from 'react-native-quick-crypto';
import RNFS from 'react-native-fs';

type EncryptedMediaSource = {
  url?: string;
  key: {k: string};
  iv: string;
  hashes: {sha256: string};
};

export type MatrixMediaDescriptor = {
  mediaUrl?: string;
  mediaHeaders?: Record<string, string>;
  mediaSourceJson?: string;
  mediaFileName?: string;
  mediaMimeType?: string;
};

const inFlightDecryptions = new Map<string, Promise<string>>();

function base64ToBuffer(base64: string): Buffer {
  const standardBase64 = base64.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(standardBase64, 'base64');
}

function normalizedBase64(base64: string): string {
  return base64.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function encryptedSourceFromJson(mediaSourceJson?: string): EncryptedMediaSource | undefined {
  if (!mediaSourceJson) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(mediaSourceJson) as unknown;
    const candidate = isRecord(parsed) && isRecord(parsed.file) ? parsed.file : parsed;
    if (!isRecord(candidate) || !isRecord(candidate.key) || !isRecord(candidate.hashes)) {
      return undefined;
    }
    const key = candidate.key.k;
    const iv = candidate.iv;
    const sha256 = candidate.hashes.sha256;
    if (typeof key !== 'string' || typeof iv !== 'string' || typeof sha256 !== 'string') {
      return undefined;
    }
    return {
      url: typeof candidate.url === 'string' ? candidate.url : undefined,
      key: {k: key},
      iv,
      hashes: {sha256},
    };
  } catch {
    // Plain MXC sources are commonly stored as a non-JSON string.
    return undefined;
  }
}

export function isEncryptedMatrixMediaSource(mediaSourceJson?: string): boolean {
  return Boolean(encryptedSourceFromJson(mediaSourceJson));
}

export async function resolveMatrixMediaUri(item: MatrixMediaDescriptor): Promise<string> {
  const url = item.mediaUrl;
  if (!url) {
    throw new Error('Không tìm thấy địa chỉ nội dung đính kèm.');
  }
  // The native Matrix SDK returns decrypted media as a local file. Never run it
  // through the JS decryptor a second time.
  if (url.startsWith('file://') || !isEncryptedMatrixMediaSource(item.mediaSourceJson)) {
    return url;
  }
  return decryptMatrixMedia(
    url,
    item.mediaSourceJson!,
    item.mediaHeaders ?? {},
    item.mediaFileName ?? 'image',
    item.mediaMimeType,
  );
}

export async function decryptMatrixMedia(
  url: string,
  mediaSourceJson: string,
  headers: Record<string, string>,
  fileName: string,
  mimeType?: string,
): Promise<string> {
  if (url.startsWith('file://')) {
    return url;
  }
  const source = encryptedSourceFromJson(mediaSourceJson);
  if (!source) {
    throw new Error('Missing encryption metadata.');
  }

  const cacheKey = crypto
    .createHash('sha256')
    .update(`${url}\u0000${mediaSourceJson}`)
    .digest('hex')
    .slice(0, 40);
  const extension = extensionForMedia(fileName, mimeType);
  const localPath = `${RNFS.CachesDirectoryPath}/matrix-media-${cacheKey}.${extension}`;
  const localUri = `file://${localPath}`;

  if (await nonEmptyFileExists(localPath)) {
    return localUri;
  }

  const existing = inFlightDecryptions.get(cacheKey);
  if (existing) {
    return existing;
  }

  const task = downloadDecryptAndPersist(url, source, headers, localPath, localUri);
  inFlightDecryptions.set(cacheKey, task);
  try {
    return await task;
  } finally {
    if (inFlightDecryptions.get(cacheKey) === task) {
      inFlightDecryptions.delete(cacheKey);
    }
  }
}

async function downloadDecryptAndPersist(
  url: string,
  source: EncryptedMediaSource,
  headers: Record<string, string>,
  localPath: string,
  localUri: string,
): Promise<string> {
  const ciphertext = await downloadCiphertext(url, headers);
  const actualSha256 = crypto.createHash('sha256').update(ciphertext).digest('base64');
  if (normalizedBase64(actualSha256) !== normalizedBase64(source.hashes.sha256)) {
    throw new Error('Hash mismatch: encrypted media is incomplete or corrupted.');
  }

  const key = base64ToBuffer(source.key.k);
  const iv = base64ToBuffer(source.iv);
  if (key.length !== 32 || iv.length !== 16) {
    throw new Error('Dữ liệu giải mã nội dung đính kèm không hợp lệ.');
  }

  const decipher = crypto.createDecipheriv('aes-256-ctr', key, iv);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const temporaryPath = `${localPath}.tmp`;
  await RNFS.unlink(temporaryPath).catch(() => undefined);
  await RNFS.writeFile(temporaryPath, plaintext.toString('base64'), 'base64');
  await RNFS.unlink(localPath).catch(() => undefined);
  await RNFS.moveFile(temporaryPath, localPath);
  return localUri;
}

async function downloadCiphertext(url: string, headers: Record<string, string>): Promise<Buffer> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {headers});
      if (!response.ok) {
        throw new Error('Không thể tải nội dung. Vui lòng thử lại.');
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt === 0) {
        await new Promise<void>(resolve => setTimeout(() => resolve(), 350));
      }
    }
  }
  throw lastError ?? new Error('Failed to download encrypted media.');
}

async function nonEmptyFileExists(path: string): Promise<boolean> {
  if (!await RNFS.exists(path)) {
    return false;
  }
  const stat = await RNFS.stat(path).catch(() => undefined);
  if (stat && Number(stat.size) > 0) {
    return true;
  }
  await RNFS.unlink(path).catch(() => undefined);
  return false;
}

function extensionForMedia(fileName: string, mimeType?: string): string {
  const fromName = fileName.match(/\.([a-z0-9]{2,6})$/i)?.[1]?.toLowerCase();
  if (fromName) {
    return fromName;
  }
  const mime = (mimeType ?? '').toLowerCase();
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('heic')) return 'heic';
  if (mime.includes('heif')) return 'heif';
  if (mime.includes('avif')) return 'avif';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('mp4')) return 'mp4';
  return 'bin';
}
