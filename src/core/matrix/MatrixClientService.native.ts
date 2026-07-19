import {MATRIX_HOMESERVER} from '../../config/matrix';
import type {AuthData} from '../models/session';

type MatrixRegisterResponse = {
  user_id?: string;
  access_token?: string;
  device_id?: string;
};

type MatrixErrorResponse = {
  error?: string;
  errcode?: string;
};

export class MatrixClientService {
  get currentClient(): never {
    throw new Error('Phiên kết nối chưa sẵn sàng.');
  }

  get currentAuth(): never {
    throw new Error('Phiên kết nối chưa sẵn sàng.');
  }

  getCryptoStatus(): {ready: boolean; error: string | null} {
    return {ready: false, error: 'Bảo mật chưa sẵn sàng.'};
  }

  async login(): Promise<AuthData> {
    throw new Error('Đăng nhập chưa sẵn sàng.');
  }

  async register(username: string, password: string, baseUrl = MATRIX_HOMESERVER): Promise<AuthData> {
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/_matrix/client/v3/register`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        username,
        password,
        auth: {type: 'm.login.dummy'},
        initial_device_display_name: 'Điện thoại ECLO',
      }),
    });
    const payload = await response.json().catch(() => ({})) as MatrixRegisterResponse & MatrixErrorResponse;
    if (!response.ok) {
      throw new Error(payload.error || payload.errcode || `Yêu cầu đăng ký thất bại (${response.status}).`);
    }
    return {
      userId: requireAuthField(payload.user_id, 'user_id'),
      accessToken: requireAuthField(payload.access_token, 'access_token'),
      deviceId: requireAuthField(payload.device_id, 'device_id'),
      baseUrl,
    };
  }

  async startSession(): Promise<never> {
    throw new Error('Không thể khôi phục phiên đăng nhập.');
  }

  async stop(): Promise<void> {
    return undefined;
  }

  getJoinedRooms(): never[] {
    return [];
  }
}

export const matrixClientService = new MatrixClientService();

function requireAuthField(value: string | undefined, field: string): string {
  if (!value) {
    throw new Error(`Phản hồi đăng ký thiếu ${field}.`);
  }
  return value;
}
