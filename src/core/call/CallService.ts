import EventEmitter from 'eventemitter3';
import InCallManager from 'react-native-incall-manager';
import {
  MediaStream,
  type MediaStreamTrack,
  RTCIceCandidate,
  RTCPeerConnection,
  mediaDevices,
} from 'react-native-webrtc';
import type {AuthData} from '../models/session';
import {
  nativeMatrixService,
  type NativeCallEvent,
  type NativeRoomDetails,
} from '../matrix/NativeMatrixService';

export type CallMediaType = 'voice' | 'video';
export type CallDirection = 'incoming' | 'outgoing';
export type CallPhase = 'ringing' | 'connecting' | 'connected' | 'ended' | 'error';

export type ActiveCall = {
  roomId: string;
  callId: string;
  partyId: string;
  remotePartyId?: string;
  opponentUserId: string;
  opponentName: string;
  opponentAvatarUrl?: string;
  direction: CallDirection;
  mediaType: CallMediaType;
  phase: CallPhase;
  localStream?: MediaStream;
  remoteStream?: MediaStream;
  microphoneEnabled: boolean;
  cameraEnabled: boolean;
  speakerEnabled: boolean;
  startedAt?: number;
  error?: string;
  inviteOffer?: RTCSessionDescriptionShape;
};

type RTCSessionDescriptionShape = {type: 'offer' | 'answer'; sdp: string};
type MatrixCandidate = {candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null};
type QueuedRemoteCandidate = {candidate: MatrixCandidate; partyId?: string};
type TurnServerResponse = {uris?: string[]; username?: string; password?: string};

const CALL_EVENT_VERSION = '1';
const INVITE_LIFETIME_MS = 90_000;
const TIMELINE_REPLAY_GRACE_MS = 1_500;
const ENDED_CALL_TTL_MS = 10 * 60_000;
const CALL_EVENT_TYPES = {
  invite: 'm.call.invite',
  candidates: 'm.call.candidates',
  answer: 'm.call.answer',
  selectAnswer: 'm.call.select_answer',
  reject: 'm.call.reject',
  hangup: 'm.call.hangup',
} as const;

class CallService {
  private emitter = new EventEmitter();
  private auth: AuthData | null = null;
  private activeCall: ActiveCall | null = null;
  private peer: RTCPeerConnection | null = null;
  private pendingRemoteCandidates: QueuedRemoteCandidate[] = [];
  private pendingLocalCandidates: MatrixCandidate[] = [];
  private signalingReady = false;
  private candidateFlushTimer?: ReturnType<typeof setTimeout>;
  private eventQueue: Promise<void> = Promise.resolve();
  private unsubscribeCallEvents?: () => void;
  private inviteTimer?: ReturnType<typeof setTimeout>;
  private failureReleaseTimer?: ReturnType<typeof setTimeout>;
  private endedCalls = new Map<string, number>();
  private initializedSessionKey = '';
  private timelineReplayCutoffMs = 0;
  private cleaningUp = false;

  get currentCall(): ActiveCall | null {
    return this.activeCall;
  }

  subscribe(listener: (call: ActiveCall | null) => void): () => void {
    this.emitter.on('state', listener);
    listener(this.activeCall);
    return () => this.emitter.off('state', listener);
  }

  async init(auth: AuthData): Promise<void> {
    const key = `${auth.userId}|${auth.deviceId}|${auth.baseUrl}`;
    if (this.initializedSessionKey === key) {
      return;
    }
    await this.stop(false);
    this.auth = auth;
    this.initializedSessionKey = key;
    this.timelineReplayCutoffMs = Date.now() - TIMELINE_REPLAY_GRACE_MS;
    this.unsubscribeCallEvents = nativeMatrixService.subscribeCallEvents(event => {
      this.eventQueue = this.eventQueue
        .then(() => this.handleMatrixEvent(event))
        .catch(error => this.fail(error));
    });
    nativeMatrixService.stopCallSignalObservers();
  }

