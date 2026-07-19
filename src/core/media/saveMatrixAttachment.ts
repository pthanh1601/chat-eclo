import {saveDocuments} from '@react-native-documents/picker';
import RNFS from 'react-native-fs';
import {resolveMatrixMediaUri, type MatrixMediaDescriptor} from '../matrix/MediaDecryptor';

export async function saveMatrixAttachment(item: MatrixMediaDescriptor & {body?: string}): Promise<void> {
  let temporaryPath: string | undefined;
  try {
    const sourceUri = await resolveMatrixMediaUri(item);
    let localUri = sourceUri;
    if (!sourceUri.startsWith('file://')) {
      const fileName = safeDownloadName(item.mediaFileName || item.body || `attachment-${Date.now()}`, item.mediaMimeType);
      temporaryPath = `${RNFS.CachesDirectoryPath}/download-${Date.now()}-${Math.random().toString(36).slice(2)}-${fileName}`;
      const result = await RNFS.downloadFile({
        fromUrl: sourceUri,
        toFile: temporaryPath,
        headers: item.mediaHeaders,
      }).promise;
      if (result.statusCode < 200 || result.statusCode >= 300) {
        throw new Error('Không thể tải tệp. Vui lòng thử lại.');
      }
      localUri = `file://${temporaryPath}`;
    }
    const result = await saveDocuments({
      sourceUris: [encodeURI(localUri)],
      fileName: safeDownloadName(item.mediaFileName || item.body || 'attachment', item.mediaMimeType),
      mimeType: item.mediaMimeType,
      copy: true,
    });
    const failed = result.find(entry => entry.error);
    if (failed?.error) {
      throw new Error(failed.error);
    }
  } finally {
    if (temporaryPath) {
      await RNFS.unlink(temporaryPath).catch(() => undefined);
    }
  }
}

function safeDownloadName(value: string, mimeType?: string): string {
  const safe = value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(-120) || 'attachment';
  if (/\.[a-z0-9]{2,6}$/i.test(safe)) {
    return safe;
  }
  const mime = (mimeType ?? '').toLowerCase();
  const extension = mime.includes('pdf') ? 'pdf'
    : mime.includes('png') ? 'png'
      : mime.includes('webp') ? 'webp'
        : mime.includes('gif') ? 'gif'
          : mime.includes('jpeg') ? 'jpg'
            : mime.includes('mp4') ? 'mp4'
              : mime.includes('zip') ? 'zip'
                : 'bin';
  return `${safe}.${extension}`;
}
