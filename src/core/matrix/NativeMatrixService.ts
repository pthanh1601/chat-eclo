import EventEmitter from 'eventemitter3';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {Buffer} from 'buffer';
import crypto from 'react-native-quick-crypto';
import RNFS from 'react-native-fs';
import {decodeRecoveryKey} from 'matrix-js-sdk/lib/crypto-api/recovery-key';
import {
  AuthData as SdkAuthData,
  BackupDownloadStrategy,
  BackupState,
  AudioInfo,
  ClientBuilder,
  CrossSigningResetAuthType_Tags,
  CreateRoomParameters,
  EnableRecoveryProgress_Tags,
  EncryptionState,
  EventOrTransactionId,
  FileInfo,
  ImageInfo,
  LogLevel,
  MediaSource,
  Membership,
  MembershipChange,
  MessageType_Tags,
  OtherState_Tags,
  PollKind,
  ReceiptType,
  RecoveryState,
  RoomLoadSettings,
  RoomPreset,
  RoomVisibility,
  Session,
  SlidingSyncVersion,
  SlidingSyncVersionBuilder,
  RoomListEntriesUpdate_Tags,
  TimelineDiff_Tags,
  TimelineItemContent_Tags,
  TracingConfiguration,
  UploadParameters,
  UploadSource,
  VideoInfo,
  VerificationState,
  makeWidgetDriver,
  initPlatform,
  messageEventContentFromHtml,
  messageEventContentFromMarkdown,
  type ClientLike,
  type EnableRecoveryProgress,
  type SessionVerificationControllerLike,
  type SessionVerificationData,
  type SessionVerificationRequestDetails,
  type RoomLike,
  type RoomListEntriesUpdate,
  type RoomListEntriesWithDynamicAdaptersResultLike,
  type RoomListLike,
  type RoomListServiceLike,
  type SyncServiceLike,
  type TaskHandleLike,
  type TimelineDiff,
  type TimelineItemLike,
  type MediaSourceLike,
  type TimelineLike,
  type WidgetCapabilities,
  type WidgetDriverHandleLike,
  type WidgetDriverLike,
} from '@unomed/react-native-matrix-sdk';
import {ECLO_EVENT} from '../../config/matrix';
import type {AuthData, SecurityStatus, SecurityVerification} from '../models/session';
import {mergeContacts, type ContactRecord, type ContactRequestRecord} from './ContactService';
import {localSearchIndexService} from './LocalSearchIndexService';
import {memberActivityLabel, roleLabelFromPowerLevel, type TimelineItem, type TimelineMediaItem} from './MessageService';

const MATRIX_MEDIA_PLACEHOLDER_BLURHASH = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj';

export type NativeRoomSummary = {
  roomId: string;
  name: string;
  avatarUrl?: string;
  encrypted: boolean;
  pinned?: boolean;
  isDirect?: boolean;
  joinedMembersCount?: number;
  invitedMembersCount?: number;
  isPendingDirectRequest?: boolean;
  lastMessage?: string;
  lastTimestamp?: number;
  unreadCount?: number;
};

export type NativeContactRequest = ContactRequestRecord;

export type NativeUserProfile = {
  userId: string;
  displayName?: string;
  avatarUrl?: string;
};

export type NativeGroupRequest = {
  roomId: string;
  title: string;
  avatarUrl?: string;
  inviter?: string;
  memberCount?: number;
  direction: 'incoming';
};

export type NativeRoomMember = {
  userId: string;
  displayName?: string;
  avatarUrl?: string;
  powerLevel?: number;
  role?: string;
};

export type NativeRoomDetails = {
  roomId: string;
  name: string;
  avatarUrl?: string;
  encrypted: boolean;
  isDirect: boolean;
  joinedMembersCount: number;
  invitedMembersCount: number;
  members: NativeRoomMember[];
  ownPowerLevel?: number;
  canEditRoom?: boolean;
  canInvite?: boolean;
  canKick?: boolean;
  isOnline?: boolean;
};

export type NativeCallEvent = {
  eventId: string;
  roomId: string;
  sender: string;
  timestamp: number;
  type: string;
  content: Record<string, unknown>;
  source: 'timeline' | 'raw';
};

export type NativeSessionProgress = {
  stage: 'cache' | 'restore' | 'crypto' | 'sync' | 'ready';
  message: string;
  progress: number;
};

export type NativeMediaUpload = {
  uri: string;
  kind: 'image' | 'video' | 'audio' | 'file' | 'sticker';
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  width?: number;
  height?: number;
  durationMs?: number;
};

type TimelineState = {
  handle?: TaskHandleLike;
  items: TimelineItemLike[];
  timeline: TimelineLike;
};

type CallSignalObserver = {
  abortController: AbortController;
  driver: WidgetDriverLike;
  handle: WidgetDriverHandleLike;
  widgetId: string;
};

type MatrixPowerLevels = {
  users?: Record<string, number | string>;
  users_default?: number | string;
  state_default?: number | string;
  events?: Record<string, number | string>;
  invite?: number | string;
  kick?: number | string;
};

type MatrixJoinedMembersResponse = {
  chunk?: Array<{
    state_key?: string;
    content?: {
      membership?: string;
      displayname?: string;
      avatar_url?: string;
    };
  }>;
};

type MatrixPresenceResponse = {
  presence?: string;
  currently_active?: boolean;
  last_active_ago?: number;
};

type MatrixPinnedEventsResponse = {
  pinned?: string[];
};

type MatrixTagsResponse = {
  tags?: Record<string, unknown>;
};

type MatrixRawEvent = {
  type?: string;
  content?: Record<string, unknown>;
};

const LEGACY_CALL_SIGNAL_TYPES = [
  'm.call.invite',
  'm.call.candidates',
  'm.call.answer',
  'm.call.select_answer',
  'm.call.reject',
  'm.call.hangup',
  'm.call.negotiate',
  'm.call.replaces',
] as const;

const LEGACY_CALL_WIDGET_CAPABILITIES = LEGACY_CALL_SIGNAL_TYPES.map(
  eventType => `org.matrix.msc2762.receive.event:${eventType}`,
);

class NativeMatrixService {
  private client: ClientLike | null = null;
  private sync: SyncServiceLike | null = null;
  private emitter = new EventEmitter();
  private timelines = new Map<string, TimelineState>();
  private cachedRoomSummaries = new Map<string, NativeRoomSummary>();
  private mediaFileCache = new Map<string, string>();
  private mediaFileFailures = new Map<string, number>();
  private mediaFileRequests = new Map<string, Promise<string | undefined>>();
  private hiddenHistoryBefore = new Map<string, number>();
  private loadedHiddenHistoryRooms = new Set<string>();
  private roomMemberProfiles = new Map<string, Map<string, NativeRoomMember>>();
  private emittedCallEventIds = new Set<string>();
  private callSignalObservers = new Map<string, CallSignalObserver>();
  private validatedCallRooms = new Set<string>();
  private enrichingRooms = new Set<string>();
  private summaryEnrichmentAttemptedRooms = new Set<string>();
  private directRoomIds = new Set<string>();
  private directRoomIdsLoaded = false;
  private directRoomIdsRefreshInFlight: Promise<void> | null = null;
  private directRoomIdsLastAttemptAt = 0;
  private roomListInFlight: Promise<NativeRoomSummary[]> | null = null;
  private roomListService: RoomListServiceLike | null = null;
  private roomList: RoomListLike | null = null;
  private roomListEntries: RoomListEntriesWithDynamicAdaptersResultLike | null = null;
  private roomListEntriesHandle: TaskHandleLike | null = null;
  private roomRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private roomRefreshInFlight: Promise<void> | null = null;
  private roomRefreshPending = false;
  private roomRefreshNeedsFull = false;
  private pendingRoomSummaryUpdates = new Map<string, RoomLike>();
  private roomSummaryPersistTimer: ReturnType<typeof setTimeout> | null = null;
  private syncRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private syncRetryDelayMs = 5_000;
  private currentUserId: string | null = null;
  private currentBaseUrl: string | null = null;
  private currentAccessToken: string | null = null;
  private platformReady = false;
  private securityListenerHandles: TaskHandleLike[] = [];
  private verificationController: SessionVerificationControllerLike | null = null;
  private verificationRequest: SessionVerificationRequestDetails | null = null;
  private securityVerification: SecurityVerification = {phase: 'idle'};
  private verificationTrustRefreshInFlight: Promise<void> | null = null;
  private verificationInitiatedByMe = false;
  private sasStartInFlight = false;
  private searchIndexSignatures = new Map<string, string>();
  private appActive = true;
  private syncPaused = false;
  private syncLifecycle: Promise<void> = Promise.resolve();

  isActive(): boolean {
    return Boolean(this.client);
  }

  getCryptoStatus(): {ready: boolean; error: string | null} {
    return {ready: Boolean(this.client), error: this.client ? null : 'Bảo mật chưa sẵn sàng.'};
  }

  subscribeSecurity(listener: () => void): () => void {
    this.emitter.on('security', listener);
    return () => this.emitter.off('security', listener);
  }

  getSecurityVerification(): SecurityVerification {
    return this.securityVerification;
  }

  dismissSecurityVerification(): void {
    if (['done', 'cancelled', 'failed'].includes(this.securityVerification.phase)) {
      this.setSecurityVerification({phase: 'idle'});
    }
  }

  async isLocalSearchIndexEnabled(): Promise<boolean> {
    return this.currentUserId ? localSearchIndexService.isEnabled(this.currentUserId) : false;
  }

  async setLocalSearchIndexEnabled(enabled: boolean): Promise<void> {
    if (!this.currentUserId) {
      throw new Error('Cần đăng nhập để thay đổi chỉ mục tìm kiếm.');
    }
    await localSearchIndexService.setEnabled(this.currentUserId, enabled);
    this.searchIndexSignatures.clear();
    if (enabled) {
      for (const [roomId, state] of this.timelines) {
        await localSearchIndexService.indexTimeline(this.currentUserId, roomId, this.mapItems(state.items, roomId));
      }
    }
  }

  async clearLocalSearchIndex(): Promise<void> {
    if (this.currentUserId) {
      await localSearchIndexService.clear(this.currentUserId);
      this.searchIndexSignatures.clear();
    }
  }

  async searchLocalTimeline(roomId: string, query: string): Promise<TimelineItem[]> {
    return this.currentUserId ? localSearchIndexService.search(this.currentUserId, roomId, query) : [];
  }

  async getSecurityStatus(): Promise<SecurityStatus> {
    const encryption = this.requireClient().encryption();
    await encryption.waitForE2eeInitializationTasks().catch(() => undefined);
    const [hasServerBackup, hasDevicesToVerifyAgainst] = await Promise.all([
      encryption.backupExistsOnServer().catch(() => encryption.backupState() !== BackupState.Unknown),
      encryption.hasDevicesToVerifyAgainst().catch(() => false),
    ]);
    const verificationState = encryption.verificationState();
    const recoveryState = encryption.recoveryState();
    const backupState = encryption.backupState();
    const deviceTrusted = verificationState === VerificationState.Verified;
    const backupEnabled = backupState === BackupState.Enabled;
    const backupWorking = [
      BackupState.Creating,
      BackupState.Enabling,
      BackupState.Resuming,
      BackupState.Downloading,
      BackupState.Disabling,
    ].includes(backupState);
    // BackupState.Enabled means the local client holds the matching room-key
    // backup key. Cross-signing recovery is tracked separately by
    // deviceTrusted/recoveryState and must not turn a restored backup back into
    // a "needs recovery" state.
    const state = backupEnabled
      ? 'ready'
      : recoveryState === RecoveryState.Incomplete || hasServerBackup
        ? 'needs_recovery'
        : 'not_configured';

    return {
      backupState: backupEnabled ? 'enabled' : backupWorking ? 'working' : 'unknown',
      deviceTrusted,
      hasDevicesToVerifyAgainst,
      hasServerBackup,
      recoveryState: recoveryState === RecoveryState.Enabled
        ? 'enabled'
        : recoveryState === RecoveryState.Disabled
          ? 'disabled'
          : recoveryState === RecoveryState.Incomplete
            ? 'incomplete'
            : 'unknown',
      state,
    };
  }