  async stop(sendHangup = true): Promise<void> {
    const call = this.activeCall;
    const hangup = sendHangup && call
      ? this.sendHangupFor(call, 'user_hangup').catch(() => undefined)
      : Promise.resolve();
    this.unsubscribeCallEvents?.();
    this.unsubscribeCallEvents = undefined;
    if (this.failureReleaseTimer) {
      clearTimeout(this.failureReleaseTimer);
      this.failureReleaseTimer = undefined;
    }
    nativeMatrixService.stopCallSignalObservers();
    this.initializedSessionKey = '';
    this.timelineReplayCutoffMs = 0;
    this.auth = null;
    this.releaseCall();
    await Promise.race([hangup, delay(2500)]);
  }

  async placeCall(roomId: string, mediaType: CallMediaType): Promise<void> {
    this.requireReady();
    if (this.activeCall && this.activeCall.phase !== 'ended' && this.activeCall.phase !== 'error') {
      throw new Error('Bạn đang trong một cuộc gọi khác.');
    }
    const details = await this.requireDirectRoom(roomId);
    await nativeMatrixService.observeCallSignals(roomId);
    const opponent = opponentFromDetails(details, this.auth!.userId);
    const call: ActiveCall = {
      roomId,
      callId: randomCallId(),
      partyId: randomPartyId(this.auth!.deviceId),
      opponentUserId: opponent.userId,
      opponentName: opponent.name,
      opponentAvatarUrl: opponent.avatarUrl,
      direction: 'outgoing',
      mediaType,
      phase: 'connecting',
      microphoneEnabled: true,
      cameraEnabled: mediaType === 'video',
      speakerEnabled: mediaType === 'video',
    };
    this.setActiveCall(call);

    try {
      const stream = await this.captureMedia(mediaType);
      if (!this.isCurrent(call.callId)) {
        stopStream(stream);
        return;
      }
      this.updateCall({localStream: stream});
      await this.createPeer(stream);
      const offer = await this.peer!.createOffer({offerToReceiveAudio: true, offerToReceiveVideo: mediaType === 'video'});
      await this.peer!.setLocalDescription(offer);
      const localDescription = requireDescription(this.peer!.localDescription, 'offer');
      await this.sendEvent(call.roomId, CALL_EVENT_TYPES.invite, {
        call_id: call.callId,
        party_id: call.partyId,
        version: CALL_EVENT_VERSION,
        invitee: call.opponentUserId,
        lifetime: INVITE_LIFETIME_MS,
        offer: localDescription,
        sdp_stream_metadata: streamMetadata(stream, mediaType),
        capabilities: {'m.call.transferee': false, 'm.call.dtmf': false},
      });
      this.signalingReady = true;
      this.scheduleCandidateFlush(0);
      InCallManager.start({media: mediaType === 'video' ? 'video' : 'audio', ringback: '_DEFAULT_'});
      InCallManager.setKeepScreenOn(true);
      InCallManager.setForceSpeakerphoneOn(mediaType === 'video');
      this.armInviteTimeout(call.callId);
    } catch (error) {
      await this.sendHangup('user_media_failed').catch(() => undefined);
      this.fail(error);
      throw error;
    }
  }

