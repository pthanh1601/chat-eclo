import RNFS from 'react-native-fs';
import type {MatrixClient} from 'matrix-js-sdk';

export class MediaService {
  constructor(private readonly client: MatrixClient) {}

  async downloadToCache(mxcUrl: string, filename: string): Promise<string> {
    const httpUrl = this.client.mxcUrlToHttp(mxcUrl, undefined, undefined, undefined, undefined, undefined, true);
    if (!httpUrl) {
      throw new Error('Invalid MXC URL.');
    }

    const target = `${RNFS.CachesDirectoryPath}/${filename}`;
    const response = await RNFS.downloadFile({
      fromUrl: httpUrl,
      toFile: target,
      headers: {Authorization: `Bearer ${this.client.getAccessToken()}`},
    }).promise;

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error('Không thể tải nội dung. Vui lòng thử lại.');
    }
    return `file://${target}`;
  }
}