  async login(username: string, password: string, baseUrl: string): Promise<AuthData> {
    await this.stop();
    const storeId = this.storeId(baseUrl, username);
    await this.destroyStore(storeId);
    const client = await this.buildClient(baseUrl, storeId);
    try {
      await client.login(username, password, 'Điện thoại ECLO', undefined);
      const session = client.session();
      this.currentUserId = session.userId;
      this.currentBaseUrl = session.homeserverUrl;
      this.currentAccessToken = session.accessToken;
      await this.loadRoomSummaryCache(session.userId);
      await this.startClient(client);
      return this.authFromSession(session, storeId);
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async startSession(auth: AuthData, onProgress?: (progress: NativeSessionProgress) => void): Promise<void> {
    await this.stop();
    this.currentUserId = auth.userId;
    this.currentBaseUrl = auth.baseUrl;
    this.currentAccessToken = auth.accessToken;
    onProgress?.({stage: 'cache', message: 'Đọc dữ liệu đã lưu trên máy...', progress: 0.22});
    await this.loadRoomSummaryCache(auth.userId);
    const storeId = auth.nativeStoreId ?? this.storeId(auth.baseUrl, `${auth.userId}-${auth.deviceId}`);
    try {
      await this.restoreSession(auth, storeId, onProgress);
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.roomRefreshTimer) {
      clearTimeout(this.roomRefreshTimer);
      this.roomRefreshTimer = null;
    }
    this.roomRefreshPending = false;
    this.roomRefreshNeedsFull = false;
    this.pendingRoomSummaryUpdates.clear();
    this.roomRefreshInFlight = null;
    this.roomListEntriesHandle?.cancel();
    this.roomListEntriesHandle = null;
    this.roomListEntries = null;
    this.roomList = null;
    this.roomListService = null;
    for (const observer of this.callSignalObservers.values()) {
      observer.abortController.abort();
    }
    this.callSignalObservers.clear();
    for (const handle of this.securityListenerHandles) {
      handle.cancel();
    }
    this.securityListenerHandles = [];
    this.verificationController?.setDelegate(undefined);
    this.verificationController = null;
    this.verificationRequest = null;
    this.securityVerification = {phase: 'idle'};
    this.verificationTrustRefreshInFlight = null;
    this.verificationInitiatedByMe = false;
    this.sasStartInFlight = false;
    this.searchIndexSignatures.clear();
    this.summaryEnrichmentAttemptedRooms.clear();
    for (const timeline of this.timelines.values()) {
      timeline.handle?.cancel();
    }
    this.timelines.clear();
    this.hiddenHistoryBefore.clear();
    this.loadedHiddenHistoryRooms.clear();
    this.directRoomIds.clear();
    this.directRoomIdsLoaded = false;
    this.directRoomIdsRefreshInFlight = null;
    this.directRoomIdsLastAttemptAt = 0;
    this.roomListInFlight = null;
    if (this.sync) {
      await this.sync.stop().catch(() => undefined);
    }
    if (this.syncRetryTimer) {
      clearTimeout(this.syncRetryTimer);
      this.syncRetryTimer = null;
    }
    this.sync = null;
    this.syncPaused = false;
    this.syncRetryDelayMs = 5_000;
    this.client = null;
    this.emittedCallEventIds.clear();
    this.validatedCallRooms.clear();
    this.currentBaseUrl = null;
    this.currentAccessToken = null;
    if (this.roomSummaryPersistTimer) {
      clearTimeout(this.roomSummaryPersistTimer);
      this.roomSummaryPersistTimer = null;
      await this.persistRoomSummaryCacheNow();
    }
  }

  setAppActive(active: boolean): Promise<void> {
    this.appActive = active;
    this.syncLifecycle = this.syncLifecycle
      .catch(() => undefined)
      .then(async () => {
        const sync = this.sync;
        if (!sync) {
          if (this.appActive && this.client) {
            this.scheduleSyncRetry(this.client);
          }
          return;
        }
        if (!this.appActive) {
          if (!this.syncPaused) {
            this.syncPaused = true;
            await sync.stop().catch(() => undefined);
          }
          return;
        }
        if (this.syncPaused && this.sync === sync) {
          this.syncPaused = false;
          sync.start().catch(() => undefined);
          this.scheduleRoomRefresh(0);
        }
      });
    return this.syncLifecycle;
  }

  async purgeSessionData(auth: AuthData): Promise<void> {
    await this.stop();
    const storeId = auth.nativeStoreId ?? this.storeId(auth.baseUrl, `${auth.userId}-${auth.deviceId}`);
    await this.destroyStore(storeId);
    await AsyncStorage.removeItem(this.roomSummaryCacheKey(auth.userId)).catch(() => undefined);
    this.cachedRoomSummaries.clear();
    this.mediaFileCache.clear();
    this.mediaFileFailures.clear();
    this.mediaFileRequests.clear();
    this.roomMemberProfiles.clear();
    this.emittedCallEventIds.clear();
  }

  subscribeRooms(listener: () => void): () => void {
    this.emitter.on('rooms', listener);
    return () => {
      this.emitter.off('rooms', listener);
    };
  }

  subscribeTimeline(roomId: string, listener: () => void): () => void {
    const event = `timeline:${roomId}`;
    this.emitter.on(event, listener);
    return () => {
      this.emitter.off(event, listener);
    };
  }

  subscribeCallEvents(listener: (event: NativeCallEvent) => void): () => void {
    this.emitter.on('callEvent', listener);
    return () => {
      this.emitter.off('callEvent', listener);
    };
  }

  stopCallSignalObservers(roomIds?: string[]): void {
    const ids = roomIds ?? [...this.callSignalObservers.keys()];
    for (const roomId of ids) {
      const observer = this.callSignalObservers.get(roomId);
      if (!observer) {
        continue;
      }
      observer.abortController.abort();
      this.callSignalObservers.delete(roomId);
    }
  }

  async listRooms(): Promise<NativeRoomSummary[]> {
    if (this.roomListInFlight) {
      return this.roomListInFlight;
    }
    const operation = this.loadRoomSummaries();
    this.roomListInFlight = operation;
    try {
      return await operation;
    } finally {
      if (this.roomListInFlight === operation) {
        this.roomListInFlight = null;
      }
    }
  }

  private async loadRoomSummaries(): Promise<NativeRoomSummary[]> {
    const client = this.requireClient();
    if (!this.directRoomIdsLoaded) {
      void this.refreshDirectRoomIds();
    }
    const rooms = client.rooms().filter(room => room.membership() === Membership.Joined);
    const roomIds = rooms.map(room => room.id());
    const summaries = await Promise.all(rooms.map(room => this.roomSummary(room)));
    this.pruneRoomSummaryCache(roomIds);
    await this.mergeRoomSummaryCache(summaries);
    const merged = summaries.map(summary => this.cachedRoomSummaries.get(summary.roomId) ?? summary);
    // Recover at most one missing preview per room-list refresh. Each room is
    // attempted once per session so encrypted history cannot cascade into
    // opening and decrypting every timeline in the account.
    void this.enrichMissingSummaries(merged, 1).catch(() => undefined);
    return merged;
  }

  getCachedRooms(): NativeRoomSummary[] {
    return [...this.cachedRoomSummaries.values()];
  }

  async listGroupRooms(): Promise<NativeRoomSummary[]> {
    if (!this.directRoomIdsLoaded) {
      await this.withTimeout(this.refreshDirectRoomIds(), 4000, 'm.direct lookup timed out.').catch(() => undefined);
    }
    const summaries = await this.listRooms();
    return summaries.filter(room => !room.isDirect && !this.directRoomIds.has(room.roomId));
  }

  async listDirectContacts(): Promise<ContactRecord[]> {
    const rooms = this.requireClient().rooms().filter(room => room.membership() === Membership.Joined);
    const contacts = await Promise.all(rooms.map(room => this.contactFromDirectRoom(room)));
    return mergeContacts(contacts.filter((contact): contact is ContactRecord => Boolean(contact)));
  }

  async listContactRequests(): Promise<NativeContactRequest[]> {
    const rooms = this.requireClient().rooms().filter(room => room.membership() === Membership.Invited);
    const requests = await Promise.all(rooms.map(async (room): Promise<NativeContactRequest | null> => {
      const direct = await this.resolveRoomIsDirect(room, {
        cached: this.cachedRoomSummaries.get(room.id()),
        sdkDirect: await room.isDirect().catch(() => false),
      });
      if (!direct) {
        return null;
      }
      const inviter = await room.inviter().catch(() => undefined);
      const userId = inviter?.userId ?? room.displayName() ?? room.id();
      return {
        userId,
        roomId: room.id(),
        title: inviter?.displayName ?? room.displayName() ?? userId,
        displayName: inviter?.displayName ?? userId,
        avatarUrl: this.matrixMediaUrl(inviter?.avatarUrl),
        source: 'invite' as const,
        direction: 'incoming' as const,
      };
    }));
    return requests.filter((request): request is NativeContactRequest => Boolean(request));
  }

  async listGroupInvites(): Promise<NativeGroupRequest[]> {
    const rooms = this.requireClient().rooms().filter(room => room.membership() === Membership.Invited);
    const requests = await Promise.all(rooms.map(async (room): Promise<NativeGroupRequest | null> => {
      const direct = await this.resolveRoomIsDirect(room, {
        cached: this.cachedRoomSummaries.get(room.id()),
        sdkDirect: await room.isDirect().catch(() => false),
      });
      if (direct) {
        return null;
      }
      const inviter = await room.inviter().catch(() => undefined);
      return {
        roomId: room.id(),
        title: room.displayName() ?? room.rawName() ?? room.id(),
        avatarUrl: this.matrixMediaUrl(room.avatarUrl()),
        inviter: inviter?.displayName ?? inviter?.userId,
        memberCount: Number(room.joinedMembersCount() + room.invitedMembersCount()) || undefined,
        direction: 'incoming' as const,
      };
    }));
    return requests.filter((request): request is NativeGroupRequest => Boolean(request));
  }

  async listSentContactRequests(): Promise<NativeContactRequest[]> {
    const rooms = this.requireClient().rooms().filter(room => room.membership() === Membership.Joined);
    const requests = await Promise.all(rooms.map(async (room): Promise<NativeContactRequest | null> => {
      const direct = await this.resolveRoomIsDirect(room, {
        cached: this.cachedRoomSummaries.get(room.id()),
        sdkDirect: await room.isDirect().catch(() => false),
      });
      if (!direct || !this.isNativePendingOutgoingDirectRequest(room)) {
        return null;
      }
      const userId = room.heroes().find(hero => hero.userId !== this.currentUserId)?.userId ?? room.displayName() ?? room.id();
      return {
        userId,
        roomId: room.id(),
        title: room.displayName() ?? userId,
        displayName: room.displayName() ?? userId,
        source: 'invite' as const,
        direction: 'outgoing' as const,
      };
    }));
    return requests.filter((request): request is NativeContactRequest => Boolean(request));
  }

  async searchUsers(term: string): Promise<ContactRecord[]> {
    const result = await this.requireClient().searchUsers(term, BigInt(20));
    return result.results
      .filter(user => user.userId !== this.currentUserId)
      .map(user => ({
        userId: user.userId,
        displayName: user.displayName,
        avatarUrl: this.matrixMediaUrl(user.avatarUrl),
        source: 'search' as const,
      }));
  }

  async getOwnProfile(): Promise<NativeUserProfile> {
    const client = this.requireClient();
    const userId = this.currentUserId ?? client.userId();
    const [displayName, avatarUrl] = await Promise.all([
      client.displayName().catch(() => undefined),
      client.avatarUrl().catch(() => undefined),
    ]);
    return {userId, displayName, avatarUrl: this.matrixMediaUrl(avatarUrl)};
  }

  async getProfile(userId: string): Promise<NativeUserProfile> {
    const profile = await this.requireClient().getProfile(userId);
    return {
      userId,
      displayName: profile.displayName,
      avatarUrl: this.matrixMediaUrl(profile.avatarUrl),
    };
  }

  async getRoomDetails(roomId: string): Promise<NativeRoomDetails> {
    const room = this.requireRoom(roomId);
    await this.primeRoomMembers(roomId).catch(() => undefined);
    const [encrypted, sdkDirect, info] = await Promise.all([
      room.isEncrypted().catch(() => room.encryptionState() === EncryptionState.Encrypted),
      room.isDirect().catch(() => false),
      room.roomInfo().catch(() => undefined),
    ]);
    const direct = await this.resolveRoomIsDirect(room, {
      cached: this.cachedRoomSummaries.get(roomId),
      info,
      sdkDirect,
      waitForAccountDataMs: 1500,
    });
    const powerState = await this.getPowerLevelState(roomId).catch(() => undefined);
    const powerLevels = await room.getPowerLevels().catch(() => info?.powerLevels);
    const memberPowerLevels = powerLevels
      ? safeValue(() => powerLevels.userPowerLevels(), new Map<string, bigint>())
      : new Map<string, bigint>();
    const powerValues = safeValue(() => powerLevels?.values(), undefined);
    const creator = info?.creators?.[0] ?? await this.getRoomCreator(roomId).catch(() => '');
    const defaultMemberPower = numberValue(powerValues?.usersDefault, 0);
    const fallbackPower = (userId?: string) => {
      if (!userId) {
        return defaultMemberPower;
      }
      return numberValue(memberPowerLevels.get(userId), defaultMemberPower);
    };
    const joinedMembers = await this.joinedRoomMembers(roomId).catch(() => [...(this.roomMemberProfiles.get(roomId)?.values() ?? [])]);
    const members = joinedMembers.map(member => {
      const powerLevel = powerLevelForMember(member.userId, powerState, creator, fallbackPower(member.userId));
      return {...member, powerLevel, role: roleFromPowerLevel(powerLevel)};
    });
    const ownPowerLevel = powerLevelForMember(this.currentUserId ?? '', powerState, creator, fallbackPower(this.currentUserId ?? ''));
    const stateDefault = numberValue(powerState?.state_default, numberValue(powerValues?.stateDefault, 50));
    const events = powerState?.events ?? {};
    const editLevel = Math.max(
      numberValue(events['m.room.name'], numberValue(powerValues?.roomName, stateDefault)),
      numberValue(events['m.room.avatar'], numberValue(powerValues?.roomAvatar, stateDefault)),
      numberValue(events['m.room.topic'], numberValue(powerValues?.roomTopic, stateDefault)),
    );
    const inviteLevel = numberValue(powerState?.invite, numberValue(powerValues?.invite, 0));
    const kickLevel = numberValue(powerState?.kick, numberValue(powerValues?.kick, 50));
    const productEditLevel = Math.max(50, editLevel);
    const sdkCanInvite = powerLevels ? safeValue(() => powerLevels.canOwnUserInvite(), undefined) : undefined;
    const sdkCanKick = powerLevels ? safeValue(() => powerLevels.canOwnUserKick(), undefined) : undefined;
    const canInvite = powerState
      ? ownPowerLevel >= inviteLevel
      : (sdkCanInvite ?? ownPowerLevel >= inviteLevel);
    const canKick = powerState
      ? ownPowerLevel >= kickLevel
      : (sdkCanKick ?? ownPowerLevel >= kickLevel);
    const other = direct ? members.find(member => member.userId !== this.currentUserId) ?? await this.otherRoomMember(room) : undefined;
    const heroAvatar = direct ? room.heroes().find(hero => hero.userId !== this.currentUserId)?.avatarUrl : undefined;
    const isOnline = other?.userId ? await this.userIsOnline(other.userId).catch(() => false) : undefined;
    return {
      roomId,
      name: direct ? other?.displayName ?? room.displayName() ?? room.rawName() ?? roomId : room.displayName() ?? room.rawName() ?? roomId,
      avatarUrl: this.matrixMediaUrl(other?.avatarUrl ?? heroAvatar ?? room.avatarUrl()),
      encrypted,
      isDirect: direct,
      joinedMembersCount: Number(room.joinedMembersCount()),
      invitedMembersCount: Number(room.invitedMembersCount()),
      members: direct && other ? [other] : members,
      ownPowerLevel,
      canEditRoom: !direct && ownPowerLevel >= productEditLevel,
      canInvite: !direct && canInvite,
      canKick: !direct && canKick,
      isOnline,
    };
  }

  async createEncryptedRoom(name: string, invite: string[] = [], isDirect = false): Promise<string> {
    const roomId = await this.requireClient().createRoom(
      CreateRoomParameters.new({
        name: isDirect ? undefined : name,
        invite,
        isDirect,
        isEncrypted: true,
        preset: RoomPreset.PrivateChat,
        visibility: RoomVisibility.Private.new(),
      }),
    );
    this.emitter.emit('rooms');
    return roomId;
  }

  async createOrOpenDirectChat(userId: string): Promise<string> {
    const existing = await this.directRoomForUser(userId);
    if (existing) {
      return existing.id();
    }
    return this.createEncryptedRoom(userId, [userId], true);
  }

  async getOpenDirectRoomId(userId: string): Promise<string | null> {
    const room = await this.directRoomForUser(userId, false);
    return room?.id() ?? null;
  }

  async acceptInvite(roomId: string): Promise<string> {
    await this.requireRoom(roomId).join();
    this.emitter.emit('rooms');
    return roomId;
  }

  async joinRoom(roomIdOrAlias: string): Promise<string> {
    const room = await this.requireClient().joinRoomByIdOrAlias(roomIdOrAlias, []);
    this.emitter.emit('rooms');
    return room.id();
  }

  async openTimeline(roomId: string): Promise<TimelineItem[]> {
    await this.loadHiddenHistoryCutoff(roomId);
    const existing = this.timelines.get(roomId);
    if (existing) {
      this.emitCallEvents(roomId, existing.items);
      void this.updateOpenedTimelineSummary(roomId, existing.items)
        .finally(() => this.emitter.emit('rooms'));
      return this.timelineItems(roomId, existing.items);
    }
    const room = this.requireRoom(roomId);
    await this.primeRoomMembers(roomId).catch(() => undefined);
    const timeline = await room.timeline();
    const state: TimelineState = {items: [], timeline};
    this.timelines.set(roomId, state);
    state.handle = await timeline.addListener({
      onUpdate: diffs => {
        this.applyDiffs(roomId, diffs);
        this.emitCallEvents(roomId, state.items);
        this.emitter.emit(`timeline:${roomId}`);
        void this.updateOpenedTimelineSummary(roomId, state.items)
          .finally(() => this.emitter.emit('rooms'));
      },
    });
    await timeline.paginateBackwards(30).catch(() => false);
    this.emitCallEvents(roomId, state.items);
    await this.updateOpenedTimelineSummary(roomId, state.items).catch(() => undefined);
    this.emitter.emit('rooms');
    return this.timelineItems(roomId, state.items);
  }

  getTimeline(roomId: string): TimelineItem[] {
    return this.timelineItems(roomId, this.timelines.get(roomId)?.items ?? []);
  }

  async sendCallEvent(roomId: string, eventType: string, content: Record<string, unknown>): Promise<void> {
    if (!eventType.startsWith('m.call.')) {
      throw new Error('Loại sự kiện cuộc gọi không hợp lệ.');
    }
    if (!this.validatedCallRooms.has(roomId)) {
      const details = await this.getRoomDetails(roomId);
      if (!details.isDirect || details.joinedMembersCount !== 2) {
        throw new Error('Cuộc gọi 1:1 chỉ hoạt động trong hội thoại trực tiếp có hai thành viên.');
      }
      this.validatedCallRooms.add(roomId);
    }
    await this.requireRoom(roomId).sendRaw(eventType, JSON.stringify(content));
  }

  /**
   * The SDK's UI timeline intentionally omits transient legacy call events
   * such as answer, candidates and hangup. The widget driver uses the lower
   * room event handler instead, so it receives those events after E2EE
   * decryption without exposing SDP/ICE data outside Matrix.
   */
  async observeCallSignals(roomId: string): Promise<void> {
    if (this.callSignalObservers.has(roomId)) {
      return;
    }
    const room = this.requireRoom(roomId);
    const widgetId = `eclo-mobile-call-${stableSignalId(roomId)}`;
    const {driver, handle} = makeWidgetDriver({
      widgetId,
      initAfterContentLoad: false,
      rawUrl: 'https://eclo.chat/mobile-call-signals',
    });
    const abortController = new AbortController();
    const observer: CallSignalObserver = {abortController, driver, handle, widgetId};
    this.callSignalObservers.set(roomId, observer);

    driver.run(room, {
      acquireCapabilities: (capabilities: WidgetCapabilities) => capabilities,
    }, {signal: abortController.signal}).catch(error => {
      if (!abortController.signal.aborted) {
        console.warn('[ECLO call] raw Matrix signal observer stopped', roomId, error);
        this.callSignalObservers.delete(roomId);
      }
    });
    void this.pumpCallSignalObserver(roomId, observer);
  }

  async hideRoomHistoryForMe(roomId: string): Promise<void> {
    if (!this.currentUserId) {
      throw new Error('Phiên đăng nhập chưa sẵn sàng.');
    }
    const cutoff = Date.now();
    this.hiddenHistoryBefore.set(roomId, cutoff);
    this.loadedHiddenHistoryRooms.add(roomId);
    await AsyncStorage.setItem(this.hiddenHistoryKey(this.currentUserId, roomId), String(cutoff));
    const cached = this.cachedRoomSummaries.get(roomId);
    if (cached) {
      this.cachedRoomSummaries.set(roomId, {...cached, lastMessage: undefined, lastTimestamp: undefined, unreadCount: 0});
      await this.persistRoomSummaryCache();
    }
    this.emitter.emit(`timeline:${roomId}`);
    this.emitter.emit('rooms');
  }

  async sendText(roomId: string, body: string, replyTo?: string): Promise<void> {
    const timeline = await this.requireTimeline(roomId);
    const content = messageEventContentFromMarkdown(body);
    if (replyTo) {
      await timeline.sendReply(content, replyTo);
    } else {
      await timeline.send(content);
    }
    this.emitter.emit('rooms');
  }

  async sendFormattedText(roomId: string, body: string, htmlBody: string, replyTo?: string): Promise<void> {
    const timeline = await this.requireTimeline(roomId);
    const content = messageEventContentFromHtml(body, htmlBody);
    if (replyTo) {
      await timeline.sendReply(content, replyTo);
    } else {
      await timeline.send(content);
    }
    this.emitter.emit('rooms');
  }

  async sendMediaUploads(
    roomId: string,
    uploads: NativeMediaUpload[],
    replyTo?: string,
    onProgress?: (sent: number, total: number) => void,
  ): Promise<void> {
    if (!uploads.length) {
      return;
    }
    const timeline = await this.requireTimeline(roomId);
    const groupedMediaCount = uploads.filter(upload => upload.kind === 'image' || upload.kind === 'video').length;
    const mediaBatchId = groupedMediaCount > 1
      ? `eclo-media-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      : undefined;
    for (let index = 0; index < uploads.length; index += 1) {
      const upload = uploads[index] as NativeMediaUpload;
      const sourcePath = await this.localUploadPath(upload);
      try {
        const stat = await RNFS.stat(sourcePath);
        const actualSize = Number(stat.size);
        if (!Number.isFinite(actualSize) || actualSize <= 0) {
          throw new Error('Tệp đã chọn không có dữ liệu để gửi.');
        }
        const mimeType = upload.mimeType?.trim() || fallbackMimeType(upload.kind, upload.fileName);
        if (mediaBatchId && (upload.kind === 'image' || upload.kind === 'video')) {
          await this.sendRawMediaUpload(
            roomId,
            upload,
            sourcePath,
            actualSize,
            mimeType,
            mediaBatchId,
            index === 0 ? replyTo : undefined,
          );
          onProgress?.(index + 1, uploads.length);
          continue;
        }
        const source = await this.uploadSource(sourcePath, upload.fileName, actualSize);
        const params = UploadParameters.create({source, inReplyTo: index === 0 ? replyTo : undefined});
        if (upload.kind === 'video') {
          const handle = timeline.sendVideo(params, undefined, VideoInfo.create({
            duration: validDurationMs(upload.durationMs),
            width: requiredPositiveBigInt(upload.width),
            height: requiredPositiveBigInt(upload.height),
            mimetype: mimeType,
            size: requiredPositiveBigInt(actualSize),
            blurhash: MATRIX_MEDIA_PLACEHOLDER_BLURHASH,
          }));
          await handle.join();
        } else if (upload.kind === 'audio') {
          const handle = timeline.sendVoiceMessage(params, AudioInfo.create({
            duration: validDurationMs(upload.durationMs),
            mimetype: mimeType,
            size: requiredPositiveBigInt(actualSize),
          }), []);
          await handle.join();
        } else if (upload.kind === 'file') {
          const handle = timeline.sendFile(params, FileInfo.create({
            mimetype: mimeType,
            size: requiredPositiveBigInt(actualSize),
          }));
          await handle.join();
        } else {
          const handle = timeline.sendImage(params, undefined, ImageInfo.create({
            width: requiredPositiveBigInt(upload.width),
            height: requiredPositiveBigInt(upload.height),
            mimetype: mimeType,
            size: requiredPositiveBigInt(actualSize),
            blurhash: MATRIX_MEDIA_PLACEHOLDER_BLURHASH,
            isAnimated: /gif|webp/i.test(mimeType ?? upload.fileName ?? ''),
          }));
          await handle.join();
        }
      } finally {
        await RNFS.unlink(sourcePath).catch(() => undefined);
      }
      onProgress?.(index + 1, uploads.length);
    }
    this.emitter.emit(`timeline:${roomId}`);
    this.emitter.emit('rooms');
  }

  private async sendRawMediaUpload(
    roomId: string,
    upload: NativeMediaUpload,
    sourcePath: string,
    size: number,
    mimeType: string,
    mediaBatchId: string,
    replyTo?: string,
  ): Promise<void> {
    const plainBytes = Buffer.from(await RNFS.readFile(sourcePath, 'base64'), 'base64');
    const encrypted = encryptAttachmentBytes(plainBytes);
    const contentUri = await this.requireClient().uploadMedia(
      'application/octet-stream',
      Uint8Array.from(encrypted.ciphertext).buffer,
      undefined,
    );
    const isVideo = upload.kind === 'video';
    const fileName = upload.fileName?.trim() || `${isVideo ? 'video' : 'image'}-${Date.now()}.${isVideo ? 'mp4' : 'jpg'}`;
    await this.requireRoom(roomId).sendRaw('m.room.message', JSON.stringify({
      body: fileName,
      msgtype: isVideo ? 'm.video' : 'm.image',
      info: {
        mimetype: mimeType,
        size,
        w: upload.width,
        h: upload.height,
        ...(isVideo ? {duration: validDurationMs(upload.durationMs)} : {}),
      },
      file: {
        v: 'v2',
        key: {
          alg: 'A256CTR',
          ext: true,
          k: encrypted.key,
          key_ops: ['encrypt', 'decrypt'],
          kty: 'oct',
        },
        iv: encrypted.iv,
        hashes: {sha256: encrypted.sha256},
        mimetype: mimeType,
        url: contentUri,
      },
      [ECLO_EVENT.mediaBatchId]: mediaBatchId,
      ...(replyTo ? {
        'm.relates_to': {
          'm.in_reply_to': {event_id: replyTo},
        },
      } : {}),
    }));
  }

  async sendStickerUpload(roomId: string, upload: NativeMediaUpload, replyTo?: string): Promise<void> {
    const sourcePath = await this.localUploadPath(upload);
    try {
      const stat = await RNFS.stat(sourcePath);
      const size = Number(stat.size);
      if (!Number.isFinite(size) || size <= 0) {
        throw new Error('Sticker không có dữ liệu để gửi.');
      }
      const plainBytes = Buffer.from(await RNFS.readFile(sourcePath, 'base64'), 'base64');
      const encrypted = encryptAttachmentBytes(plainBytes);
      const contentUri = await this.requireClient().uploadMedia(
        'application/octet-stream',
        Uint8Array.from(encrypted.ciphertext).buffer,
        undefined,
      );
      const fileName = upload.fileName?.trim() || `sticker-${Date.now()}.gif`;
      await this.requireRoom(roomId).sendRaw('m.sticker', JSON.stringify({
        body: fileName,
        info: {
          mimetype: upload.mimeType ?? 'image/gif',
          size,
          w: upload.width,
          h: upload.height,
        },
        file: {
          v: 'v2',
          key: {
            alg: 'A256CTR',
            ext: true,
            k: encrypted.key,
            key_ops: ['encrypt', 'decrypt'],
            kty: 'oct',
          },
          iv: encrypted.iv,
          hashes: {sha256: encrypted.sha256},
          mimetype: upload.mimeType ?? 'image/gif',
          url: contentUri,
        },
        [ECLO_EVENT.stickerMedia]: true,
        ...(replyTo ? {
          'm.relates_to': {
            'm.in_reply_to': {event_id: replyTo},
          },
        } : {}),
      }));
      this.emitter.emit(`timeline:${roomId}`);
      this.emitter.emit('rooms');
    } finally {
      await RNFS.unlink(sourcePath).catch(() => undefined);
    }
  }

  async react(roomId: string, eventId: string, key: string): Promise<void> {
    if (!this.currentBaseUrl || !this.currentAccessToken) {
      await (await this.requireTimeline(roomId)).toggleReaction(EventOrTransactionId.EventId.new({eventId}), key);
      return;
    }
    const txnId = `eclo-reaction-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await this.sendMatrixEvent(roomId, 'm.reaction', txnId, {
      [ECLO_EVENT.reactionKey]: key,
      'm.relates_to': {
        rel_type: 'm.annotation',
        event_id: eventId,
        key: `${key}${Date.now()}`,
      },
    });
    this.emitter.emit(`timeline:${roomId}`);
    this.emitter.emit('rooms');
  }

  async inviteUser(roomId: string, userId: string): Promise<void> {
    const details = await this.getRoomDetails(roomId);
    if (!details.canInvite) {
      throw new Error('Chỉ quản trị viên hoặc trưởng nhóm mới có quyền mời thành viên.');
    }
    if (this.currentBaseUrl && this.currentAccessToken) {
      await this.matrixPost(`/rooms/${encodeURIComponent(roomId)}/invite`, {user_id: userId});
    } else {
      await this.requireRoom(roomId).inviteUserById(userId);
    }
    await this.primeRoomMembers(roomId).catch(() => undefined);
    this.emitter.emit(`timeline:${roomId}`);
    this.emitter.emit('rooms');
  }

  async kickUser(roomId: string, userId: string, reason = 'Removed from room'): Promise<void> {
    const details = await this.getRoomDetails(roomId);
    if (!details.canKick) {
      throw new Error('Bạn không có quyền xóa thành viên khỏi nhóm này.');
    }
    await this.matrixPost(`/rooms/${encodeURIComponent(roomId)}/kick`, {user_id: userId, reason});
    await this.primeRoomMembers(roomId).catch(() => undefined);
    this.emitter.emit(`timeline:${roomId}`);
    this.emitter.emit('rooms');
  }

  async pinMessage(roomId: string, eventId: string): Promise<void> {
    await (await this.requireTimeline(roomId)).pinEvent(eventId);
    this.emitter.emit(`timeline:${roomId}`);
    this.emitter.emit('rooms');
  }

  async unpinMessage(roomId: string, eventId: string): Promise<void> {
    await (await this.requireTimeline(roomId)).unpinEvent(eventId);
    this.emitter.emit(`timeline:${roomId}`);
    this.emitter.emit('rooms');
  }

  async redactMessage(roomId: string, eventId: string, reason = 'Thu hồi tin nhắn'): Promise<void> {
    await (await this.requireTimeline(roomId)).redactEvent(EventOrTransactionId.EventId.new({eventId}), reason);
    this.emitter.emit(`timeline:${roomId}`);
    this.emitter.emit('rooms');
  }

  async redactVisibleTimeline(roomId: string, reason = 'Xóa lịch sử cuộc trò chuyện'): Promise<number> {
    const items = this.getTimeline(roomId).filter(item => item.id && !item.id.startsWith('$local-'));
    let count = 0;
    for (const item of items) {
      await this.redactMessage(roomId, item.id, reason);
      count += 1;
    }
    return count;
  }

  async sendPoll(roomId: string, question: string, answers: string[]): Promise<void> {
    await (await this.requireTimeline(roomId)).createPoll(question, answers, 1, PollKind.Disclosed);
  }

  async sendPollResponse(roomId: string, pollEventId: string, answerId: string): Promise<void> {
    await (await this.requireTimeline(roomId)).sendPollResponse(pollEventId, [answerId]);
    this.emitter.emit(`timeline:${roomId}`);
    this.emitter.emit('rooms');
  }

  async loadMore(roomId: string): Promise<void> {
    await (await this.requireTimeline(roomId)).paginateBackwards(30);
  }

  async markRoomRead(roomId: string): Promise<void> {
    const room = this.requireRoom(roomId);
    const timeline = this.timelines.get(roomId)?.timeline;
    await Promise.all([
      timeline?.markAsRead(ReceiptType.Read).catch(() => undefined),
      room.markAsRead(ReceiptType.Read).catch(() => undefined),
      room.setUnreadFlag(false).catch(() => undefined),
    ]);
    this.emitter.emit('rooms');
  }

  async getRoomMuted(roomId: string): Promise<boolean> {
    const content = await this.accountDataJson<{rooms?: Record<string, boolean>}>(ECLO_EVENT.mute).catch(() => undefined);
    return Boolean(content?.rooms?.[roomId]);
  }

  async setRoomMuted(roomId: string, muted: boolean): Promise<void> {
    const content = await this.accountDataJson<{rooms?: Record<string, boolean>}>(ECLO_EVENT.mute).catch(() => undefined);
    const rooms: Record<string, boolean> = {...(content?.rooms ?? {})};
    if (muted) {
      rooms[roomId] = true;
    } else {
      delete rooms[roomId];
    }
    await this.requireClient().setAccountData(ECLO_EVENT.mute, JSON.stringify({rooms}));
    this.emitter.emit('rooms');
  }

  async getPinnedEventIds(roomId: string): Promise<string[]> {
    const content = await this.matrixGet<MatrixPinnedEventsResponse>(`/rooms/${encodeURIComponent(roomId)}/state/m.room.pinned_events/`).catch(() => ({pinned: []}));
    return content.pinned ?? [];
  }

  async getRoomPinned(roomId: string): Promise<boolean> {
    const content = await this.matrixGet<MatrixTagsResponse>(`/user/${encodeURIComponent(this.currentUserId ?? '')}/rooms/${encodeURIComponent(roomId)}/tags`).catch(() => ({tags: {}}));
    const tags: Record<string, unknown> = content.tags ?? {};
    return Boolean(tags['m.favourite']);
  }

  async setRoomPinned(roomId: string, pinned: boolean): Promise<void> {
    if (pinned) {
      await this.matrixRequest('PUT', `/user/${encodeURIComponent(this.currentUserId ?? '')}/rooms/${encodeURIComponent(roomId)}/tags/m.favourite`, {order: -Date.now()});
    } else {
      await this.matrixRequest('DELETE', `/user/${encodeURIComponent(this.currentUserId ?? '')}/rooms/${encodeURIComponent(roomId)}/tags/m.favourite`);
    }
    const cached = this.cachedRoomSummaries.get(roomId);
    if (cached) {
      this.cachedRoomSummaries.set(roomId, {...cached, pinned});
      await this.persistRoomSummaryCache();
    }
    this.emitter.emit('rooms');
  }

  async leaveRoom(roomId: string): Promise<void> {
    const room = this.requireRoom(roomId);
    await room.leave();
    await room.forget().catch(() => undefined);
    this.cachedRoomSummaries.delete(roomId);
    this.timelines.get(roomId)?.handle?.cancel();
    this.timelines.delete(roomId);
    this.emitter.emit('rooms');
  }

  async ignoreUser(userId: string): Promise<void> {
    await this.requireClient().ignoreUser(userId);
    this.emitter.emit('rooms');
  }

  async setupSecureBackup(passphrase: string, onProgress?: (message: string) => void): Promise<string> {
    const cleanPassphrase = passphrase.trim();
    if (cleanPassphrase.length < 6) {
      throw new Error('Mật khẩu sao lưu phải có ít nhất 6 ký tự.');
    }
    const status = await this.getSecurityStatus();
    if (!status.deviceTrusted) {
      throw new Error('Cần xác thực thiết bị này trước khi thiết lập sao lưu an toàn.');
    }
    const encryption = this.requireClient().encryption();
    const recoveryKey = await encryption.enableRecovery(false, cleanPassphrase, {
      onUpdate: progress => onProgress?.(securityProgressText(progress)),
    });
    await encryption.enableBackups().catch(() => undefined);
    void encryption.waitForBackupUploadSteadyState(undefined)
      .then(() => this.emitter.emit('security'))
      .catch(() => undefined);
    this.emitter.emit('security');
    return recoveryKey;
  }

  async replaceSecureBackup(passphrase: string, onProgress?: (message: string) => void): Promise<string> {
    const status = await this.getSecurityStatus();
    if (!status.deviceTrusted) {
      throw new Error('Cần xác thực thiết bị trước khi tạo sao lưu mới.');
    }
    await this.requireClient().encryption().disableRecovery();
    return this.setupSecureBackup(passphrase, onProgress);
  }

  async recover(recoveryKeyOrPassphrase: string): Promise<void> {
    const recoveryKey = normalizeRecoveryKey(recoveryKeyOrPassphrase);
    const encryption = this.requireClient().encryption();
    await encryption.waitForE2eeInitializationTasks();
    try {
      await encryption.recover(recoveryKey);
    } catch (error) {
      // The Matrix recovery helper also imports cross-signing secrets. Older
      // web-created stores may legitimately contain only the room-key backup
      // secret. Our native SDK patch imports that backup first; once it is
      // enabled, a later cross-signing import failure must not undo a
      // successful message-history restore.
      if (encryption.backupState() !== BackupState.Enabled || !isCrossSigningImportError(error)) {
        throw userFacingRecoveryError(error);
      }
      console.warn('[Security] Message backup restored without cross-signing identity', {
        detail: recoveryErrorDetail(error),
      });
    }

    if (encryption.backupState() !== BackupState.Enabled) {
      throw new Error('Mã khôi phục mở được kho khóa nhưng không tìm thấy bản sao lưu tin nhắn phù hợp.');
    }
    for (const state of this.timelines.values()) {
      state.timeline.retryDecryption([]);
    }
    await new Promise<void>(resolve => setTimeout(() => resolve(), 350));
    await this.mergeOpenedTimelineSummaries();
    void this.enrichMissingSummaries(this.getCachedRooms(), 12).catch(() => undefined);
    this.emitter.emit('rooms');
    this.emitter.emit('security');
  }

  async resetRecoveryKey(): Promise<string> {
    const status = await this.getSecurityStatus();
    if (!status.deviceTrusted || status.recoveryState !== 'enabled') {
      throw new Error('Thiết bị phải được xác thực và mở được kho khóa trước khi đổi Mã khôi phục.');
    }
    const recoveryKey = await this.requireClient().encryption().resetRecoveryKey();
    this.emitter.emit('security');
    return recoveryKey;
  }

  async resetIdentity(password: string): Promise<void> {
    if (!password) {
      throw new Error('Vui lòng nhập mật khẩu tài khoản để xác nhận.');
    }
    const handle = await this.requireClient().encryption().resetIdentity();
    if (!handle) {
      this.emitter.emit('security');
      return;
    }
    const authType = handle.authType();
    if (authType.tag === CrossSigningResetAuthType_Tags.Oidc) {
      await handle.cancel().catch(() => undefined);
      throw new Error('Tài khoản này yêu cầu xác nhận đăng nhập trên trình duyệt trước khi đặt lại danh tính.');
    }
    try {
      await handle.reset(SdkAuthData.Password.new({
        passwordDetails: {
          identifier: this.currentUserId ?? '',
          password,
        },
      }));
      await this.refreshOwnVerificationState().catch(() => false);
      this.emitter.emit('security');
    } catch (error) {
      await handle.cancel().catch(() => undefined);
      throw error;
    }
  }

  async requestDeviceVerification(): Promise<void> {
    this.verificationInitiatedByMe = true;
    this.setSecurityVerification({phase: 'requested'});
    try {
      const status = await this.getSecurityStatus();
      if (!status.hasDevicesToVerifyAgainst) {
        throw new Error('Không có thiết bị đã xác thực nào khác trong cùng tài khoản để nhận yêu cầu. Hãy dùng Mã khôi phục.');
      }
      const controller = await this.requireVerificationController();
      await controller.requestDeviceVerification();
    } catch (error) {
      this.verificationInitiatedByMe = false;
      this.setSecurityVerification({phase: 'failed'});
      throw error;
    }
  }

  async acceptDeviceVerification(): Promise<void> {
    const controller = await this.requireVerificationController();
    if (this.verificationRequest) {
      await controller.acknowledgeVerificationRequest(this.currentUserId ?? '', this.verificationRequest.flowId);
    }
    this.verificationInitiatedByMe = false;
    await controller.acceptVerificationRequest();
    this.setSecurityVerification({...this.securityVerification, phase: 'accepted'});
  }

  async startSasVerification(): Promise<void> {
    const controller = await this.requireVerificationController();
    await this.startSasWithController(controller);
  }

  async approveSasVerification(): Promise<void> {
    const controller = await this.requireVerificationController();
    this.setSecurityVerification({phase: 'confirmed'});
    try {
      await controller.approveVerification();
    } catch (error) {
      this.setSecurityVerification({...this.securityVerification, phase: 'sas'});
      throw error;
    }
  }

  async declineSasVerification(): Promise<void> {
    await (await this.requireVerificationController()).declineVerification();
  }

  async cancelDeviceVerification(): Promise<void> {
    await (await this.requireVerificationController()).cancelVerification();
    this.verificationInitiatedByMe = false;
    this.setSecurityVerification({phase: 'cancelled'});
  }

  private async restoreSession(auth: AuthData, storeId: string, onProgress?: (progress: NativeSessionProgress) => void): Promise<void> {
    onProgress?.({stage: 'restore', message: 'Khôi phục phiên đăng nhập...', progress: 0.38});
    const client = await this.buildClient(auth.baseUrl, storeId);
    onProgress?.({stage: 'restore', message: 'Mở kho tin nhắn an toàn...', progress: 0.48});
    await client.restoreSessionWith(
      Session.new({
        accessToken: auth.accessToken,
        userId: auth.userId,
        deviceId: auth.deviceId,
        homeserverUrl: auth.baseUrl,
        slidingSyncVersion: auth.nativeSlidingSyncVersion ?? SlidingSyncVersion.Native,
      }),
      RoomLoadSettings.All.new(),
    );
    await this.startClient(client, onProgress);
  }

  private async startClient(client: ClientLike, onProgress?: (progress: NativeSessionProgress) => void): Promise<void> {
    this.client = client;
    onProgress?.({stage: 'crypto', message: 'Đang chuẩn bị bảo mật...', progress: 0.62});
    await this.withTimeout(client.encryption().waitForE2eeInitializationTasks(), 12000, 'Khởi tạo bảo mật quá thời gian.').catch(() => undefined);
    await this.setupSecurityRuntime(client).catch(() => undefined);
    onProgress?.({stage: 'sync', message: 'Đồng bộ phòng và tin nhắn mới...', progress: 0.78});
    try {
      this.sync = await this.withTimeout(client.syncService().finish(), 12000, 'Đồng bộ phiên đăng nhập quá thời gian.');
      await this.setupRoomListRuntime(this.sync).catch(() => undefined);
      onProgress?.({stage: 'ready', message: 'Sẵn sàng mở trò chuyện.', progress: 1});
      this.syncPaused = !this.appActive;
      if (this.appActive) {
        this.sync.start().catch(() => undefined);
      }
      void this.refreshDirectRoomIds();
      if (!this.verificationController) {
        setTimeout(() => this.setupSecurityRuntime(client).catch(() => undefined), 1200);
      }
    } catch {
      onProgress?.({stage: 'ready', message: 'Đang dùng dữ liệu đã lưu. Sẽ tự đồng bộ khi có mạng.', progress: 1});
      this.scheduleSyncRetry(client);
      void this.refreshDirectRoomIds();
    }
    setTimeout(() => this.emitter.emit('rooms'), 1200);
  }

  private async setupRoomListRuntime(sync: SyncServiceLike): Promise<void> {
    this.roomListEntriesHandle?.cancel();
    this.roomListEntriesHandle = null;
    this.roomListEntries = null;
    this.roomList = null;
    const service = sync.roomListService();
    const roomList = await service.allRooms();
    const entries = roomList.entriesWithDynamicAdaptersWith(300, true, {
      onUpdate: updates => this.handleRoomListUpdates(updates),
    });
    this.roomListService = service;
    this.roomList = roomList;
    this.roomListEntries = entries;
    this.roomListEntriesHandle = entries.entriesStream();
  }

  private handleRoomListUpdates(updates: RoomListEntriesUpdate[]): void {
    const changedRooms = new Map<string, RoomLike>();
    let needsFullRefresh = false;
    for (const update of updates) {
      switch (update.tag) {
        case RoomListEntriesUpdate_Tags.Append:
          update.inner.values.forEach(room => changedRooms.set(room.id(), room));
          break;
        case RoomListEntriesUpdate_Tags.Reset:
          update.inner.values.forEach(room => changedRooms.set(room.id(), room));
          needsFullRefresh = true;
          break;
        case RoomListEntriesUpdate_Tags.PushFront:
        case RoomListEntriesUpdate_Tags.PushBack:
        case RoomListEntriesUpdate_Tags.Insert:
        case RoomListEntriesUpdate_Tags.Set:
          changedRooms.set(update.inner.value.id(), update.inner.value);
          break;
        case RoomListEntriesUpdate_Tags.Clear:
        case RoomListEntriesUpdate_Tags.PopFront:
        case RoomListEntriesUpdate_Tags.PopBack:
        case RoomListEntriesUpdate_Tags.Remove:
        case RoomListEntriesUpdate_Tags.Truncate:
          needsFullRefresh = true;
          break;
      }
    }
    for (const room of changedRooms.values()) {
      this.pendingRoomSummaryUpdates.set(room.id(), room);
      void this.emitLatestRoomCallEvent(room);
    }
    this.scheduleRoomRefresh(180, needsFullRefresh);
  }

  private async emitLatestRoomCallEvent(room: RoomLike): Promise<void> {
    const item = await room.latestEvent().catch(() => undefined);
    if (!item) {
      return;
    }
    const debug = this.timelineDebugJson(item);
    if (!debug?.type || !debug.content || !isLegacyCallEventType(debug.type)) {
      return;
    }
    const callId = debug.content.call_id;
    if (typeof callId !== 'string' || !callId) {
      return;
    }
    const eventId = this.eventId(item);
    if (this.emittedCallEventIds.has(eventId)) {
      return;
    }
    const timestamp = normalizeEventTimestamp(Number(item.timestamp));
    const invitee = typeof debug.content.invitee === 'string' ? debug.content.invitee : undefined;
    if (
      debug.type === 'm.call.invite'
      && item.sender !== this.currentUserId
      && (!invitee || invitee === this.currentUserId)
      && Date.now() - timestamp < 90_000
    ) {
      await this.observeCallSignals(room.id()).catch(() => undefined);
    }
    this.emittedCallEventIds.add(eventId);
    this.emitter.emit('callEvent', {
      eventId,
      roomId: room.id(),
      sender: item.sender,
      timestamp,
      type: debug.type,
      content: debug.content,
      source: 'timeline',
    } satisfies NativeCallEvent);
  }

  private scheduleRoomRefresh(delayMs = 180, full = false): void {
    if (!this.client || !this.appActive) {
      return;
    }
    this.roomRefreshNeedsFull ||= full;
    if (this.roomRefreshTimer) {
      return;
    }
    this.roomRefreshTimer = setTimeout(() => {
      this.roomRefreshTimer = null;
      void this.refreshRoomCache();
    }, delayMs);
  }

  private async refreshRoomCache(): Promise<void> {
    if (this.roomRefreshInFlight) {
      this.roomRefreshPending = true;
      return this.roomRefreshInFlight;
    }
    const full = this.roomRefreshNeedsFull || this.pendingRoomSummaryUpdates.size === 0;
    const changedRooms = [...this.pendingRoomSummaryUpdates.values()];
    this.roomRefreshNeedsFull = false;
    this.pendingRoomSummaryUpdates.clear();
    const operation = (async () => {
      if (full) {
        await this.listRooms();
      } else {
        const summaries = await Promise.all(changedRooms
          .filter(room => room.membership() === Membership.Joined)
          .map(room => this.roomSummary(room)));
        if (summaries.length) {
          await this.mergeRoomSummaryCache(summaries);
          void this.enrichMissingSummaries(summaries, 1).catch(() => undefined);
        }
      }
      this.emitter.emit('rooms');
    })();
    this.roomRefreshInFlight = operation;
    try {
      await operation;
    } catch {
      // Sliding Sync will deliver another room-list update after reconnecting.
    } finally {
      if (this.roomRefreshInFlight === operation) {
        this.roomRefreshInFlight = null;
      }
      if (this.roomRefreshPending) {
        this.roomRefreshPending = false;
        this.scheduleRoomRefresh();
      }
    }
  }

  private async setupSecurityRuntime(client: ClientLike): Promise<void> {
    for (const handle of this.securityListenerHandles) {
      handle.cancel();
    }
    this.securityListenerHandles = [];
    const encryption = client.encryption();
    this.securityListenerHandles.push(
      encryption.backupStateListener({onUpdate: () => this.emitter.emit('security')}),
      encryption.recoveryStateListener({onUpdate: () => this.emitter.emit('security')}),
      encryption.verificationStateListener({onUpdate: state => {
        if (state === VerificationState.Verified && ['requested', 'accepted', 'sas', 'confirmed'].includes(this.securityVerification.phase)) {
          this.completeSecurityVerification();
          return;
        }
        this.emitter.emit('security');
      }}),
    );
    const controller = await client.getSessionVerificationController();
    this.verificationController = controller;
    controller.setDelegate({
      didReceiveVerificationRequest: details => {
        this.verificationRequest = details;
        this.verificationInitiatedByMe = false;
        this.setSecurityVerification({phase: 'incoming', deviceName: details.deviceDisplayName});
      },
      didAcceptVerificationRequest: () => {
        this.setSecurityVerification({...this.securityVerification, phase: 'accepted'});
        if (this.verificationInitiatedByMe) {
          this.startSasWithController(controller).catch(() => {
            this.setSecurityVerification({phase: 'failed'});
          });
        }
      },
      didStartSasVerification: () => {
        this.setSecurityVerification({...this.securityVerification, phase: 'sas'});
      },
      didReceiveVerificationData: data => {
        this.setSecurityVerification(verificationDataState(data, this.securityVerification.deviceName));
      },
      didFail: () => {
        this.verificationInitiatedByMe = false;
        this.setSecurityVerification({phase: 'failed'});
      },
      didCancel: () => {
        this.verificationInitiatedByMe = false;
        this.setSecurityVerification({phase: 'cancelled'});
      },
      didFinish: () => {
        this.finalizeSecurityVerification(client);
      },
    });
    void this.refreshOwnVerificationState(client).catch(() => false);
  }

  private completeSecurityVerification(): void {
    if (this.securityVerification.phase === 'done') {
      return;
    }
    this.verificationRequest = null;
    this.verificationInitiatedByMe = false;
    this.setSecurityVerification({phase: 'done'});
    this.emitter.emit('security');
  }

  private finalizeSecurityVerification(client: ClientLike): void {
    if (this.securityVerification.phase === 'done') {
      return;
    }
    if (client.encryption().verificationState() === VerificationState.Verified) {
      this.completeSecurityVerification();
      return;
    }
    if (this.verificationTrustRefreshInFlight) {
      return;
    }
    this.setSecurityVerification({...this.securityVerification, phase: 'confirmed'});
    const operation = (async () => {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        if (this.client !== client) {
          return;
        }
        if (await this.refreshOwnVerificationState(client).catch(() => false)) {
          this.completeSecurityVerification();
          return;
        }
        await new Promise<void>(resolve => setTimeout(() => resolve(), 1000));
      }
      if (this.client === client && this.securityVerification.phase === 'confirmed') {
        this.setSecurityVerification({phase: 'failed'});
      }
    })();
    this.verificationTrustRefreshInFlight = operation;
    void operation.finally(() => {
      if (this.verificationTrustRefreshInFlight === operation) {
        this.verificationTrustRefreshInFlight = null;
      }
    });
  }

  private async refreshOwnVerificationState(expectedClient?: ClientLike): Promise<boolean> {
    const client = expectedClient ?? this.requireClient();
    if (this.client !== client || !this.currentUserId) {
      return false;
    }
    const encryption = client.encryption();
    await encryption.userIdentity(this.currentUserId, true);
    const verified = encryption.verificationState() === VerificationState.Verified;
    this.emitter.emit('security');
    return verified;
  }

  private async requireVerificationController(): Promise<SessionVerificationControllerLike> {
    if (this.verificationController) {
      return this.verificationController;
    }
    await this.setupSecurityRuntime(this.requireClient());
    if (!this.verificationController) {
      throw new Error('Không thể khởi tạo luồng xác thực thiết bị.');
    }
    return this.verificationController;
  }

  private async startSasWithController(controller: SessionVerificationControllerLike): Promise<void> {
    if (this.sasStartInFlight) {
      return;
    }
    this.sasStartInFlight = true;
    try {
      await controller.startSasVerification();
      this.setSecurityVerification({...this.securityVerification, phase: 'sas'});
    } finally {
      this.sasStartInFlight = false;
    }
  }

  private setSecurityVerification(next: SecurityVerification): void {
    this.securityVerification = next;
    this.emitter.emit('security');
  }

  private scheduleSyncRetry(client: ClientLike): void {
    if (this.syncRetryTimer || this.sync || this.client !== client || !this.appActive) {
      return;
    }
    const delayMs = this.syncRetryDelayMs;
    this.syncRetryTimer = setTimeout(async () => {
      this.syncRetryTimer = null;
      if (this.sync || this.client !== client || !this.appActive) {
        return;
      }
      try {
        this.sync = await this.withTimeout(client.syncService().finish(), 12000, 'Đồng bộ phiên đăng nhập quá thời gian.');
        await this.setupRoomListRuntime(this.sync).catch(() => undefined);
        this.syncRetryDelayMs = 5_000;
        this.syncPaused = false;
        this.sync.start().catch(() => undefined);
        this.emitter.emit('rooms');
      } catch {
        this.syncRetryDelayMs = Math.min(this.syncRetryDelayMs * 2, 60_000);
        this.scheduleSyncRetry(client);
      }
    }, delayMs);
  }

  private withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), ms);
      promise
        .then(value => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch(error => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  private async requireTimeline(roomId: string): Promise<TimelineLike> {
    await this.openTimeline(roomId);
    const timeline = this.timelines.get(roomId)?.timeline;
    if (!timeline) {
      throw new Error('Cuộc trò chuyện chưa sẵn sàng. Vui lòng thử lại.');
    }
    return timeline;
  }

  private async localUploadPath(upload: NativeMediaUpload): Promise<string> {
    const uri = upload.uri.trim();
    if (!uri) {
      throw new Error('Tệp đã chọn không có đường dẫn cục bộ.');
    }
    const safeName = (upload.fileName ?? `media-${Date.now()}`)
      .replace(/[^a-z0-9._-]+/gi, '-')
      .slice(-120);
    const target = `${RNFS.CachesDirectoryPath}/matrix-upload-${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}`;
    let source = uri;
    if (uri.startsWith('file://')) {
      try {
        source = decodeURIComponent(uri.slice('file://'.length));
      } catch {
        source = uri.slice('file://'.length);
      }
    }
    await RNFS.copyFile(source, target);
    const stat = await RNFS.stat(target).catch(() => undefined);
    if (!stat || Number(stat.size) <= 0) {
      await RNFS.unlink(target).catch(() => undefined);
      throw new Error('Không đọc được dữ liệu của tệp đã chọn.');
    }
    return target;
  }

  private async uploadSource(path: string, fileName: string | undefined, size: number): Promise<UploadSource> {
    const logicalName = (fileName?.trim() || path.split('/').at(-1) || `attachment-${Date.now()}`)
      .replace(/[\\/\u0000-\u001f]+/g, '-')
      .slice(-180);
    // Passing Photo Picker temporary paths directly to the Rust FFI can result
    // in RoomError.InvalidAttachmentData on iOS. In-memory data avoids that
    // contract edge for normal attachments while large videos stay streamed.
    if (size <= 24 * 1024 * 1024) {
      const base64 = await RNFS.readFile(path, 'base64');
      const bytes = Buffer.from(base64, 'base64');
      const arrayBuffer = Uint8Array.from(bytes).buffer;
      return UploadSource.Data.new({bytes: arrayBuffer, filename: logicalName});
    }
    return UploadSource.File.new({filename: path});
  }

  private async buildClient(baseUrl: string, storeId: string): Promise<ClientLike> {
    this.initPlatformOnce();
    const basePath = this.storePath(storeId);
    await RNFS.mkdir(basePath);
    return new ClientBuilder()
      .homeserverUrl(baseUrl)
      .autoEnableCrossSigning(true)
      .backupDownloadStrategy(BackupDownloadStrategy.OneShot)
      .slidingSyncVersionBuilder(SlidingSyncVersionBuilder.DiscoverNative)
      .sessionPaths(`${basePath}/data`, `${basePath}/cache`)
      .build();
  }

  private async destroyStore(storeId: string): Promise<void> {
    const basePath = this.storePath(storeId);
    if (await RNFS.exists(basePath)) {
      await RNFS.unlink(basePath).catch(() => undefined);
    }
  }

  private storePath(storeId: string): string {
    return `${RNFS.DocumentDirectoryPath}/matrix-rust/${storeId}`;
  }

  private initPlatformOnce() {
    if (this.platformReady) {
      return;
    }
    initPlatform(
      TracingConfiguration.new({
        logLevel: LogLevel.Info,
        traceLogPacks: [],
        extraTargets: [],
        writeToStdoutOrSystem: true,
      }),
      false,
    );
    this.platformReady = true;
  }

  private authFromSession(session: Session, nativeStoreId: string): AuthData {
    return {
      userId: session.userId,
      accessToken: session.accessToken,
      deviceId: session.deviceId,
      baseUrl: session.homeserverUrl,
      nativeStoreId,
      nativeSlidingSyncVersion: session.slidingSyncVersion,
    };
  }

  private async roomSummary(room: RoomLike): Promise<NativeRoomSummary> {
    const hiddenBefore = await this.loadHiddenHistoryCutoff(room.id());
    const cached = this.cachedRoomSummaries.get(room.id());
    const [encrypted, latest, uiLatest, info, direct] = await Promise.all([
      room.isEncrypted().catch(() => room.encryptionState() === EncryptionState.Encrypted),
      room.latestEvent().catch(() => undefined),
      room.newLatestEvent().catch(() => undefined),
      room.roomInfo().catch(() => undefined),
      room.isDirect().catch(() => false),
    ]);
    const pinned = cached?.pinned ?? false;
    const joinedMembersCount = Number(room.joinedMembersCount());
    const invitedMembersCount = Number(room.invitedMembersCount());
    const isDirect = await this.resolveRoomIsDirect(room, {cached, info, sdkDirect: direct});
    const rawLatestSummary = this.summaryFromLatestEvent(uiLatest) ?? (latest ? this.summaryFromTimelineEvent(latest) : undefined);
    const latestSummary = rawLatestSummary && rawLatestSummary.timestamp > hiddenBefore ? rawLatestSummary : undefined;
    const visibleCached = cached?.lastTimestamp && cached.lastTimestamp > hiddenBefore ? cached : undefined;
    const openedLatestEvent = this.timelines.get(room.id())
      ? this.latestTimelineEvent(this.timelines.get(room.id())?.items ?? [])
      : undefined;
    const openedLatest = openedLatestEvent ? this.summaryFromTimelineEvent(openedLatestEvent) : undefined;
    const stableLatest = [
      latestSummary,
      openedLatest && openedLatest.timestamp > hiddenBefore ? openedLatest : undefined,
      visibleCached?.lastTimestamp ? {body: visibleCached.lastMessage ?? '', timestamp: visibleCached.lastTimestamp} : undefined,
    ]
      .filter((item): item is {body: string; timestamp: number} => Boolean(item))
      .sort((a, b) => b.timestamp - a.timestamp || Number(isEncryptedRoomPreview(a.body)) - Number(isEncryptedRoomPreview(b.body)))[0];
    const other = isDirect ? await this.otherRoomMember(room) : undefined;
    const heroAvatar = room.heroes().find(hero => hero.userId !== this.currentUserId)?.avatarUrl;
    const avatarUrl = this.matrixMediaUrl(info?.avatarUrl ?? room.avatarUrl() ?? other?.avatarUrl ?? heroAvatar) ?? cached?.avatarUrl;
    return {
      roomId: room.id(),
      name: room.displayName() ?? room.rawName() ?? room.id(),
      avatarUrl,
      encrypted,
      pinned,
      isDirect,
      joinedMembersCount,
      invitedMembersCount,
      isPendingDirectRequest: isDirect && joinedMembersCount <= 1 && !latestSummary,
      lastMessage: stableLatest?.body,
      lastTimestamp: stableLatest?.timestamp,
      unreadCount: info ? Number(info.numUnreadMessages) : 0,
    };
  }

  private async resolveRoomIsDirect(
    room: RoomLike,
    options: {
      cached?: NativeRoomSummary;
      info?: {isDirect?: boolean};
      sdkDirect?: boolean;
      waitForAccountDataMs?: number;
    } = {},
  ): Promise<boolean> {
    if (options.waitForAccountDataMs && !this.directRoomIdsLoaded) {
      await this.withTimeout(
        this.refreshDirectRoomIds(),
        options.waitForAccountDataMs,
        'm.direct lookup timed out.',
      ).catch(() => undefined);
    } else if (!this.directRoomIdsLoaded) {
      void this.refreshDirectRoomIds();
    }

    const joinedMembersCount = Number(room.joinedMembersCount());
    const invitedMembersCount = Number(room.invitedMembersCount());
    const unnamedTwoPersonRoom = joinedMembersCount <= 2 && invitedMembersCount === 0 && !room.rawName();
    return Boolean(
      options.sdkDirect
      || options.info?.isDirect
      || this.directRoomIds.has(room.id())
      || options.cached?.isDirect
      || unnamedTwoPersonRoom
    );
  }

  private async contactFromDirectRoom(room: RoomLike): Promise<ContactRecord | null> {
    const direct = await this.resolveRoomIsDirect(room, {
      cached: this.cachedRoomSummaries.get(room.id()),
      sdkDirect: await room.isDirect().catch(() => false),
    });
    if (!direct) {
      return null;
    }
    if (this.isNativeInactiveDirectRoom(room)) {
      return null;
    }
    const other = await this.otherRoomMember(room);
    const userId = other?.userId ?? room.heroes().find(hero => hero.userId !== this.currentUserId)?.userId;
    if (!userId) {
      return null;
    }
    const memberDisplayName = other?.displayName ?? await room.memberDisplayName(userId).catch(() => undefined);
    return {
      userId,
      roomId: room.id(),
      displayName: memberDisplayName ?? room.displayName() ?? userId,
      avatarUrl: this.matrixMediaUrl(other?.avatarUrl),
      source: 'dm',
    };
  }

  private async otherRoomMember(room: RoomLike): Promise<{userId: string; displayName?: string; avatarUrl?: string} | undefined> {
    const iterator = await room.members().catch(() => undefined);
    const members = iterator?.nextChunk(Math.max(iterator.len(), 20)) ?? [];
    return members.find(member => member.userId !== this.currentUserId);
  }

  private async primeRoomMembers(roomId: string): Promise<void> {
    const room = this.requireRoom(roomId);
    const iterator = await room.members().catch(() => undefined);
    const members = iterator?.nextChunk(Math.max(Number(iterator.len()), 40)) ?? [];
    const profiles = new Map<string, NativeRoomMember>();
    for (const member of members) {
      profiles.set(member.userId, {
        userId: member.userId,
        displayName: member.displayName,
        avatarUrl: this.matrixMediaUrl(member.avatarUrl),
      });
    }
    this.roomMemberProfiles.set(roomId, profiles);
  }

  private async joinedRoomMembers(roomId: string): Promise<NativeRoomMember[]> {
    if (!this.currentBaseUrl || !this.currentAccessToken) {
      return [...(this.roomMemberProfiles.get(roomId)?.values() ?? [])];
    }
    const response = await this.matrixGet<MatrixJoinedMembersResponse>(`/rooms/${encodeURIComponent(roomId)}/members?membership=join`);
    return (response.chunk ?? [])
      .filter(event => event.state_key && event.content?.membership === 'join')
      .map(event => ({
        userId: event.state_key as string,
        displayName: event.content?.displayname,
        avatarUrl: this.matrixMediaUrl(event.content?.avatar_url),
      }));
  }

  private async accountDataJson<T>(eventType: string): Promise<T | undefined> {
    const raw = await this.requireClient().accountData(eventType).catch(() => undefined);
    if (!raw) {
      return undefined;
    }
    return JSON.parse(raw) as T;
  }

  private async userIsOnline(userId: string): Promise<boolean> {
    const presence = await this.matrixGet<MatrixPresenceResponse>(`/presence/${encodeURIComponent(userId)}/status`);
    return presence.currently_active === true || presence.presence === 'online';
  }

  private matrixMediaUrl(uri?: string): string | undefined {
    if (!uri) {
      return undefined;
    }
    if (/^https?:\/\//i.test(uri)) {
      return uri;
    }
    const match = uri.match(/^mxc:\/\/([^/]+)\/(.+)$/);
    if (!match || !this.currentBaseUrl) {
      return undefined;
    }
    const serverName = match[1];
    const mediaId = match[2];
    if (!serverName || !mediaId) {
      return undefined;
    }
    const params = new URLSearchParams({
      width: '128',
      height: '128',
      method: 'crop',
    });
    if (this.currentAccessToken) {
      params.set('access_token', this.currentAccessToken);
    }
    return `${this.currentBaseUrl.replace(/\/+$/, '')}/_matrix/client/v1/media/thumbnail/${encodeURIComponent(serverName)}/${encodeURIComponent(mediaId)}?${params.toString()}`;
  }

  private matrixMediaDownloadUrl(uri?: string): string | undefined {
    if (!uri) {
      return undefined;
    }
    if (/^https?:\/\//i.test(uri) || uri.startsWith('file://')) {
      return uri;
    }
    const match = uri.match(/^mxc:\/\/([^/]+)\/(.+)$/);
    if (!match || !this.currentBaseUrl) {
      return undefined;
    }
    const serverName = match[1];
    const mediaId = match[2];
    if (!serverName || !mediaId) {
      return undefined;
    }
    const params = new URLSearchParams();
    if (this.currentAccessToken) {
      params.set('access_token', this.currentAccessToken);
    }
    const query = params.toString();
    return `${this.currentBaseUrl.replace(/\/+$/, '')}/_matrix/client/v1/media/download/${encodeURIComponent(serverName)}/${encodeURIComponent(mediaId)}${query ? `?${query}` : ''}`;
  }

  private async sendMatrixEvent(roomId: string, eventType: string, txnId: string, content: Record<string, unknown>): Promise<void> {
    await this.matrixRequest(
      'PUT',
      `/rooms/${encodeURIComponent(roomId)}/send/${encodeURIComponent(eventType)}/${encodeURIComponent(txnId)}`,
      content,
    );
  }

  private async matrixPost(path: string, body: Record<string, unknown>): Promise<void> {
    await this.matrixRequest('POST', path, body);
  }

  private async matrixGet<T>(path: string): Promise<T> {
    if (!this.currentBaseUrl || !this.currentAccessToken) {
      throw new Error('Phiên đăng nhập chưa sẵn sàng.');
    }
    const response = await fetch(`${this.currentBaseUrl.replace(/\/+$/, '')}/_matrix/client/v3${path}`, {
      headers: {
        Authorization: `Bearer ${this.currentAccessToken}`,
      },
    });
    if (!response.ok) {
      let message = `Yêu cầu chưa hoàn tất (${response.status})`;
      try {
        const payload = await response.json();
        message = String(payload.error ?? payload.errcode ?? message);
      } catch {
        // Keep the HTTP status when the homeserver does not return JSON.
      }
      throw new Error(message);
    }
    return response.json() as Promise<T>;
  }

  private async refreshDirectRoomIds(): Promise<void> {
    if (this.directRoomIdsLoaded || this.directRoomIdsRefreshInFlight || !this.currentUserId) {
      return this.directRoomIdsRefreshInFlight ?? Promise.resolve();
    }
    const now = Date.now();
    if (this.directRoomIdsLastAttemptAt && now - this.directRoomIdsLastAttemptAt < 10000) {
      return Promise.resolve();
    }
    this.directRoomIdsLastAttemptAt = now;
    const operation = (async () => {
      try {
        const content = await this.matrixGet<Record<string, string[]>>(
          `/user/${encodeURIComponent(this.currentUserId ?? '')}/account_data/m.direct`,
        );
        const next = new Set(Object.values(content).flat().filter(roomId => typeof roomId === 'string'));
        const changed = next.size !== this.directRoomIds.size
          || [...next].some(roomId => !this.directRoomIds.has(roomId));
        this.directRoomIds = next;
        this.directRoomIdsLoaded = true;
        if (changed) {
          this.emitter.emit('rooms');
        }
      } catch {
        // room.isDirect() remains the fallback if m.direct is unavailable.
        this.directRoomIdsLoaded = false;
      }
    })();
    this.directRoomIdsRefreshInFlight = operation;
    void operation.finally(() => {
      if (this.directRoomIdsRefreshInFlight === operation) {
        this.directRoomIdsRefreshInFlight = null;
      }
    });
    return operation;
  }

  private async matrixRequest(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: Record<string, unknown>): Promise<void> {
    if (!this.currentBaseUrl || !this.currentAccessToken) {
      throw new Error('Phiên đăng nhập chưa sẵn sàng.');
    }
    const response = await fetch(`${this.currentBaseUrl.replace(/\/+$/, '')}/_matrix/client/v3${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.currentAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      let message = `Yêu cầu chưa hoàn tất (${response.status})`;
      try {
        const payload = await response.json();
        message = String(payload.error ?? payload.errcode ?? message);
      } catch {
        // Keep the HTTP status when the homeserver does not return JSON.
      }
      throw new Error(message);
    }
  }

  private async getPowerLevelState(roomId: string): Promise<MatrixPowerLevels | undefined> {
    return this.matrixGet<MatrixPowerLevels>(`/rooms/${encodeURIComponent(roomId)}/state/m.room.power_levels/`);
  }

  private async getRoomCreator(roomId: string): Promise<string> {
    const create = await this.matrixGet<{creator?: string}>(`/rooms/${encodeURIComponent(roomId)}/state/m.room.create/`);
    return String(create.creator ?? '');
  }

  private async directRoomForUser(userId: string, includePending = true): Promise<RoomLike | undefined> {
    const matches: Array<{room: RoomLike; timestamp: number}> = [];
    for (const room of this.requireClient().rooms()) {
      if (room.membership() !== Membership.Joined && room.membership() !== Membership.Invited) {
        continue;
      }
      const direct = await this.resolveRoomIsDirect(room, {
        cached: this.cachedRoomSummaries.get(room.id()),
        sdkDirect: await room.isDirect().catch(() => false),
      });
      if (!direct) {
        continue;
      }
      if (!includePending && this.isNativeInactiveDirectRoom(room)) {
        continue;
      }
      if (includePending && this.isNativeInactiveDirectRoom(room) && !this.isNativePendingOutgoingDirectRequest(room)) {
        continue;
      }
      const other = await this.otherRoomMember(room);
      const hero = room.heroes().find(item => item.userId === userId);
      if (other?.userId === userId || hero) {
        const latest = await room.latestEvent().catch(() => undefined);
        matches.push({room, timestamp: latest ? Number(latest.timestamp) : 0});
      }
    }
    return matches.sort((a, b) => b.timestamp - a.timestamp).at(0)?.room;
  }

  private isNativePendingOutgoingDirectRequest(room: RoomLike): boolean {
    return room.joinedMembersCount() <= BigInt(1) && room.invitedMembersCount() > BigInt(0);
  }

  private isNativeInactiveDirectRoom(room: RoomLike): boolean {
    return room.joinedMembersCount() <= BigInt(1);
  }

  private async enrichMissingSummaries(summaries: NativeRoomSummary[], limit = 1): Promise<void> {
    const missing = summaries
      .filter(summary => (
        (!summary.lastTimestamp || isEncryptedRoomPreview(summary.lastMessage))
        && !this.enrichingRooms.has(summary.roomId)
        && !this.summaryEnrichmentAttemptedRooms.has(summary.roomId)
      ))
      .slice(0, limit);
    if (!missing.length) {
      return;
    }

    await Promise.all(missing.map(async summary => {
      this.enrichingRooms.add(summary.roomId);
      this.summaryEnrichmentAttemptedRooms.add(summary.roomId);
      try {
        const timelineSummary = await this.timelineSummary(summary.roomId);
        if (timelineSummary) {
          await this.mergeRoomSummaryCache([{
            ...summary,
            lastMessage: timelineSummary.body,
            lastTimestamp: timelineSummary.timestamp,
          }]);
          this.emitter.emit('rooms');
        }
      } finally {
        this.enrichingRooms.delete(summary.roomId);
      }
    }));
  }

  private async mergeOpenedTimelineSummaries(): Promise<void> {
    const updates: NativeRoomSummary[] = [];
    for (const [roomId, state] of this.timelines) {
      const cached = this.cachedRoomSummaries.get(roomId);
      const latest = this.latestTimelineEvent(state.items);
      if (!cached || !latest) {
        continue;
      }
      const summary = this.summaryFromTimelineEvent(latest);
      const cutoff = await this.loadHiddenHistoryCutoff(roomId);
      if (summary.timestamp > cutoff) {
        updates.push({...cached, lastMessage: summary.body, lastTimestamp: summary.timestamp});
      }
    }
    if (updates.length) {
      await this.mergeRoomSummaryCache(updates);
    }
  }

  private async updateOpenedTimelineSummary(roomId: string, items: TimelineItemLike[]): Promise<void> {
    const cached = this.cachedRoomSummaries.get(roomId);
    const latest = this.latestTimelineEvent(items);
    if (!cached || !latest) {
      return;
    }
    const summary = this.summaryFromTimelineEvent(latest);
    const cutoff = await this.loadHiddenHistoryCutoff(roomId);
    if (summary.timestamp > cutoff) {
      await this.mergeRoomSummaryCache([{
        ...cached,
        lastMessage: summary.body,
        lastTimestamp: summary.timestamp,
      }]);
    }
  }

  private async loadRoomSummaryCache(userId: string): Promise<void> {
    const raw = await AsyncStorage.getItem(this.roomSummaryCacheKey(userId)).catch(() => null);
    if (!raw) {
      this.cachedRoomSummaries.clear();
      return;
    }
    try {
      const items = JSON.parse(raw) as NativeRoomSummary[];
      this.cachedRoomSummaries = new Map(items.map(item => [item.roomId, item]));
    } catch {
      this.cachedRoomSummaries.clear();
    }
  }

  private async mergeRoomSummaryCache(summaries: NativeRoomSummary[]): Promise<void> {
    for (const summary of summaries) {
      const cached = this.cachedRoomSummaries.get(summary.roomId);
      const keepCachedLast = cached?.lastTimestamp && summary.lastTimestamp && summary.lastTimestamp < cached.lastTimestamp;
      const keepDecryptedAtSameTimestamp = Boolean(
        cached?.lastTimestamp
        && summary.lastTimestamp === cached.lastTimestamp
        && !isEncryptedRoomPreview(cached.lastMessage)
        && isEncryptedRoomPreview(summary.lastMessage),
      );
      this.cachedRoomSummaries.set(summary.roomId, {
        ...cached,
        ...summary,
        isDirect: Boolean(cached?.isDirect || summary.isDirect || this.directRoomIds.has(summary.roomId)),
        lastMessage: keepCachedLast || keepDecryptedAtSameTimestamp ? cached?.lastMessage : summary.lastMessage ?? cached?.lastMessage,
        lastTimestamp: keepCachedLast || keepDecryptedAtSameTimestamp ? cached?.lastTimestamp : summary.lastTimestamp ?? cached?.lastTimestamp,
      });
    }
    await this.persistRoomSummaryCache();
  }

  private pruneRoomSummaryCache(activeRoomIds: string[]): void {
    const active = new Set(activeRoomIds);
    for (const roomId of this.cachedRoomSummaries.keys()) {
      if (!active.has(roomId)) {
        this.cachedRoomSummaries.delete(roomId);
      }
    }
  }

  private async persistRoomSummaryCache(): Promise<void> {
    if (this.roomSummaryPersistTimer) {
      return;
    }
    this.roomSummaryPersistTimer = setTimeout(() => {
      this.roomSummaryPersistTimer = null;
      void this.persistRoomSummaryCacheNow();
    }, 500);
  }

  private async persistRoomSummaryCacheNow(): Promise<void> {
    if (!this.currentUserId) {
      return;
    }
    const items = [...this.cachedRoomSummaries.values()]
      .sort((a, b) => {
        const pinDiff = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
        return pinDiff || (b.lastTimestamp ?? 0) - (a.lastTimestamp ?? 0);
      })
      .slice(0, 300);
    await AsyncStorage.setItem(this.roomSummaryCacheKey(this.currentUserId), JSON.stringify(items)).catch(() => undefined);
  }

  private roomSummaryCacheKey(userId: string): string {
    return `eclo:room-summary:${encodeURIComponent(userId)}`;
  }

  private async loadHiddenHistoryCutoff(roomId: string): Promise<number> {
    if (this.loadedHiddenHistoryRooms.has(roomId)) {
      return this.hiddenHistoryBefore.get(roomId) ?? 0;
    }
    this.loadedHiddenHistoryRooms.add(roomId);
    if (!this.currentUserId) {
      return 0;
    }
    const raw = await AsyncStorage.getItem(this.hiddenHistoryKey(this.currentUserId, roomId)).catch(() => null);
    const cutoff = Number(raw ?? 0);
    if (Number.isFinite(cutoff) && cutoff > 0) {
      this.hiddenHistoryBefore.set(roomId, cutoff);
      return cutoff;
    }
    return 0;
  }

  private hiddenHistoryKey(userId: string, roomId: string): string {
    return `eclo:hidden-history:${encodeURIComponent(userId)}:${encodeURIComponent(roomId)}`;
  }

  private async timelineSummary(roomId: string): Promise<{body: string; timestamp: number} | undefined> {
    const cutoff = await this.loadHiddenHistoryCutoff(roomId);
    const existing = this.timelines.get(roomId);
    if (existing) {
      const last = this.latestTimelineEvent(existing.items);
      const summary = last ? this.summaryFromTimelineEvent(last) : undefined;
      return summary && summary.timestamp > cutoff ? summary : undefined;
    }
    const items = await this.openTimeline(roomId).catch(() => []);
    const last = items
      .filter(item => item.type === TimelineItemContent_Tags.MsgLike || isVisibleLegacyCallEventType(item.type))
      .reduce<TimelineItem | undefined>((latest, item) => item.timestamp > (latest?.timestamp ?? 0) ? item : latest, undefined);
    return last ? {body: last.body || (last.type === 'm.room.encrypted' ? 'Tin nhắn chưa hiển thị' : `[${last.type}]`), timestamp: last.timestamp} : undefined;
  }

  private summaryFromLatestEvent(value: unknown): {body: string; timestamp: number} | undefined {
    const latest = value as {tag?: string; inner?: {content?: unknown; timestamp?: number | bigint}} | undefined;
    if (!latest?.inner || (latest.tag !== 'Remote' && latest.tag !== 'Local')) {
      return undefined;
    }
    if (!this.isMessageLikeContent(latest.inner.content)) {
      return undefined;
    }
    const messageKind = (latest.inner.content as any)?.inner?.content?.kind?.tag;
    // `Other` is where the native SDK currently exposes legacy m.call.* events.
    // Prefer room.latestEvent() for these because it includes the original event
    // type, allowing us to hide candidates/answers while keeping invite/hangup.
    if (messageKind === 'Other' || messageKind === 'Redacted') {
      return undefined;
    }
    return {
      body: this.bodyFromContent(latest.inner.content, true),
      timestamp: Number(latest.inner.timestamp ?? 0),
    };
  }

  private summaryFromTimelineEvent(item: NonNullable<ReturnType<TimelineItemLike['asEvent']>>): {body: string; timestamp: number} {
    const debug = this.timelineDebugJson(item);
    const rawContent = this.rawContentFromDebug(debug);
    return {
      body: callEventPreviewLabel(debug?.type, rawContent, item.isOwn) ?? this.body(item, true, rawContent, debug?.type),
      timestamp: Number(item.timestamp),
    };
  }

  private latestTimelineEvent(items: TimelineItemLike[]): NonNullable<ReturnType<TimelineItemLike['asEvent']>> | undefined {
    return items
      .map(item => item.asEvent())
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .filter(item => this.isMessageLikeContent(item.content) || isVisibleLegacyCallEventType(this.timelineDebugJson(item)?.type))
      .reduce<NonNullable<ReturnType<TimelineItemLike['asEvent']>> | undefined>((latest, item) => (
        Number(item.timestamp) > Number(latest?.timestamp ?? 0) ? item : latest
      ), undefined);
  }

  private isMessageLikeContent(contentValue: unknown): boolean {
    const content = contentValue as any;
    return content?.tag === TimelineItemContent_Tags.MsgLike;
  }

  private timelineItems(roomId: string, items: TimelineItemLike[]): TimelineItem[] {
    const cutoff = this.hiddenHistoryBefore.get(roomId) ?? 0;
    const mapped = this.mapItems(items, roomId).filter(item => item.timestamp > cutoff);
    if (this.currentUserId) {
      const signature = `${mapped.length}:${mapped.at(-1)?.id ?? ''}:${mapped.at(-1)?.body ?? ''}`;
      if (this.searchIndexSignatures.get(roomId) !== signature) {
        this.searchIndexSignatures.set(roomId, signature);
        localSearchIndexService.indexTimeline(this.currentUserId, roomId, mapped).catch(() => undefined);
      }
    }
    this.prefetchTimelineMedia(roomId, mapped).catch(() => undefined);
    return mapped;
  }

  private applyDiffs(roomId: string, diffs: TimelineDiff[]) {
    const state = this.timelines.get(roomId);
    if (!state) {
      return;
    }
    for (const diff of diffs) {
      switch (diff.tag) {
        case TimelineDiff_Tags.Append:
          state.items.push(...diff.inner.values);
          break;
        case TimelineDiff_Tags.Clear:
          state.items = [];
          break;
        case TimelineDiff_Tags.PushFront:
          state.items.unshift(diff.inner.value);
          break;
        case TimelineDiff_Tags.PushBack:
          state.items.push(diff.inner.value);
          break;
        case TimelineDiff_Tags.PopFront:
          state.items.shift();
          break;
        case TimelineDiff_Tags.PopBack:
          state.items.pop();
          break;
        case TimelineDiff_Tags.Insert:
          state.items.splice(diff.inner.index, 0, diff.inner.value);
          break;
        case TimelineDiff_Tags.Set:
          state.items[diff.inner.index] = diff.inner.value;
          break;
        case TimelineDiff_Tags.Remove:
          state.items.splice(diff.inner.index, 1);
          break;
        case TimelineDiff_Tags.Truncate:
          state.items.length = diff.inner.length;
          break;
        case TimelineDiff_Tags.Reset:
          state.items = [...diff.inner.values];
          break;
      }
    }
  }

  private emitCallEvents(roomId: string, items: TimelineItemLike[]): void {
    const events = items
      .map(timelineItem => timelineItem.asEvent())
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .map(item => ({item, debug: this.timelineDebugJson(item)}))
      .filter(({debug}) => isLegacyCallEventType(debug?.type))
      .sort((a, b) => Number(a.item.timestamp) - Number(b.item.timestamp));
    const terminalCallKeys = new Set(events
      .filter(({debug}) => debug?.type === 'm.call.hangup' || debug?.type === 'm.call.reject')
      .map(({debug}) => typeof debug?.content?.call_id === 'string' ? debug.content.call_id : '')
      .filter(Boolean)
      .map(callId => `${roomId}:${callId}`));

    for (const {item, debug} of events) {
      const eventId = this.eventId(item);
      if (this.emittedCallEventIds.has(eventId) || !debug?.type || !debug.content) {
        continue;
      }
      const callId = debug.content.call_id;
      if (typeof callId !== 'string' || !callId) {
        continue;
      }
      if (debug.type === 'm.call.invite' && terminalCallKeys.has(`${roomId}:${callId}`)) {
        this.emittedCallEventIds.add(eventId);
        continue;
      }
      this.emittedCallEventIds.add(eventId);
      this.emitter.emit('callEvent', {
        eventId,
        roomId,
        sender: item.sender,
        timestamp: Number(item.timestamp),
        type: debug.type,
        content: debug.content,
        source: 'timeline',
      } satisfies NativeCallEvent);
    }
  }

  private async pumpCallSignalObserver(roomId: string, observer: CallSignalObserver): Promise<void> {
    const {abortController, handle, widgetId} = observer;
    while (!abortController.signal.aborted && this.callSignalObservers.get(roomId) === observer) {
      let rawMessage: string | undefined;
      try {
        rawMessage = await handle.recv({signal: abortController.signal});
      } catch (error) {
        if (!abortController.signal.aborted) {
          console.warn('[ECLO call] failed to read raw Matrix signal', roomId, error);
        }
        return;
      }
      if (!rawMessage) {
        return;
      }

      const message = parseWidgetMessage(rawMessage);
      if (!message || message.api !== 'toWidget' || message.widgetId !== widgetId) {
        continue;
      }
      if (message.action === 'send_event') {
        this.emitRawCallSignal(roomId, message.data, message.requestId);
      }
      const response = message.action === 'capabilities'
        ? {capabilities: LEGACY_CALL_WIDGET_CAPABILITIES}
        : {};
      const reply = JSON.stringify({...message, response});
      try {
        const accepted = await handle.send(reply, {signal: abortController.signal});
        if (!accepted) {
          return;
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          console.warn('[ECLO call] failed to acknowledge raw Matrix signal', roomId, error);
        }
        return;
      }
    }
  }

  private emitRawCallSignal(roomId: string, value: unknown, requestId: string): void {
    if (!isRecord(value) || typeof value.type !== 'string' || !isLegacyCallEventType(value.type)) {
      return;
    }
    const content = isRecord(value.content) ? value.content : undefined;
    const callId = typeof content?.call_id === 'string' ? content.call_id : '';
    const sender = typeof value.sender === 'string' ? value.sender : '';
    if (!content || !callId || !sender) {
      return;
    }
    const timestamp = typeof value.origin_server_ts === 'number'
      ? value.origin_server_ts
      : Date.now();
    const eventId = typeof value.event_id === 'string' && value.event_id
      ? value.event_id
      : `widget-${requestId}`;
    if (this.emittedCallEventIds.has(eventId)) {
      return;
    }
    this.emittedCallEventIds.add(eventId);
    console.warn('[ECLO call] raw Matrix signal', value.type, callId.slice(-12));
    this.emitter.emit('callEvent', {
      eventId,
      roomId,
      sender,
      timestamp,
      type: value.type,
      content,
      source: 'raw',
    } satisfies NativeCallEvent);
  }

  private mapItems(items: TimelineItemLike[], roomId?: string): TimelineItem[] {
    const members = roomId ? this.roomMemberProfiles.get(roomId) : undefined;
    const mapped = items
      .map(timelineItem => {
        const item = timelineItem.asEvent();
        return item ? {item, debug: this.timelineDebugJson(item)} : null;
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .filter(({debug}) => !isHiddenLegacyCallEventType(debug?.type))
      .map(({item, debug}) => {
        const member = members?.get(item.sender);
        const senderName = member?.displayName ?? compactUserId(item.sender);
        const eventId = this.eventId(item);
        const rawContent = this.rawContentFromDebug(debug);
        const callLabel = callEventPreviewLabel(debug?.type, rawContent, item.isOwn);
        const activityLabel = this.roomActivityLabel(item.content, item.sender, senderName, members);
        const messageInfo = callLabel
          ? {messageKind: 'system' as const}
          : this.messageInfo(item.content, rawContent, debug?.type);
        const relationInfo = this.relationInfo(item.content, rawContent, debug?.type);
        const cachedMediaUrl = this.mediaFileCache.get(eventId);
        const mediaItems = messageInfo.mediaItems?.map(media => ({
          ...media,
          id: `${eventId}-${media.id}`,
          mediaUrl: this.mediaFileCache.get(`${eventId}-${media.id}`) ?? media.mediaUrl,
        }));
        return {
          id: eventId,
          sender: item.sender,
          senderName,
          senderAvatarUrl: member?.avatarUrl,
          timestamp: Number(item.timestamp),
          type: debug?.type ?? item.content.tag,
          body: callLabel ?? activityLabel ?? this.body(item, false, rawContent, debug?.type),
          formattedBody: typeof rawContent?.formatted_body === 'string' ? rawContent.formatted_body : undefined,
          messageKind: messageInfo.messageKind,
          mediaUrl: cachedMediaUrl ?? messageInfo.mediaUrl,
          mediaHeaders: messageInfo.mediaHeaders,
          mediaSourceJson: messageInfo.mediaSourceJson,
          mediaFileName: messageInfo.mediaFileName,
          mediaMimeType: messageInfo.mediaMimeType,
          mediaBatchId: this.mediaBatchIdFromRaw(rawContent),
          mediaItems,
          poll: messageInfo.poll,
          reactions: relationInfo.reactions,
          reactionTargetId: relationInfo.reactionTargetId,
          reactionKey: relationInfo.reactionKey,
          replyTo: relationInfo.replyTo,
          raw: rawContent ?? {},
        };
      });
    return mergePollResponses(mapped, this.currentUserId);
  }

  private eventId(item: NonNullable<ReturnType<TimelineItemLike['asEvent']>>): string {
    const id = item.eventOrTransactionId as {tag: string; inner: {eventId?: string; transactionId?: string}};
    return id.inner.eventId ?? id.inner.transactionId ?? `${item.sender}-${item.timestamp}`;
  }

  private timelineDebugJson(item: NonNullable<ReturnType<TimelineItemLike['asEvent']>>): MatrixRawEvent | undefined {
    const debug = item.lazyProvider?.debugInfo?.();
    const candidates = [debug?.latestEditJson, debug?.originalJson].filter(Boolean) as string[];
    const nativeCallType = legacyCallTypeFromTimelineContent(item.content);
    for (const raw of candidates) {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const normalized = this.normalizeDebugEvent(parsed);
        if (normalized?.content) {
          if (nativeCallType && typeof normalized.content.call_id === 'string') {
            return {type: nativeCallType, content: normalized.content};
          }
          return normalized;
        }
      } catch {
        // Try the next raw debug payload. Some edited/failed events expose partial JSON.
      }
    }
    return undefined;
  }

  private normalizeDebugEvent(value: unknown): MatrixRawEvent | undefined {
    if (!isRecord(value)) {
      return undefined;
    }
    const type = typeof value.type === 'string' ? value.type : undefined;
    if (isRecord(value.content)) {
      return {type, content: value.content};
    }
    if (this.looksLikeEventContent(value)) {
      return {type: type ?? this.rawTypeFromContent(value), content: value};
    }
    for (const key of ['event', 'raw', 'source', 'inner', 'eventJson', 'original']) {
      const nested = value[key];
      if (isRecord(nested)) {
        const normalized = this.normalizeDebugEvent(nested);
        if (normalized?.content) {
          return {type: normalized.type ?? type, content: normalized.content};
        }
      }
    }
    return undefined;
  }

  private looksLikeEventContent(value: Record<string, unknown>): boolean {
    return Boolean(
      value.msgtype
      || value.body
      || value.url
      || value.file
      || value.info
      || value['m.relates_to']
      || value['m.poll.start']
      || value['m.poll.response']
      || value[ECLO_EVENT.reactionKey]
      || value.call_id
    );
  }

  private rawTypeFromContent(value: Record<string, unknown>): string | undefined {
    if (value['m.poll.start']) {
      return 'm.poll.start';
    }
    if (value['m.poll.response']) {
      return 'm.poll.response';
    }
    if (value[ECLO_EVENT.reactionKey]) {
      return 'm.reaction';
    }
    if (typeof value.call_id === 'string') {
      if (isRecord(value.offer)) {
        return 'm.call.invite';
      }
      if (isRecord(value.answer)) {
        return 'm.call.answer';
      }
      if (Array.isArray(value.candidates)) {
        return 'm.call.candidates';
      }
      if (typeof value.selected_party_id === 'string') {
        return 'm.call.select_answer';
      }
      if (isRecord(value.description)) {
        return 'm.call.negotiate';
      }
      if (typeof value.reason === 'string') {
        return 'm.call.hangup';
      }
    }
    if (value.msgtype || value.body || value.url || value.file) {
      return 'm.room.message';
    }
    return undefined;
  }

  private rawContentFromDebug(debug?: MatrixRawEvent): Record<string, unknown> | undefined {
    return debug?.content && typeof debug.content === 'object' ? debug.content : undefined;
  }

  private mediaBatchIdFromRaw(rawContent?: Record<string, unknown>): string | undefined {
    const value = rawContent?.[ECLO_EVENT.mediaBatchId];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private body(item: NonNullable<ReturnType<TimelineItemLike['asEvent']>>, compactEncrypted = false, rawContent?: Record<string, unknown>, rawType?: string): string {
    return this.bodyFromContent(item.content, compactEncrypted, rawContent, rawType);
  }

  private bodyFromContent(contentValue: unknown, compactEncrypted = false, rawContent?: Record<string, unknown>, rawType?: string): string {
    if (rawContent) {
      const callLabel = callEventPreviewLabel(rawType, rawContent);
      if (callLabel) {
        return callLabel;
      }
      if (rawType === 'm.sticker') {
        return '[Sticker]';
      }
      if (rawType === 'm.poll.start') {
        const poll = rawContent['m.poll.start'] as {'m.question'?: {'m.text'?: string}; question?: {'m.text'?: string}} | undefined;
        return `[Poll] ${poll?.['m.question']?.['m.text'] ?? poll?.question?.['m.text'] ?? rawContent['m.text'] ?? rawContent.body ?? 'Bình chọn'}`;
      }
      if (rawType === 'm.poll.response') {
        return '[Poll vote]';
      }
      if (rawType === 'm.reaction') {
        const relatesTo = rawContent['m.relates_to'] as {key?: string} | undefined;
        return String(rawContent[ECLO_EVENT.reactionKey] ?? relatesTo?.key ?? '[Reaction]');
      }
      const rawBody = String(rawContent.body ?? rawContent['m.text'] ?? '').trim();
      if (rawBody) {
        return rawBody;
      }
    }
    const content = contentValue as any;
    if (!content?.tag) {
      return compactEncrypted ? 'Tin nhắn chưa hiển thị' : 'Tin nhắn chưa thể hiển thị. Hãy dùng Mã khôi phục hoặc mở ứng dụng trên thiết bị đã xác thực.';
    }
    if (content.tag === TimelineItemContent_Tags.FailedToParseMessageLike) {
      return rawContent ? String(rawContent.body ?? rawContent['m.text'] ?? 'Tin nhắn') : 'Tin nhắn chưa đọc được đầy đủ';
    }
    if (content.tag !== TimelineItemContent_Tags.MsgLike) {
      return this.systemEventLabel(content.tag);
    }
    const kind = content.inner.content.kind;
    if (kind.tag === 'Message') {
      return kind.inner.content.body;
    }
    if (kind.tag === 'Poll') {
      return `[Poll] ${kind.inner.question}`;
    }
    if (kind.tag === 'UnableToDecrypt') {
      return compactEncrypted ? 'Tin nhắn chưa hiển thị' : 'Tin nhắn chưa thể hiển thị. Hãy dùng Mã khôi phục hoặc mở ứng dụng trên thiết bị đã xác thực.';
    }
    return `[${kind.tag}]`;
  }

  private messageInfo(contentValue: unknown, rawContent?: Record<string, unknown>, rawType?: string): Pick<TimelineItem, 'messageKind' | 'mediaUrl' | 'mediaHeaders' | 'mediaSourceJson' | 'mediaFileName' | 'mediaMimeType' | 'mediaItems' | 'poll'> {
    const content = contentValue as any;
    if (!content?.tag) {
      return this.rawMessageInfo(rawContent, rawType) ?? {messageKind: 'encrypted'};
    }
    if (content.tag !== TimelineItemContent_Tags.MsgLike) {
      return this.rawMessageInfo(rawContent, rawType) ?? {messageKind: content.tag === TimelineItemContent_Tags.FailedToParseMessageLike ? 'text' : 'system'};
    }
    const kind = content.inner.content.kind;
    if (kind.tag === 'UnableToDecrypt') {
      return {messageKind: 'encrypted'};
    }
    if (kind.tag === 'Poll') {
      const answers = (kind.inner.answers ?? []).map((answer: {id: string; text?: string}) => {
        const voters = pollVoters(kind.inner.votes, answer.id);
        return {
          id: answer.id,
          text: answer.text ?? answer.id,
          count: voters.length,
          voters,
          selected: Boolean(this.currentUserId && voters.includes(this.currentUserId)),
        };
      });
      return {
        messageKind: 'poll',
        poll: {
          question: kind.inner.question ?? 'Bình chọn',
          answers,
          totalVotes: answers.reduce((total: number, answer: {count?: number}) => total + (answer.count ?? 0), 0),
        },
      };
    }
    if (kind.tag !== 'Message') {
      if (kind.tag === 'Sticker') {
        return this.nativeMediaInfo('sticker', {source: kind.inner?.source, filename: kind.inner?.body, info: kind.inner?.info}, kind.inner?.body ?? 'sticker', 'image/webp');
      }
      if (kind.tag === 'Other' && kind.inner?.eventType?.tag === 'Reaction') {
        return {messageKind: 'reaction'};
      }
      return this.rawMessageInfo(rawContent, rawType) ?? {messageKind: 'system'};
    }
    const messageContent = kind.inner.content;
    const msgType = messageContent.msgType;
    switch (msgType?.tag) {
      case MessageType_Tags.Image:
        return this.nativeMediaInfo('image', msgType.inner?.content, messageContent.body, 'image/jpeg');
      case MessageType_Tags.Audio:
        return this.nativeMediaInfo('audio', msgType.inner?.content, messageContent.body, 'audio/mpeg');
      case MessageType_Tags.Video:
        return this.nativeMediaInfo('video', msgType.inner?.content, messageContent.body, 'video/mp4');
      case MessageType_Tags.File:
        return this.nativeMediaInfo('file', msgType.inner?.content, messageContent.body, 'application/octet-stream');
      case MessageType_Tags.Gallery: {
        const galleryItems = (msgType.inner?.content?.itemtypes ?? msgType.inner?.content?.itemTypes ?? msgType.inner?.content?.items ?? [])
          .map((entry: any, index: number) => this.galleryMediaItem(entry, index))
          .filter(Boolean);
        return {
          messageKind: 'image',
          mediaItems: galleryItems,
          mediaUrl: galleryItems[0]?.mediaUrl,
          mediaHeaders: this.mediaHeaders(),
          mediaSourceJson: galleryItems[0]?.mediaSourceJson,
          mediaFileName: galleryItems[0]?.mediaFileName,
          mediaMimeType: galleryItems[0]?.mediaMimeType,
        };
      }
      default:
        return this.rawMessageInfo(rawContent, rawType) ?? this.messageInfoFromOtherMsgType(msgType) ?? {messageKind: 'text'};
    }
  }

  private rawMessageInfo(rawContent?: Record<string, unknown>, rawType?: string): Pick<TimelineItem, 'messageKind' | 'mediaUrl' | 'mediaHeaders' | 'mediaSourceJson' | 'mediaFileName' | 'mediaMimeType' | 'poll'> | undefined {
    if (!rawContent) {
      return undefined;
    }
    if (rawType === 'm.reaction') {
      return {messageKind: 'reaction'};
    }
    if (rawType === 'm.poll.start') {
      return this.rawPollInfo(rawContent);
    }
    if (rawType === 'm.sticker') {
      return this.rawMediaInfo('sticker', rawContent, 'image/webp');
    }
    if (rawType && rawType !== 'm.room.message' && rawType !== 'm.room.encrypted') {
      return undefined;
    }
    const msgtype = String(rawContent.msgtype ?? '');
    if (msgtype === 'm.image') {
      return this.rawMediaInfo(rawContent[ECLO_EVENT.stickerMedia] ? 'sticker' : 'image', rawContent, 'image/jpeg');
    }
    if (msgtype === 'm.audio') {
      return this.rawMediaInfo('audio', rawContent, 'audio/mpeg');
    }
    if (msgtype === 'm.video') {
      return this.rawMediaInfo('video', rawContent, 'video/mp4');
    }
    if (msgtype === 'm.file') {
      return this.rawMediaInfo(this.mediaKindFromRaw(rawContent, 'file'), rawContent, 'application/octet-stream');
    }
    if (msgtype === 'm.text' || msgtype === 'm.notice' || rawContent.body || rawContent['m.text']) {
      return {messageKind: 'text'};
    }
    return undefined;
  }

  private rawPollInfo(rawContent: Record<string, unknown>): Pick<TimelineItem, 'messageKind' | 'poll'> {
    const poll = rawContent['m.poll.start'] as {
      'm.question'?: {'m.text'?: string};
      question?: {'m.text'?: string};
      answers?: Array<{id: string; 'm.text'?: string}>;
    } | undefined;
    return {
      messageKind: 'poll',
      poll: {
        question: poll?.['m.question']?.['m.text'] ?? poll?.question?.['m.text'] ?? String(rawContent['m.text'] ?? 'Bình chọn'),
        answers: poll?.answers?.map(answer => ({id: answer.id, text: answer['m.text'] ?? answer.id})) ?? [],
      },
    };
  }

  private rawMediaInfo(
    messageKind: NonNullable<TimelineItem['messageKind']>,
    rawContent: Record<string, unknown>,
    fallbackMimeType: string,
  ): Pick<TimelineItem, 'messageKind' | 'mediaUrl' | 'mediaHeaders' | 'mediaSourceJson' | 'mediaFileName' | 'mediaMimeType'> {
    const file = isRecord(rawContent.file) ? rawContent.file as {url?: string; mimetype?: string} : undefined;
    const info = rawContent.info as {mimetype?: string; mimeType?: string; thumbnail_url?: string; thumbnail_file?: {url?: string}} | undefined;
    const plainUri = typeof rawContent.url === 'string' ? rawContent.url : undefined;
    const thumbnailUri = info?.thumbnail_url ?? info?.thumbnail_file?.url;
    const sourceJson = this.rawMediaSourceJson(rawContent);
    const displayUri = plainUri ?? file?.url ?? thumbnailUri;
    const resolvedMimeType = info?.mimetype ?? info?.mimeType ?? file?.mimetype ?? fallbackMimeType;
    return {
      messageKind: this.coerceMediaKind(messageKind, resolvedMimeType, String(rawContent.filename ?? rawContent.body ?? '')),
      mediaUrl: this.matrixMediaDownloadUrl(displayUri) ?? this.matrixMediaUrl(displayUri),
      mediaHeaders: this.mediaHeaders(),
      mediaSourceJson: sourceJson,
      mediaFileName: String(rawContent.filename ?? rawContent.body ?? ''),
      mediaMimeType: resolvedMimeType,
    };
  }

  private rawMediaSourceJson(rawContent: Record<string, unknown>): string | undefined {
    if (isRecord(rawContent.file)) {
      return JSON.stringify(rawContent.file);
    }
    if (typeof rawContent.url === 'string' && rawContent.url.trim()) {
      return rawContent.url.trim();
    }
    return undefined;
  }

  private messageInfoFromOtherMsgType(msgType: any): Pick<TimelineItem, 'messageKind'> | undefined {
    if (msgType?.inner?.msgtype === 'm.image') {
      return {messageKind: 'image'};
    }
    if (msgType?.inner?.msgtype === 'm.video') {
      return {messageKind: 'video'};
    }
    if (msgType?.inner?.msgtype === 'm.audio') {
      return {messageKind: 'audio'};
    }
    if (msgType?.inner?.msgtype === 'm.file') {
      return {messageKind: 'file'};
    }
    return undefined;
  }

  private nativeMediaInfo(
    messageKind: NonNullable<TimelineItem['messageKind']>,
    mediaContent?: unknown,
    fallbackName?: string,
    mimeType = 'application/octet-stream',
  ): Pick<TimelineItem, 'messageKind' | 'mediaUrl' | 'mediaHeaders' | 'mediaSourceJson' | 'mediaFileName' | 'mediaMimeType'> {
    const content = mediaContent as {source?: unknown; filename?: string; body?: string; caption?: string; info?: unknown} | undefined;
    const sourceJson = this.mediaSourceJson(content?.source);
    const fileName = content?.filename ?? content?.body ?? content?.caption ?? fallbackName;
    const resolvedMimeType = this.mimeTypeFromInfo(content?.info, mimeType);
    return {
      messageKind: this.coerceMediaKind(messageKind, resolvedMimeType, fileName),
      mediaUrl: this.mediaSourceUrl(content?.source),
      mediaHeaders: this.mediaHeaders(),
      mediaSourceJson: sourceJson,
      mediaFileName: fileName,
      mediaMimeType: resolvedMimeType,
    };
  }

  private galleryMediaItem(entry: any, index: number): TimelineMediaItem | null {
    const content = entry?.inner?.content ?? entry?.content ?? entry;
    const tag = entry?.tag;
    if (!content?.source) {
      return null;
    }
    const kind = tag === 'Video' ? 'video' : tag === 'Audio' ? 'audio' : tag === 'File' ? 'file' : 'image';
    const mimeType = this.mimeTypeFromInfo(content.info, kind === 'video' ? 'video/mp4' : kind === 'audio' ? 'audio/mpeg' : kind === 'file' ? 'application/octet-stream' : 'image/jpeg');
    const sourceJson = this.mediaSourceJson(content.source);
    const sourceUrl = this.mediaSourceUrl(content.source);
    const fileName = content.filename ?? content.caption;
    return {
      id: `gallery-${index}-${safeCacheFilename(String(fileName ?? kind ?? 'media'))}`,
      kind: this.coerceMediaKind(kind as TimelineMediaItem['kind'], mimeType, fileName) as TimelineMediaItem['kind'],
      mediaUrl: sourceUrl,
      mediaHeaders: this.mediaHeaders(),
      mediaSourceJson: sourceJson,
      mediaFileName: fileName,
      mediaMimeType: mimeType,
    };
  }

  private relationInfo(contentValue: unknown, rawContent?: Record<string, unknown>, rawType?: string): Pick<TimelineItem, 'reactions' | 'reactionTargetId' | 'reactionKey' | 'replyTo'> {
    const rawRelation = this.rawRelationInfo(rawContent, rawType);
    const content = contentValue as any;
    if (content?.tag !== TimelineItemContent_Tags.MsgLike) {
      return rawRelation;
    }
    const msgLike = content.inner?.content;
    const kind = msgLike?.kind;
    if (kind?.tag === 'Other' && kind.inner?.eventType?.tag === 'Reaction') {
      const key = kind.inner.eventType.inner?.key ?? kind.inner.eventType.inner?.reaction ?? '';
      return {
        reactionTargetId: kind.inner.eventType.inner?.relatedEventId,
        reactionKey: normalizeReactionKey(String(key)) || undefined,
      };
    }
    if (kind?.tag === 'ReactionContent') {
      return {reactionTargetId: kind.inner?.relatedEventId, reactionKey: normalizeReactionKey(this.bodyFromContent(contentValue))};
    }
    const reactions = (msgLike?.reactions ?? []).map((reaction: {key: string; senders: Array<{senderId: string}>}) => ({
      key: normalizeReactionKey(reaction.key),
      count: reaction.senders.length,
      senders: reaction.senders.map(sender => sender.senderId),
    }));
    return {
      replyTo: msgLike?.inReplyTo?.eventId?.() ?? kind?.inner?.content?.inReplyToEventId ?? rawRelation.replyTo,
      reactions: reactions.length ? reactions : undefined,
    };
  }

  private rawRelationInfo(rawContent?: Record<string, unknown>, rawType?: string): Pick<TimelineItem, 'reactionTargetId' | 'reactionKey' | 'replyTo'> {
    if (!rawContent) {
      return {};
    }
    const relatesTo = rawContent['m.relates_to'] as {
      event_id?: string;
      key?: string;
      'm.in_reply_to'?: {event_id?: string};
    } | undefined;
    if (rawType === 'm.reaction') {
      return {
        reactionTargetId: relatesTo?.event_id,
        reactionKey: normalizeReactionKey(String(rawContent[ECLO_EVENT.reactionKey] ?? relatesTo?.key ?? '')) || undefined,
      };
    }
    return {
      replyTo: relatesTo?.['m.in_reply_to']?.event_id,
    };
  }

  private mediaSourceUrl(source?: unknown): string | undefined {
    const value = source as {url?: (() => string) | string; uri?: string; source?: {url?: string}} | undefined;
    const directUrl = typeof value?.url === 'function' ? value.url() : value?.url;
    const uri = directUrl ?? value?.uri ?? value?.source?.url;
    const sourceJson = this.mediaSourceJson(source);
    return sourceJson && mediaSourceJsonIsEncrypted(sourceJson)
      ? this.matrixMediaDownloadUrl(uri)
      : this.matrixMediaUrl(uri);
  }

  private mediaSourceJson(source?: unknown): string | undefined {
    const value = source as {toJson?: () => string} | undefined;
    try {
      return value?.toJson?.();
    } catch {
      return undefined;
    }
  }

  private mediaKindFromRaw(rawContent: Record<string, unknown>, fallback: NonNullable<TimelineItem['messageKind']>): NonNullable<TimelineItem['messageKind']> {
    const fileName = String(rawContent.filename ?? rawContent.body ?? '');
    const info = rawContent.info as {mimetype?: string; mimeType?: string} | undefined;
    const file = isRecord(rawContent.file) ? rawContent.file as {mimetype?: string} : undefined;
    return this.coerceMediaKind(fallback, info?.mimetype ?? info?.mimeType ?? file?.mimetype, fileName);
  }

  private coerceMediaKind(
    kind: NonNullable<TimelineItem['messageKind']> | TimelineMediaItem['kind'],
    mimeType?: string,
    fileName?: string,
  ): NonNullable<TimelineItem['messageKind']> {
    const mime = (mimeType ?? '').toLowerCase();
    const name = (fileName ?? '').toLowerCase();
    if (kind === 'file') {
      if (mime.startsWith('image/') || /\.(avif|gif|heic|heif|jpe?g|png|webp)$/i.test(name)) {
        return 'image';
      }
      if (mime.startsWith('video/') || /\.(mov|m4v|mp4|webm)$/i.test(name)) {
        return 'video';
      }
      if (mime.startsWith('audio/') || /\.(aac|m4a|mp3|ogg|wav)$/i.test(name)) {
        return 'audio';
      }
    }
    return kind as NonNullable<TimelineItem['messageKind']>;
  }

  private mediaHeaders(): Record<string, string> | undefined {
    return this.currentAccessToken ? {Authorization: `Bearer ${this.currentAccessToken}`} : undefined;
  }

  private mimeTypeFromInfo(info: unknown, fallback: string): string {
    const value = info as {mimetype?: string; mimeType?: string} | undefined;
    return value?.mimetype ?? value?.mimeType ?? fallback;
  }

  private async prefetchTimelineMedia(roomId: string, items: TimelineItem[]): Promise<void> {
    if (!this.client) {
      return;
    }
    let changed = false;
    for (const item of items) {
      const ownMedia = item.mediaSourceJson && !item.mediaItems?.length
        ? [{
          id: item.id,
          mediaSourceJson: item.mediaSourceJson,
          mediaFileName: item.mediaFileName,
          mediaMimeType: item.mediaMimeType,
        }]
        : [];
      const mediaEntries: Array<{id: string; mediaSourceJson: string; mediaFileName?: string; mediaMimeType?: string}> = [
        ...ownMedia,
        ...(item.mediaItems ?? []).filter((entry): entry is TimelineMediaItem & {mediaSourceJson: string} => Boolean(entry.mediaSourceJson)),
      ];
      for (const media of mediaEntries) {
        const failedAt = this.mediaFileFailures.get(media.id);
        if (this.mediaFileCache.has(media.id) || !media.mediaSourceJson || (failedAt && Date.now() - failedAt < 12000)) {
          continue;
        }
        try {
          let request = this.mediaFileRequests.get(media.id);
          const ownsRequest = !request;
          if (!request) {
            request = this.loadTimelineMediaFile(media);
            this.mediaFileRequests.set(media.id, request);
          }
          let path: string | undefined;
          try {
            path = await request;
          } finally {
            if (ownsRequest && this.mediaFileRequests.get(media.id) === request) {
              this.mediaFileRequests.delete(media.id);
            }
          }
          if (path) {
            this.mediaFileCache.set(media.id, path.startsWith('file://') ? path : `file://${path}`);
            this.mediaFileFailures.delete(media.id);
            changed = true;
          }
        } catch (error) {
          console.warn(`[ECLO media] ${media.id} failed: ${mediaErrorMessage(error)}`);
          this.mediaFileFailures.set(media.id, Date.now());
        }
      }
    }
    if (changed) {
      this.emitter.emit(`timeline:${roomId}`);
    }
  }

  private async loadTimelineMediaFile(
    media: {id: string; mediaSourceJson: string; mediaFileName?: string; mediaMimeType?: string},
  ): Promise<string | undefined> {
    const filename = mediaCacheFilename(media);
    const persistedPath = `${RNFS.CachesDirectoryPath}/${filename}`;
    if (await RNFS.exists(persistedPath)) {
      const stat = await RNFS.stat(persistedPath).catch(() => undefined);
      if (stat && Number(stat.size) > 0) {
        return persistedPath;
      }
      await RNFS.unlink(persistedPath).catch(() => undefined);
    }
    const encryptedSource = mediaSourceJsonIsEncrypted(media.mediaSourceJson);
    const source = this.mediaSourceFromStored(media.mediaSourceJson);
    return this.persistMediaFile(
      source,
      media,
      mediaDownloadFileName(media),
      persistedPath,
      encryptedSource,
    );
  }

  private async persistMediaFile(
    source: MediaSourceLike,
    media: {id: string; mediaFileName?: string; mediaMimeType?: string},
    downloadName: string,
    persistedPath: string,
    encryptedSource: boolean,
  ): Promise<string | undefined> {
    const useCache = !encryptedSource;
    try {
      const handle = await this.requireClient().getMediaFile(
        source,
        downloadName,
        media.mediaMimeType ?? 'application/octet-stream',
        useCache,
        RNFS.CachesDirectoryPath,
      );
      const path = handle.persist(persistedPath) ? persistedPath : handle.path();
      if (path) {
        return path;
      }
    } catch (error) {
      console.warn(`[ECLO media] getMediaFile fallback for ${media.id}: ${mediaErrorMessage(error)}`);
    }

    const content = await this.requireClient().getMediaContent(source);
    await RNFS.writeFile(persistedPath, arrayBufferToBase64(content), 'base64');
    return persistedPath;
  }

  private roomActivityLabel(
    contentValue: unknown,
    senderId: string,
    senderName: string,
    members?: Map<string, NativeRoomMember>,
  ): string | undefined {
    const content = contentValue as any;
    if (content?.tag === TimelineItemContent_Tags.RoomMembership) {
      const targetId = String(content.inner?.userId ?? '');
      const targetName = String(content.inner?.userDisplayName ?? members?.get(targetId)?.displayName ?? compactUserId(targetId));
      const change = typeof content.inner?.change === 'number'
        ? (MembershipChange[content.inner.change] ?? 'None')
        : String(content.inner?.change ?? 'None');
      return memberActivityLabel({actorId: senderId, actorName: senderName, change, targetId, targetName});
    }
    if (content?.tag === TimelineItemContent_Tags.ProfileChange) {
      const change = content.inner ?? {};
      if (change.displayName !== change.prevDisplayName) {
        return change.displayName
          ? `${senderName} đã đổi tên hiển thị thành “${change.displayName}”`
          : `${senderName} đã xóa tên hiển thị`;
      }
      if (change.avatarUrl !== change.prevAvatarUrl) {
        return change.avatarUrl
          ? `${senderName} đã thay ảnh đại diện`
          : `${senderName} đã xóa ảnh đại diện`;
      }
      return `${senderName} đã cập nhật hồ sơ`;
    }
    if (content?.tag !== TimelineItemContent_Tags.State) {
      return undefined;
    }
    const state = content.inner?.content;
    switch (state?.tag) {
      case OtherState_Tags.RoomName: {
        const name = String(state.inner?.name ?? '').trim();
        return name ? `${senderName} đã đổi tên nhóm thành “${name}”` : `${senderName} đã xóa tên nhóm`;
      }
      case OtherState_Tags.RoomAvatar:
        return state.inner?.url ? `${senderName} đã thay ảnh nhóm` : `${senderName} đã xóa ảnh nhóm`;
      case OtherState_Tags.RoomTopic:
        return state.inner?.topic ? `${senderName} đã cập nhật mô tả nhóm` : `${senderName} đã xóa mô tả nhóm`;
      case OtherState_Tags.RoomPowerLevels: {
        const users = state.inner?.users instanceof Map ? state.inner.users as Map<string, bigint> : new Map<string, bigint>();
        const previous = state.inner?.previous instanceof Map ? state.inner.previous as Map<string, bigint> : new Map<string, bigint>();
        const changedUserId = [...new Set([...users.keys(), ...previous.keys()])]
          .find(userId => numberValue(users.get(userId), 0) !== numberValue(previous.get(userId), 0));
        if (!changedUserId) {
          return `${senderName} đã cập nhật quyền thành viên`;
        }
        const targetName = members?.get(changedUserId)?.displayName ?? compactUserId(changedUserId);
        return `${senderName} đã đổi quyền của ${targetName} thành ${roleLabelFromPowerLevel(numberValue(users.get(changedUserId), 0))}`;
      }
      case OtherState_Tags.RoomPinnedEvents:
        return `${senderName} đã cập nhật tin nhắn ghim`;
      case OtherState_Tags.RoomJoinRules:
        return `${senderName} đã cập nhật quyền tham gia nhóm`;
      case OtherState_Tags.RoomCreate:
        return `${senderName} đã tạo nhóm`;
      case OtherState_Tags.RoomTombstone:
        return `${senderName} đã đóng nhóm`;
      case OtherState_Tags.RoomEncryption:
        return `${senderName} đã bật bảo vệ cuộc trò chuyện`;
      default:
        return `${senderName} đã cập nhật cài đặt nhóm`;
    }
  }

  private systemEventLabel(tag: string): string {
    if (tag === 'CallInvite') {
      return 'Cuộc gọi đến';
    }
    if (tag === 'ProfileChange') {
      return 'Cập nhật hồ sơ';
    }
    if (tag === 'State') {
      return 'Cập nhật phòng';
    }
    return 'Cập nhật nhóm';
  }

  private mediaSourceFromStored(value: string): MediaSourceLike {
    const errors: unknown[] = [];
    const attempts: Array<() => MediaSourceLike> = [
      () => MediaSource.fromJson(value),
    ];
    let allowUrlFallback = true;
    try {
      const parsed = JSON.parse(value) as unknown;
      if (isRecord(parsed)) {
        if (isRecord(parsed.file)) {
          const isEncrypted = isEncryptedMediaSource(parsed.file);
          attempts.push(() => MediaSource.fromJson(JSON.stringify(parsed.file)));
          allowUrlFallback = !isEncrypted;
          const fileUrl = parsed.file.url;
          if (!isEncrypted && typeof fileUrl === 'string') {
            attempts.push(() => MediaSource.fromUrl(fileUrl));
          }
        } else if (isEncryptedMediaSource(parsed)) {
          allowUrlFallback = false;
          attempts.push(() => MediaSource.fromJson(JSON.stringify({file: parsed})));
        }
        const parsedUrl = parsed.url;
        if (allowUrlFallback && typeof parsedUrl === 'string') {
          attempts.push(() => MediaSource.fromUrl(parsedUrl));
        }
      }
    } catch {
      // Non-JSON stored media source is expected for plain MXC URLs.
    }
    if (allowUrlFallback) {
      attempts.push(() => MediaSource.fromUrl(value));
    }

    for (const attempt of attempts) {
      try {
        return attempt();
      } catch (error) {
        errors.push(error);
      }
    }
    throw errors.at(-1) ?? new Error('Không đọc được media source.');
  }

  private requireClient(): ClientLike {
    if (!this.client) {
      throw new Error('Phiên bảo mật chưa sẵn sàng.');
    }
    return this.client;
  }

  private requireRoom(roomId: string): RoomLike {
    const room = this.requireClient().getRoom(roomId);
    if (!room) {
      throw new Error('Không tìm thấy cuộc trò chuyện.');
    }
    return room;
  }

  private storeId(baseUrl: string, seed: string): string {
    return `${baseUrl}-${seed}`.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 120);
  }
}