  async answerCall(): Promise<void> {
    const call = this.activeCall;
    if (!call || call.direction !== 'incoming' || !call.inviteOffer) {
      return;
    }
    this.clearInviteTimeout();
    InCallManager.stopRingtone();
    this.updateCall({phase: 'connecting'});
    try {
      const stream = await this.captureMedia(call.mediaType);
      if (!this.isCurrent(call.callId)) {
        stopStream(stream);
        return;
      }
      this.updateCall({localStream: stream});
      await this.createPeer(stream);
      await this.peer!.setRemoteDescription(call.inviteOffer);
      await this.flushRemoteCandidates();
      const answer = await this.peer!.createAnswer();
      await this.peer!.setLocalDescription(answer);
      await this.sendEvent(call.roomId, CALL_EVENT_TYPES.answer, {
        call_id: call.callId,
        party_id: call.partyId,
        version: CALL_EVENT_VERSION,
        answer: requireDescription(this.peer!.localDescription, 'answer'),
        sdp_stream_metadata: streamMetadata(stream, call.mediaType),
        capabilities: {'m.call.transferee': false, 'm.call.dtmf': false},
      });
      this.signalingReady = true;
      this.scheduleCandidateFlush(0);
      InCallManager.start({media: call.mediaType === 'video' ? 'video' : 'audio'});
      InCallManager.setKeepScreenOn(true);
      InCallManager.setForceSpeakerphoneOn(call.mediaType === 'video');
    } catch (error) {
      await this.sendHangup('user_media_failed').catch(() => undefined);
      this.fail(error);
      throw error;
    }
  }

  async rejectCall(): Promise<void> {
    const call = this.activeCall;
    if (!call) {
      return;
    }
    const rejection = this.sendEvent(call.roomId, CALL_EVENT_TYPES.reject, baseCallContent(call));
    this.releaseCall();
    await Promise.race([rejection.catch(() => undefined), delay(2500)]);
  }

  async hangup(): Promise<void> {
    const call = this.activeCall;
    if (!call) {
      return;
    }
    const hangup = this.sendHangupFor(call, 'user_hangup');
    this.releaseCall();
    await Promise.race([hangup.catch(() => undefined), delay(2500)]);
  }

  toggleMicrophone(): boolean {
    const call = this.activeCall;
    if (!call?.localStream) {
      return false;
    }
    const enabled = !call.microphoneEnabled;
    call.localStream.getAudioTracks().forEach(track => {
      track.enabled = enabled;
    });
    InCallManager.setMicrophoneMute(!enabled);
    this.updateCall({microphoneEnabled: enabled});
    return enabled;
  }

  toggleCamera(): boolean {
    const call = this.activeCall;
    if (!call?.localStream || call.mediaType !== 'video') {
      return false;
    }
    const enabled = !call.cameraEnabled;
    call.localStream.getVideoTracks().forEach(track => {
      track.enabled = enabled;
    });
    this.updateCall({cameraEnabled: enabled});
    return enabled;
  }

  switchCamera(): void {
    this.activeCall?.localStream?.getVideoTracks().forEach(track => {
      (track as MediaStreamTrack & {_switchCamera?: () => void})._switchCamera?.();
    });
  }

  toggleSpeaker(): boolean {
    const call = this.activeCall;
    if (!call) {
      return false;
    }
    const enabled = !call.speakerEnabled;
    InCallManager.setForceSpeakerphoneOn(enabled);
    InCallManager.setSpeakerphoneOn(enabled);
    this.updateCall({speakerEnabled: enabled});
    return enabled;
  }

  private async handleMatrixEvent(event: NativeCallEvent): Promise<void> {
    if (!this.auth || event.sender === this.auth.userId) {
      return;
    }
    const callId = stringField(event.content, 'call_id');
    if (!callId) {
      return;
    }
    const eventTimestamp = normalizeMatrixTimestamp(event.timestamp);
    this.pruneEndedCalls();
    callTrace('receive', event.type, callId, {
      active: this.activeCall?.callId === callId,
      party: stringField(event.content, 'party_id'),
      source: event.source,
    });
    if (event.type === CALL_EVENT_TYPES.hangup || event.type === CALL_EVENT_TYPES.reject) {
      this.markCallEnded(event.roomId, callId, eventTimestamp);
    }
    if (this.hasCallEnded(event.roomId, callId) && event.type === CALL_EVENT_TYPES.invite) {
      return;
    }
    if (event.type === CALL_EVENT_TYPES.invite) {
      await this.handleInvite(event, callId, eventTimestamp);
      return;
    }
    const call = this.activeCall;
    if (!call || call.callId !== callId || call.roomId !== event.roomId) {
      return;
    }
    switch (event.type) {
      case CALL_EVENT_TYPES.answer:
        await this.handleAnswer(event);
        break;
      case CALL_EVENT_TYPES.candidates:
        await this.handleCandidates(event);
        break;
      case CALL_EVENT_TYPES.selectAnswer:
        this.handleSelectAnswer(event);
        break;
      case CALL_EVENT_TYPES.reject:
      case CALL_EVENT_TYPES.hangup:
        this.releaseCall();
        break;
    }
  }

