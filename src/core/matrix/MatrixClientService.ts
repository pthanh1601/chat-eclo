import {createClient, type MatrixClient, type Room} from 'matrix-js-sdk';
import {MATRIX_HOMESERVER} from '../../config/matrix';
import type {AuthData} from '../models/session';
import {matrixErrorMessage} from './errors';

export class MatrixClientService {
  private client: MatrixClient | null = null;
  private auth: AuthData | null = null;
  private cryptoReady = false;
  private cryptoError: string | null = null;

  get currentClient(): MatrixClient {
    if (!this.client) {
      throw new Error('Phiên kết nối chưa sẵn sàng.');
    }
    return this.client;
  }

  get currentAuth(): AuthData {
    if (!this.auth) {
      throw new Error('Chưa có phiên đăng nhập.');
    }
    return this.auth;
  }

  getCryptoStatus(): {ready: boolean; error: string | null} {
    return {ready: this.cryptoReady, error: this.cryptoError};
  }

  async login(username: string, password: string, baseUrl = MATRIX_HOMESERVER): Promise<AuthData> {
    const loginClient = createClient({baseUrl});
    const response = await loginClient.login('m.login.password', {
      user: username,
      password,
      initial_device_display_name: 'Điện thoại ECLO',
    });

    return {
      userId: requireAuthField(response.user_id, 'user_id'),
      accessToken: requireAuthField(response.access_token, 'access_token'),
      deviceId: requireAuthField(response.device_id, 'device_id'),
      baseUrl,
    };
  }

  async register(username: string, password: string, baseUrl = MATRIX_HOMESERVER): Promise<AuthData> {
    const registrationClient = createClient({baseUrl});
    const response = await registrationClient.registerRequest({
      username,
      password,
      auth: {type: 'm.login.dummy'},
      initial_device_display_name: 'Điện thoại ECLO',
    });

    return {
      userId: requireAuthField(response.user_id, 'user_id'),
      accessToken: requireAuthField(response.access_token, 'access_token'),
      deviceId: requireAuthField(response.device_id, 'device_id'),
      baseUrl,
    };
  }

  async startSession(auth: AuthData): Promise<MatrixClient> {
    await this.stop();
    this.auth = auth;
    this.client = createClient({
      baseUrl: auth.baseUrl,
      accessToken: auth.accessToken,
      userId: auth.userId,
      deviceId: auth.deviceId,
      timelineSupport: true,
      cryptoCallbacks: {},
    });

    this.cryptoReady = false;
    this.cryptoError = null;
    try {
      this.cryptoReady = await this.initCrypto(auth);
      if (!this.cryptoReady) {
        this.cryptoError = 'Bảo mật chưa sẵn sàng.';
      }
    } catch (error) {
      this.cryptoError = matrixErrorMessage(error);
    }
    this.client.startClient({initialSyncLimit: 30});
    await this.waitForPreparedSync();
    return this.client;
  }

  async stop(): Promise<void> {
    if (this.client) {
      this.client.stopClient();
      this.client.removeAllListeners();
    }
    this.client = null;
    this.auth = null;
    this.cryptoReady = false;
    this.cryptoError = null;
  }

  getJoinedRooms(): Room[] {
    return this.currentClient
      .getVisibleRooms()
      .filter(room => room.getMyMembership() === 'join');
  }

  private async initCrypto(auth: AuthData): Promise<boolean> {
    if ((globalThis as {navigator?: {product?: string}}).navigator?.product === 'ReactNative') {
      return false;
    }

    const client = this.currentClient as MatrixClient & {
      initRustCrypto?: (options: {cryptoDatabasePrefix: string}) => Promise<void>;
    };

    if (!client.initRustCrypto) {
      return false;
    }

    await client.initRustCrypto({
      cryptoDatabasePrefix: `eclo-chat-crypto-${auth.userId}-${auth.deviceId}`,
    });
    return true;
  }

  private waitForPreparedSync(): Promise<void> {
    return new Promise(resolve => {
      const client = this.currentClient;
      const timeout = setTimeout(resolve, 15000);
      (client as any).once('sync', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
}

export const matrixClientService = new MatrixClientService();

function requireAuthField(value: string | undefined, field: string): string {
  if (!value) {
    throw new Error(`Phản hồi đăng nhập thiếu ${field}.`);
  }
  return value;
}
