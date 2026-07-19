export type AuthData = {
  userId: string;
  accessToken: string;
  deviceId: string;
  baseUrl: string;
  nativeStoreId?: string;
  nativeSlidingSyncVersion?: number;
};

export type SecurityState = 'ready' | 'needs_recovery' | 'not_configured';

export type SecurityStatus = {
  backupState: 'unknown' | 'working' | 'enabled';
  deviceTrusted: boolean;
  hasDevicesToVerifyAgainst: boolean;
  hasServerBackup: boolean;
  recoveryState: 'unknown' | 'enabled' | 'disabled' | 'incomplete';
  state: SecurityState;
};

export type SecurityVerification = {
  phase: 'idle' | 'requested' | 'incoming' | 'accepted' | 'sas' | 'confirmed' | 'done' | 'cancelled' | 'failed';
  deviceName?: string;
  emojis?: Array<{symbol: string; description: string}>;
  decimals?: number[];
};

export type SessionBootStage = 'launching' | 'loading_session' | 'restoring' | 'crypto' | 'syncing' | 'ready';

export type SessionBootState = {
  stage: SessionBootStage;
  message: string;
  progress: number;
};

export type SessionState =
  | {status: 'checking'; boot: SessionBootState}
  | {status: 'signed_out'}
  | {status: 'signed_in'; auth: AuthData}
  | {status: 'demo'; userId: string};