  private async handleInvite(event: NativeCallEvent, callId: string, eventTimestamp: number): Promise<void> {
    const invitee = stringField(event.content, 'invitee');
    if (invitee && invitee !== this.auth?.userId) {
      return;
    }
    const lifetime = numberField(event.content, 'lifetime') ?? INVITE_LIFETIME_MS;
    const now = Date.now();
    const age = Math.max(0, now - eventTimestamp);
    if (event.source === 'timeline' && eventTimestamp < this.timelineReplayCutoffMs) {
      this.markCallEnded(event.roomId, callId, now);
      nativeMatrixService.stopCallSignalObservers([event.roomId]);
      return;
    }
    if (age >= Math.max(1000, lifetime - 1000)) {
      this.markCallEnded(event.roomId, callId, eventTimestamp);
      nativeMatrixService.stopCallSignalObservers([event.roomId]);
      return;
    }
    if (this.activeCall) {
      if (this.activeCall.callId !== callId) {
        this.markCallEnded(event.roomId, callId, now);
        await nativeMatrixService.sendCallEvent(event.roomId, CALL_EVENT_TYPES.hangup, {
          call_id: callId,
          party_id: randomPartyId(this.auth!.deviceId),
          version: CALL_EVENT_VERSION,
          reason: 'user_busy',
        }).catch(() => undefined);
        nativeMatrixService.stopCallSignalObservers([event.roomId]);
      }
      return;
    }
    const offer = descriptionField(event.content.offer, 'offer');
    if (!offer) {
      nativeMatrixService.stopCallSignalObservers([event.roomId]);
      return;
    }
    await nativeMatrixService.observeCallSignals(event.roomId);
    const details = await this.requireDirectRoom(event.roomId);
    const opponent = opponentFromDetails(details, this.auth!.userId, event.sender);
    const mediaType = offerHasVideo(offer, event.content) ? 'video' : 'voice';
    this.pendingRemoteCandidates = [];
    this.setActiveCall({
      roomId: event.roomId,
      callId,
      partyId: randomPartyId(this.auth!.deviceId),
      remotePartyId: stringField(event.content, 'party_id'),
      opponentUserId: opponent.userId,
      opponentName: opponent.name,
      opponentAvatarUrl: opponent.avatarUrl,
      direction: 'incoming',
      mediaType,
      phase: 'ringing',
      microphoneEnabled: true,
      cameraEnabled: mediaType === 'video',
      speakerEnabled: mediaType === 'video',
      inviteOffer: offer,
    });
    InCallManager.startRingtone('_DEFAULT_', [0, 850, 700], 'default', Math.ceil(lifetime / 1000));
    InCallManager.setKeepScreenOn(true);
    this.armInviteTimeout(callId, lifetime - age);
  }

  private async handleAnswer(event: NativeCallEvent): Promise<void> {
    const call = this.activeCall;
    if (!call || call.direction !== 'outgoing' || !this.peer) {
      return;
    }
    const remotePartyId = stringField(event.content, 'party_id');
    const answer = descriptionField(event.content.answer, 'answer');
    if (!answer) {
      return;
    }
    if (call.remotePartyId && call.remotePartyId !== remotePartyId) {
      return;
    }
    this.clearInviteTimeout();
    InCallManager.stopRingback();
    this.updateCall({remotePartyId: remotePartyId ?? call.remotePartyId, phase: 'connecting'});
    await this.peer.setRemoteDescription(answer);
    await this.flushRemoteCandidates(remotePartyId);
    if (remotePartyId) {
      await this.sendEvent(call.roomId, CALL_EVENT_TYPES.selectAnswer, {
        ...baseCallContent(call),
        selected_party_id: remotePartyId,
      });
    }
  }