function compactUserId(userId: string): string {
  return userId.replace(/^@/, '').split(':')[0] || userId;
}

function requiredPositiveBigInt(value?: number): bigint {
  return BigInt(Math.max(1, Math.round(typeof value === 'number' && Number.isFinite(value) ? value : 1)));
}

function validDurationMs(value?: number): number {
  return Math.max(1, typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 1);
}

function fallbackMimeType(kind: NativeMediaUpload['kind'], fileName?: string): string {
  const name = (fileName ?? '').toLowerCase();
  if (kind === 'video') return name.endsWith('.mov') ? 'video/quicktime' : 'video/mp4';
  if (kind === 'audio') return name.endsWith('.wav') ? 'audio/wav' : name.endsWith('.mp3') ? 'audio/mpeg' : 'audio/mp4';
  if (kind === 'file') return 'application/octet-stream';
  if (name.endsWith('.gif')) return 'image/gif';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.png')) return 'image/png';
  return 'image/jpeg';
}

function encryptAttachmentBytes(plaintext: Buffer): {ciphertext: Buffer; key: string; iv: string; sha256: string} {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-ctr', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    ciphertext,
    key: key.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    iv: iv.toString('base64').replace(/=+$/, ''),
    sha256: crypto.createHash('sha256').update(ciphertext).digest('base64').replace(/=+$/, ''),
  };
}

