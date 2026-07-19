import type {MatrixClient} from 'matrix-js-sdk';
import type {SecurityState} from '../models/session';

type CryptoDriver = {
  prepareToEncrypt?: (room: unknown) => Promise<void>;
  getCrossSigningStatus?: () => Promise<{privateKeysInSecretStorage?: boolean}>;
  checkKeyBackup?: () => Promise<{backupInfo?: unknown} | null>;
  restoreKeyBackupWithRecoveryKey?: (recoveryKey: string) => Promise<unknown>;
  resetEncryption?: (authUploadDeviceSigningKeys?: unknown) => Promise<void>;
};

export class CryptoBackupService {
  constructor(private readonly client: MatrixClient) {}

  async getSecurityState(): Promise<SecurityState> {
    const crypto = this.getCrypto();
    if (!crypto) {
      return 'not_configured';
    }

    const backup = await crypto.checkKeyBackup?.();
    const crossSigning = await crypto.getCrossSigningStatus?.();

    if (backup?.backupInfo && crossSigning?.privateKeysInSecretStorage) {
      return 'ready';
    }
    if (backup?.backupInfo || crossSigning?.privateKeysInSecretStorage) {
      return 'needs_recovery';
    }
    return 'not_configured';
  }

  async prepareRoom(roomId: string): Promise<void> {
    const crypto = this.getCrypto();
    const room = this.client.getRoom(roomId);
    if (!room) {
      throw new Error('Không tìm thấy cuộc trò chuyện.');
    }
    if (!crypto?.prepareToEncrypt) {
      throw new Error('Bảo mật của cuộc trò chuyện chưa sẵn sàng.');
    }
    await crypto.prepareToEncrypt(room);
  }

  async restoreWithRecoveryKey(recoveryKey: string): Promise<void> {
    const crypto = this.getCrypto();
    if (!crypto?.restoreKeyBackupWithRecoveryKey) {
      throw new Error('Thiết bị này chưa thể khôi phục dữ liệu bảo mật.');
    }
    await crypto.restoreKeyBackupWithRecoveryKey(recoveryKey);
  }

  async resetSecureIdentity(): Promise<void> {
    const crypto = this.getCrypto();
    if (!crypto?.resetEncryption) {
      throw new Error('Thiết bị này chưa thể đặt lại thông tin bảo mật.');
    }
    await crypto.resetEncryption(undefined);
  }

  private getCrypto(): CryptoDriver | undefined {
    return (this.client as any).getCrypto?.() as CryptoDriver | undefined;
  }
}