  private async handleCandidates(event: NativeCallEvent): Promise<void> {
    const call = this.activeCall;
    if (!call) {
      return;
    }
    const remotePartyId = stringField(event.content, 'party_id');
    if (remotePartyId && remotePartyId === call.partyId) {
      return;
    }
    if (remotePartyId && call.remotePartyId && remotePartyId !== call.remotePartyId) {
      return;
    }
    const candidates = Array.isArray(event.content.candidates)
      ? event.content.candidates.map(candidateField).filter((item): item is MatrixCandidate => Boolean(item))
      : [];
    for (const candidate of candidates) {
      if (!this.peer?.remoteDescription || (call.direction === 'outgoing' && !call.remotePartyId)) {
        this.pendingRemoteCandidates.push({candidate, partyId: remotePartyId});
      } else if (candidate.candidate) {
        await this.peer.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined);
      }
    }
  }

  private handleSelectAnswer(event: NativeCallEvent): void {
    const call = this.activeCall;
    if (!call || call.direction !== 'incoming') {
      return;
    }
    const selected = stringField(event.content, 'selected_party_id');
    if (selected && selected !== call.partyId) {
      this.releaseCall();
    }
  }

  private async captureMedia(mediaType: CallMediaType): Promise<MediaStream> {
    return mediaDevices.getUserMedia({
      audio: true,
      video: mediaType === 'video'
        ? {facingMode: 'user', width: 640, height: 480, frameRate: 30}
        : false,
    });
  }

  private async createPeer(stream: MediaStream): Promise<void> {
    const iceServers = await this.loadIceServers();
    this.peer?.close();
    const peer = new RTCPeerConnection({iceServers});
    this.peer = peer;
    this.pendingLocalCandidates = [];
    this.signalingReady = false;
    stream.getTracks().forEach(track => peer.addTrack(track, stream));
    (peer as any).addEventListener('icecandidate', (event: {candidate?: {toJSON: () => MatrixCandidate} | null}) => {
      if (!this.activeCall) {
        return;
      }
      const candidate = event.candidate?.toJSON() ?? {candidate: '', sdpMid: null, sdpMLineIndex: null};
      this.pendingLocalCandidates.push(candidate);
      this.scheduleCandidateFlush();
    });
    (peer as any).addEventListener('track', (event: {streams: MediaStream[]; track?: MediaStreamTrack | null}) => {
      const remote = event.streams[0] ?? new MediaStream(event.track ? [event.track] : []);
      this.updateCall({remoteStream: remote});
    });
    (peer as any).addEventListener('connectionstatechange', () => {
      const current = this.activeCall;
      if (!current || peer !== this.peer) {
        return;
      }
      if (peer.connectionState === 'connected') {
        InCallManager.stopRingback();
        InCallManager.stopRingtone();
        this.clearInviteTimeout();
        this.updateCall({phase: 'connected', startedAt: current.startedAt ?? Date.now()});
      } else if (peer.connectionState === 'failed') {
        void this.sendHangup('ice_failed').catch(() => undefined);
        this.fail(new Error('Không thể thiết lập kết nối âm thanh/video.'));
      } else if (peer.connectionState === 'closed') {
        this.releaseCall();
      }
    });
    (peer as any).addEventListener('iceconnectionstatechange', () => {
      const current = this.activeCall;
      if (!current || peer !== this.peer) {
        return;
      }
      callTrace('ice', peer.iceConnectionState, current.callId);
      if (peer.iceConnectionState === 'connected' || peer.iceConnectionState === 'completed') {
        InCallManager.stopRingback();
        InCallManager.stopRingtone();
        this.clearInviteTimeout();
        this.updateCall({phase: 'connected', startedAt: current.startedAt ?? Date.now()});
      } else if (peer.iceConnectionState === 'failed') {
        void this.sendHangup('ice_failed').catch(() => undefined);
        this.fail(new Error('Không thể thiết lập kết nối âm thanh/video.'));
      }
    });
  }

  private async loadIceServers(): Promise<Array<{urls: string[]; username?: string; credential?: string}>> {
    if (!this.auth) {
      return [];
    }
    const endpoint = `${this.auth.baseUrl.replace(/\/+$/, '')}/_matrix/client/v3/voip/turnServer`;
    const response = await fetch(endpoint, {headers: {Authorization: `Bearer ${this.auth.accessToken}`}}).catch(() => undefined);
    if (!response?.ok) {
      return [];
    }
    const payload = await response.json() as TurnServerResponse;
    if (!payload.uris?.length) {
      return [];
    }
    return [{urls: payload.uris, username: payload.username, credential: payload.password}];
  }

  private async flushRemoteCandidates(selectedPartyId = this.activeCall?.remotePartyId): Promise<void> {
    if (!this.peer?.remoteDescription) {
      return;
    }
    const candidates = this.pendingRemoteCandidates.splice(0);
    for (const queued of candidates) {
      if (selectedPartyId && queued.partyId && queued.partyId !== selectedPartyId) {
        continue;
      }
      const candidate = queued.candidate;
      if (candidate.candidate) {
        await this.peer.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined);
      }
    }
  }

  private scheduleCandidateFlush(delay = 220): void {
    if (!this.signalingReady || this.candidateFlushTimer) {
      return;
    }
    this.candidateFlushTimer = setTimeout(() => {
      this.candidateFlushTimer = undefined;
      void this.flushLocalCandidates();
    }, delay);
  }

  private async flushLocalCandidates(): Promise<void> {
    const call = this.activeCall;
    if (!call || !this.signalingReady || !this.pendingLocalCandidates.length) {
      return;
    }
    const candidates = this.pendingLocalCandidates.splice(0);
    try {
      await this.sendEvent(call.roomId, CALL_EVENT_TYPES.candidates, {
        ...baseCallContent(call),
        candidates,
      });
    } catch (error) {
      this.pendingLocalCandidates.unshift(...candidates);
      this.fail(error);
      return;
    }
    if (this.pendingLocalCandidates.length) {
      this.scheduleCandidateFlush(0);
    }
  }

  private async sendEvent(roomId: string, type: string, content: Record<string, unknown>): Promise<void> {
    callTrace('send', type, stringField(content, 'call_id') ?? 'unknown', {
      party: stringField(content, 'party_id'),
    });
    await nativeMatrixService.sendCallEvent(roomId, type, content);
  }

  private async sendHangup(reason: string): Promise<void> {
    const call = this.activeCall;
    if (!call) {
      return;
    }
    await this.sendHangupFor(call, reason);
  }

  private async sendHangupFor(call: ActiveCall, reason: string): Promise<void> {
    this.markCallEnded(call.roomId, call.callId, Date.now());
    await this.sendEvent(call.roomId, CALL_EVENT_TYPES.hangup, {...baseCallContent(call), reason});
  }

  private async requireDirectRoom(roomId: string): Promise<NativeRoomDetails> {
    const details = await nativeMatrixService.getRoomDetails(roomId);
    if (!details.isDirect || details.joinedMembersCount !== 2) {
      throw new Error('Chỉ có thể gọi trong hội thoại trực tiếp 1:1 đã được chấp nhận.');
    }
    return details;
  }

  private requireReady(): void {
    if (!this.auth || !nativeMatrixService.isActive()) {
      throw new Error('Phiên đăng nhập chưa sẵn sàng để gọi.');
    }
  }

  private setActiveCall(call: ActiveCall): void {
    this.activeCall = call;
    this.emitState();
  }

  private updateCall(patch: Partial<ActiveCall>): void {
    if (!this.activeCall) {
      return;
    }
    this.activeCall = {...this.activeCall, ...patch};
    this.emitState();
  }

  private emitState(): void {
    this.emitter.emit('state', this.activeCall);
  }

  private armInviteTimeout(callId: string, timeout = INVITE_LIFETIME_MS): void {
    this.clearInviteTimeout();
    this.inviteTimer = setTimeout(() => {
      if (!this.isCurrent(callId) || this.activeCall?.phase === 'connected') {
        return;
      }
      void this.sendHangup('invite_timeout').catch(() => undefined);
      this.releaseCall();
    }, Math.max(1000, timeout));
  }

  private clearInviteTimeout(): void {
    if (this.inviteTimer) {
      clearTimeout(this.inviteTimer);
      this.inviteTimer = undefined;
    }
  }

  private isCurrent(callId: string): boolean {
    return this.activeCall?.callId === callId;
  }

  private fail(error: unknown): void {
    if (!this.activeCall) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error ?? 'Lỗi cuộc gọi');
    this.updateCall({phase: 'error', error: message});
    if (this.failureReleaseTimer) {
      clearTimeout(this.failureReleaseTimer);
    }
    this.failureReleaseTimer = setTimeout(() => {
      this.failureReleaseTimer = undefined;
      this.releaseCall();
    }, 1800);
  }

  private releaseCall(): void {
    if (this.cleaningUp) {
      return;
    }
    this.cleaningUp = true;
    try {
      this.clearInviteTimeout();
      if (this.candidateFlushTimer) {
        clearTimeout(this.candidateFlushTimer);
        this.candidateFlushTimer = undefined;
      }
      if (this.failureReleaseTimer) {
        clearTimeout(this.failureReleaseTimer);
        this.failureReleaseTimer = undefined;
      }
      InCallManager.stopRingtone();
      InCallManager.stopRingback();
      InCallManager.setKeepScreenOn(false);
      InCallManager.setMicrophoneMute(false);
      InCallManager.setForceSpeakerphoneOn(false);
      InCallManager.setSpeakerphoneOn(false);
      InCallManager.stop();
      this.peer?.close();
      this.peer = null;
      const releasedRoomId = this.activeCall?.roomId;
      if (this.activeCall?.localStream) {
        stopStream(this.activeCall.localStream);
      }
      if (this.activeCall?.remoteStream) {
        this.activeCall.remoteStream.release(false);
      }
      this.pendingRemoteCandidates = [];
      this.pendingLocalCandidates = [];
      this.signalingReady = false;
      if (this.activeCall) {
        this.markCallEnded(this.activeCall.roomId, this.activeCall.callId, Date.now());
      }
      this.activeCall = null;
      if (releasedRoomId) {
        nativeMatrixService.stopCallSignalObservers([releasedRoomId]);
      }
      this.emitState();
    } finally {
      this.cleaningUp = false;
    }
  }

  private callKey(roomId: string, callId: string): string {
    return `${roomId}:${callId}`;
  }

  private hasCallEnded(roomId: string, callId: string): boolean {
    return this.endedCalls.has(this.callKey(roomId, callId));
  }

  private markCallEnded(roomId: string, callId: string, timestamp: number): void {
    this.endedCalls.set(this.callKey(roomId, callId), timestamp || Date.now());
  }

  private pruneEndedCalls(): void {
    const cutoff = Date.now() - ENDED_CALL_TTL_MS;
    for (const [key, timestamp] of this.endedCalls) {
      if (timestamp < cutoff) {
        this.endedCalls.delete(key);
      }
    }
  }
}