function pollVoters(value: unknown, answerId: string): string[] {
  if (value instanceof Map) {
    const voters = value.get(answerId);
    return Array.isArray(voters) ? voters.map(String) : [];
  }
  if (isRecord(value)) {
    const voters = value[answerId];
    return Array.isArray(voters) ? voters.map(String) : [];
  }
  return [];
}

function mergePollResponses(items: TimelineItem[], currentUserId: string | null): TimelineItem[] {
  const responsesByPoll = new Map<string, Array<{sender: string; answers: string[]; timestamp: number}>>();
  const visibleItems: TimelineItem[] = [];

  for (const item of items) {
    const response = isRecord(item.raw['m.poll.response']) ? item.raw['m.poll.response'] : undefined;
    const relation = isRecord(item.raw['m.relates_to']) ? item.raw['m.relates_to'] : undefined;
    const targetId = typeof relation?.event_id === 'string' ? relation.event_id : undefined;
    const answerIds = response && Array.isArray(response.answers)
      ? response.answers.filter((answer): answer is string => typeof answer === 'string')
      : [];
    if (response || item.type === 'm.poll.response') {
      if (targetId && answerIds.length) {
        const responses = responsesByPoll.get(targetId) ?? [];
        responses.push({sender: item.sender, answers: answerIds, timestamp: item.timestamp});
        responsesByPoll.set(targetId, responses);
      }
      // Poll responses are relations, not standalone chat messages.
      continue;
    }
    visibleItems.push(item);
  }

  return visibleItems.map(item => {
    if (!item.poll) {
      return item;
    }
    const answerVoters = new Map(item.poll.answers.map(answer => [answer.id, new Set(answer.voters ?? [])]));
    const responses = (responsesByPoll.get(item.id) ?? []).sort((a, b) => a.timestamp - b.timestamp);
    for (const response of responses) {
      // A disclosed single-selection poll keeps only the user's latest vote.
      answerVoters.forEach(voters => voters.delete(response.sender));
      for (const answerId of response.answers.slice(0, 1)) {
        answerVoters.get(answerId)?.add(response.sender);
      }
    }
    const answers = item.poll.answers.map(answer => {
      const voters = [...(answerVoters.get(answer.id) ?? new Set<string>())];
      return {
        ...answer,
        voters,
        count: voters.length,
        selected: Boolean(currentUserId && voters.includes(currentUserId)),
      };
    });
    return {
      ...item,
      poll: {
        ...item.poll,
        answers,
        totalVotes: answers.reduce((total, answer) => total + (answer.count ?? 0), 0),
      },
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function powerLevelForMember(userId: string, powerContent: MatrixPowerLevels | undefined, creator: string, fallback = 0): number {
  const explicit = userId ? powerContent?.users?.[userId] : undefined;
  const parsedExplicit = numberValue(explicit, Number.NaN);
  if (Number.isFinite(parsedExplicit)) {
    return parsedExplicit;
  }
  if (creator && userId === creator) {
    return 100;
  }
  return numberValue(powerContent?.users_default, fallback);
}

function numberValue(value: unknown, fallback: number): number {
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function safeValue<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

function roleFromPowerLevel(powerLevel: number): string {
  if (powerLevel >= 100) {
    return 'Trưởng nhóm';
  }
  if (powerLevel >= 50) {
    return 'Phó nhóm';
  }
  return 'Thành viên';
}

function normalizeReactionKey(key: string): string {
  const clean = key.trim();
  const known = ['👍', '❤️', '❤', '😂', '😮', '😢', '🙏'].find(reaction => clean.startsWith(reaction));
  return known ?? clean.replace(/\d+$/u, '');
}

function safeCacheFilename(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '_').slice(0, 180);
}

function mediaDownloadFileName(media: {mediaFileName?: string; mediaMimeType?: string}): string {
  const rawName = media.mediaFileName?.trim();
  if (rawName && hasFileExtension(rawName)) {
    return rawName;
  }
  const extension = extensionForMimeType(media.mediaMimeType);
  return `${rawName || 'media'}.${extension}`;
}

function mediaCacheFilename(media: {id: string; mediaFileName?: string; mediaMimeType?: string}): string {
  const safeBase = safeCacheFilename(`${media.id}-${media.mediaFileName?.trim() || 'media'}`);
  if (hasFileExtension(safeBase)) {
    return safeBase;
  }
  return `${safeBase}.${extensionForMimeType(media.mediaMimeType)}`;
}

function hasFileExtension(value: string): boolean {
  return /\.[a-z0-9]{2,6}$/i.test(value);
}

function extensionForMimeType(mimeType?: string): string {
  const mime = (mimeType ?? '').toLowerCase();
  if (mime.includes('jpeg') || mime.includes('jpg')) {
    return 'jpg';
  }
  if (mime.includes('png')) {
    return 'png';
  }
  if (mime.includes('webp')) {
    return 'webp';
  }
  if (mime.includes('gif')) {
    return 'gif';
  }
  if (mime.includes('heic')) {
    return 'heic';
  }
  if (mime.includes('heif')) {
    return 'heif';
  }
  if (mime.includes('avif')) {
    return 'avif';
  }
  if (mime.includes('mp4')) {
    return 'mp4';
  }
  if (mime.includes('quicktime')) {
    return 'mov';
  }
  if (mime.includes('mpeg')) {
    return mime.startsWith('audio/') ? 'mp3' : 'mpg';
  }
  if (mime.includes('wav')) {
    return 'wav';
  }
  if (mime.includes('ogg')) {
    return 'ogg';
  }
  if (mime.includes('pdf')) {
    return 'pdf';
  }
  if (mime.includes('spreadsheet') || mime.includes('excel')) {
    return 'xlsx';
  }
  if (mime.includes('wordprocessingml') || mime.includes('msword')) {
    return 'docx';
  }
  return 'bin';
}

function isEncryptedMediaSource(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && typeof value.url === 'string'
    && isRecord(value.key)
    && typeof value.iv === 'string'
    && isRecord(value.hashes);
}

function mediaSourceJsonIsEncrypted(value: string): boolean {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isEncryptedMediaSource(parsed) || (isRecord(parsed) && isEncryptedMediaSource(parsed.file));
  } catch {
    return false;
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  let index = 0;
  for (; index + 2 < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    output += alphabet[first >> 2];
    output += alphabet[((first & 0x03) << 4) | (second >> 4)];
    output += alphabet[((second & 0x0f) << 2) | (third >> 6)];
    output += alphabet[third & 0x3f];
  }
  if (index < bytes.length) {
    const first = bytes[index] ?? 0;
    output += alphabet[first >> 2];
    if (index + 1 < bytes.length) {
      const second = bytes[index + 1] ?? 0;
      output += alphabet[((first & 0x03) << 4) | (second >> 4)];
      output += alphabet[(second & 0x0f) << 2];
      output += '=';
    } else {
      output += alphabet[(first & 0x03) << 4];
      output += '==';
    }
  }
  return output;
}

function mediaErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

type WidgetBridgeMessage = {
  api: 'toWidget' | 'fromWidget';
  widgetId: string;
  requestId: string;
  action: string;
  data: unknown;
};

function parseWidgetMessage(value: string): WidgetBridgeMessage | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)
      || (parsed.api !== 'toWidget' && parsed.api !== 'fromWidget')
      || typeof parsed.widgetId !== 'string'
      || typeof parsed.requestId !== 'string'
      || typeof parsed.action !== 'string') {
      return undefined;
    }
    return {
      api: parsed.api,
      widgetId: parsed.widgetId,
      requestId: parsed.requestId,
      action: parsed.action,
      data: parsed.data,
    };
  } catch {
    return undefined;
  }
}