function baseCallContent(call: ActiveCall): Record<string, unknown> {
  return {call_id: call.callId, party_id: call.partyId, version: CALL_EVENT_VERSION};
}

function opponentFromDetails(details: NativeRoomDetails, ownUserId: string, fallbackUserId = ''): {userId: string; name: string; avatarUrl?: string} {
  const opponent = details.members.find(member => member.userId !== ownUserId);
  const userId = opponent?.userId ?? fallbackUserId;
  return {
    userId,
    name: opponent?.displayName ?? details.name ?? compactUserId(userId),
    avatarUrl: opponent?.avatarUrl ?? details.avatarUrl,
  };
}

function compactUserId(userId: string): string {
  return userId.replace(/^@/, '').split(':')[0] || userId || 'Người dùng';
}

function randomCallId(): string {
  return `eclo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

function randomPartyId(deviceId: string): string {
  return `${deviceId.slice(0, 12)}-${Math.random().toString(36).slice(2, 12)}`;
}

function requireDescription(value: {type?: string | null; sdp?: string | null} | null, expectedType: 'offer' | 'answer'): RTCSessionDescriptionShape {
  if (!value?.sdp) {
    throw new Error('WebRTC không tạo được thông tin kết nối.');
  }
  return {type: expectedType, sdp: value.sdp};
}

function descriptionField(value: unknown, expectedType: 'offer' | 'answer'): RTCSessionDescriptionShape | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.sdp !== 'string' || !record.sdp) {
    return undefined;
  }
  return {type: expectedType, sdp: record.sdp};
}

function candidateField(value: unknown): MatrixCandidate | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.candidate !== 'string') {
    return undefined;
  }
  return {
    candidate: record.candidate,
    sdpMid: typeof record.sdpMid === 'string' ? record.sdpMid : null,
    sdpMLineIndex: typeof record.sdpMLineIndex === 'number' ? record.sdpMLineIndex : null,
  };
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === 'string' && field ? field : undefined;
}

function numberField(value: Record<string, unknown>, key: string): number | undefined {
  const field = value[key];
  return typeof field === 'number' && Number.isFinite(field) ? field : undefined;
}

function normalizeMatrixTimestamp(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  if (value > 1_000_000_000_000_000_000) {
    return Math.floor(value / 1_000_000);
  }
  if (value > 1_000_000_000_000_000) {
    return Math.floor(value / 1000);
  }
  if (value < 10_000_000_000) {
    return Math.floor(value * 1000);
  }
  return Math.floor(value);
}

function offerHasVideo(offer: RTCSessionDescriptionShape, content: Record<string, unknown>): boolean {
  if (/^m=video\s/im.test(offer.sdp)) {
    return true;
  }
  const metadata = content.sdp_stream_metadata;
  if (!metadata || typeof metadata !== 'object') {
    return false;
  }
  return Object.values(metadata as Record<string, unknown>).some(value => {
    return Boolean(value && typeof value === 'object' && (value as Record<string, unknown>).video_muted !== true);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function callTrace(action: string, type: string, callId: string, details?: Record<string, unknown>): void {
  const safeId = callId.length > 12 ? callId.slice(-12) : callId;
  const safeDetails = details ? Object.fromEntries(Object.entries(details).map(([key, value]) => [
    key,
    typeof value === 'string' && value.length > 12 ? value.slice(-12) : value,
  ])) : undefined;
  console.warn(`[ECLO call] ${action} ${type} #${safeId}`, safeDetails ?? '');
}

function streamMetadata(stream: MediaStream, mediaType: CallMediaType): Record<string, unknown> {
  return {
    [stream.id]: {
      purpose: 'm.usermedia',
      audio_muted: false,
      video_muted: mediaType !== 'video',
    },
  };
}

function stopStream(stream: MediaStream): void {
  stream.getTracks().forEach(track => track.stop());
  stream.release(false);
}

export const callService = new CallService();