function stableSignalId(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function isEncryptedRoomPreview(value?: string): boolean {
  return value === 'Tin nhắn mã hóa'
    || value === 'Tin nhắn chưa hiển thị'
    || Boolean(value?.startsWith('Không giải mã được tin nhắn'));
}

function normalizeEventTimestamp(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  if (value > 1_000_000_000_000_000_000) {
    return Math.floor(value / 1_000_000);
  }
  if (value > 1_000_000_000_000_000) {
    return Math.floor(value / 1000);
  }
  return value;
}

function isLegacyCallEventType(type?: string): type is string {
  return Boolean(type?.startsWith('m.call.'));
}

function legacyCallTypeFromTimelineContent(contentValue: unknown): string | undefined {
  const content = contentValue as any;
  if (content?.tag === TimelineItemContent_Tags.CallInvite) {
    return 'm.call.invite';
  }
  if (content?.tag !== TimelineItemContent_Tags.MsgLike) {
    return undefined;
  }
  const kind = content.inner?.content?.kind;
  if (kind?.tag !== 'Other') {
    return undefined;
  }
  const eventType = kind.inner?.eventType;
  switch (eventType?.tag) {
    case 'CallAnswer':
      return 'm.call.answer';
    case 'CallCandidates':
      return 'm.call.candidates';
    case 'CallHangup':
      return 'm.call.hangup';
    case 'CallInvite':
      return 'm.call.invite';
    case 'Other': {
      const rawType = Array.isArray(eventType.inner) ? eventType.inner[0] : eventType.inner?.[0];
      return typeof rawType === 'string' && rawType.startsWith('m.call.') ? rawType : undefined;
    }
    default:
      return undefined;
  }
}

function isVisibleLegacyCallEventType(type?: string): boolean {
  return type === 'm.call.invite' || type === 'm.call.hangup' || type === 'm.call.reject';
}

function isHiddenLegacyCallEventType(type?: string): boolean {
  return isLegacyCallEventType(type) && !isVisibleLegacyCallEventType(type);
}

function callEventPreviewLabel(type?: string, content?: Record<string, unknown>, isOwn = false): string | undefined {
  if (!isVisibleLegacyCallEventType(type)) {
    return undefined;
  }
  const media = callContentHasVideo(content) ? 'video' : 'thoại';
  if (type === 'm.call.invite') {
    return isOwn ? `Cuộc gọi ${media} đi` : `Cuộc gọi ${media} đến`;
  }
  if (type === 'm.call.reject') {
    return isOwn ? 'Đã từ chối cuộc gọi' : 'Cuộc gọi bị từ chối';
  }
  const reason = typeof content?.reason === 'string' ? content.reason : '';
  if (reason === 'invite_timeout') {
    return 'Cuộc gọi không được trả lời';
  }
  if (reason === 'user_busy') {
    return `Người nhận đang bận`;
  }
  return 'Cuộc gọi đã kết thúc';
}

function callContentHasVideo(content?: Record<string, unknown>): boolean {
  if (!content) {
    return false;
  }
  const description = (isRecord(content.offer) ? content.offer : isRecord(content.answer) ? content.answer : undefined) as {sdp?: unknown} | undefined;
  if (typeof description?.sdp === 'string' && /^m=video\s/im.test(description.sdp)) {
    return true;
  }
  const metadata = isRecord(content.sdp_stream_metadata) ? content.sdp_stream_metadata : undefined;
  return Boolean(metadata && Object.values(metadata).some(value => isRecord(value) && value.video_muted !== true));
}

function securityProgressText(progress: EnableRecoveryProgress): string {
  switch (progress.tag) {
    case EnableRecoveryProgress_Tags.CreatingBackup:
      return 'Đang tạo bản sao lưu khóa...';
    case EnableRecoveryProgress_Tags.CreatingRecoveryKey:
      return 'Đang tạo Mã khôi phục...';
    case EnableRecoveryProgress_Tags.BackingUp:
      return `Đang sao lưu khóa: ${progress.inner.backedUpCount}/${progress.inner.totalCount}`;
    case EnableRecoveryProgress_Tags.RoomKeyUploadError:
      return 'Một số khóa chưa tải lên được, ứng dụng sẽ tiếp tục đồng bộ.';
    case EnableRecoveryProgress_Tags.Done:
      return 'Sao lưu an toàn đã sẵn sàng.';
    default:
      return 'Đang thiết lập sao lưu an toàn...';
  }
}

function normalizeRecoveryKey(input: string): string {
  const compact = input
    .trim()
    .normalize('NFKC')
    .replace(/[\s\u200B-\u200D\u2060\uFEFF]+/gu, '');

  if (!compact) {
    throw new Error('Vui lòng dán Mã khôi phục.');
  }

  try {
    decodeRecoveryKey(compact);
  } catch {
    throw new Error('Mã khôi phục không đúng định dạng hoặc đã bị thiếu ký tự khi sao chép.');
  }

  return compact;
}

function userFacingRecoveryError(error: unknown): Error {
  const candidate = error as {tag?: string};
  const detail = recoveryErrorDetail(error);
  const lower = detail.toLowerCase();

  console.warn('[Security] Recovery failed', {tag: candidate?.tag, detail});

  if (candidate?.tag === 'Import') {
    if (/parity|prefix|length|base58|invalid recovery|decod/.test(lower)) {
      return new Error('Mã khôi phục không đúng định dạng hoặc đã bị thiếu ký tự khi sao chép.');
    }
    return new Error('Mã khôi phục không mở được bản sao lưu tin nhắn hiện tại.');
  }

  if (candidate?.tag === 'SecretStorage') {
    return new Error('Mã khôi phục không mở được kho khóa của tài khoản.');
  }

  if (candidate?.tag === 'BackupExistsOnServer') {
    return new Error('Máy chủ đang có một bản sao lưu khác. Hãy dùng Mã khôi phục tương ứng với bản sao lưu hiện tại.');
  }

  if (/network|connection|timed? out|offline/.test(lower)) {
    return new Error('Không thể kết nối để khôi phục khóa. Hãy kiểm tra mạng và thử lại.');
  }

  return new Error(`Không thể khôi phục kho khóa: ${detail}`);
}

function isCrossSigningImportError(error: unknown): boolean {
  const candidate = error as {tag?: string};
  const lower = recoveryErrorDetail(error).toLowerCase();
  return candidate?.tag === 'Import'
    && /cross.?signing|m\.cross_signing|missing field|secret.*empty|deserialize/.test(lower);
}

function recoveryErrorDetail(error: unknown): string {
  const candidate = error as {
    inner?: {errorMessage?: string; source?: {message?: string} | string};
    message?: string;
  };
  const source = candidate?.inner?.source;
  return candidate?.inner?.errorMessage
    ?? (typeof source === 'string' ? source : source?.message)
    ?? candidate?.message
    ?? 'Không thể xử lý nội dung được bảo vệ.';
}

function verificationDataState(data: SessionVerificationData, deviceName?: string): SecurityVerification {
  if (data.tag === 'Emojis') {
    return {
      phase: 'sas',
      deviceName,
      emojis: data.inner.emojis.map(item => ({symbol: item.symbol(), description: item.description()})),
    };
  }
  return {phase: 'sas', deviceName, decimals: [...data.inner.values]};
}

export const nativeMatrixService = new NativeMatrixService();
