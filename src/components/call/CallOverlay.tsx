import React, {useEffect, useMemo, useState} from 'react';
import {ActivityIndicator, AppState, Modal, Pressable, StyleSheet, Text, View} from 'react-native';
import {RTCView} from 'react-native-webrtc';
import {
  Camera,
  CameraOff,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  RefreshCw,
  ShieldCheck,
  Volume2,
  VolumeX,
} from 'lucide-react-native';
import {callService, type ActiveCall} from '../../core/call/CallService';
import {nativeMatrixService} from '../../core/matrix/NativeMatrixService';
import {useSession} from '../../context/SessionContext';
import {useSafeAreaInsets} from '../../platform/safeArea';
import {MatrixAvatar} from '../MatrixAvatar';

export function CallOverlay() {
  const {state} = useSession();
  const insets = useSafeAreaInsets();
  const [call, setCall] = useState<ActiveCall | null>(callService.currentCall);
  const [clock, setClock] = useState(Date.now());

  useEffect(() => callService.subscribe(setCall), []);

  useEffect(() => {
    if (state.status === 'signed_in') {
      void nativeMatrixService.setAppActive(AppState.currentState === 'active');
      void callService.init(state.auth);
      return;
    }
    void callService.stop(false);
    void nativeMatrixService.setAppActive(false);
  }, [state]);

  useEffect(() => {
    if (state.status !== 'signed_in') {
      return;
    }
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') {
        void nativeMatrixService.setAppActive(true).then(() => callService.init(state.auth));
      } else if (!callService.currentCall) {
        void callService.stop(false);
        void nativeMatrixService.setAppActive(false);
      }
    });
    return () => subscription.remove();
  }, [state]);

  useEffect(() => {
    if (!call && AppState.currentState !== 'active') {
      void callService.stop(false);
      void nativeMatrixService.setAppActive(false);
    }
  }, [call]);

  useEffect(() => {
    if (!call?.startedAt) {
      return;
    }
    setClock(Date.now());
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [call?.startedAt]);

  const status = useMemo(() => callStatus(call, clock), [call, clock]);
  if (!call) {
    return null;
  }

  const video = call.mediaType === 'video';
  const remoteVideo = video && call.remoteStream?.getVideoTracks().some(track => track.enabled);
  const localVideo = video && call.localStream?.getVideoTracks().length;

  return (
    <Modal
      visible
      animationType="fade"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={() => undefined}>
      <View style={styles.screen}>
        {remoteVideo && call.remoteStream ? (
          <RTCView
            streamURL={call.remoteStream.toURL()}
            objectFit="cover"
            style={StyleSheet.absoluteFill}
            zOrder={0}
          />
        ) : null}
        <View style={[StyleSheet.absoluteFill, remoteVideo ? styles.videoShade : styles.voiceBackground]} />

        <View style={[styles.topBar, {paddingTop: Math.max(insets.top, 20)}]}>
          <View style={styles.securityPill}>
            <ShieldCheck color="#7ee2ad" size={16} strokeWidth={2.4} />
            <Text style={styles.securityText}>Mã hóa đầu cuối</Text>
          </View>
          <Text style={styles.callKind}>{video ? 'VIDEO 1:1' : 'CUỘC GỌI 1:1'}</Text>
        </View>

        <View style={styles.identity}>
          {!remoteVideo ? (
            <MatrixAvatar
              label={call.opponentName || call.opponentUserId}
              uri={call.opponentAvatarUrl}
              size={142}
              backgroundColor="#147df5"
              style={styles.avatar}
            />
          ) : null}
          <Text numberOfLines={2} style={styles.name}>{call.opponentName || call.opponentUserId}</Text>
          <View style={styles.statusRow}>
            {call.phase === 'connecting' ? <ActivityIndicator color="#fff" size="small" /> : null}
            <Text style={[styles.status, call.phase === 'error' ? styles.error : null]}>{status}</Text>
          </View>
        </View>

        {localVideo && call.localStream ? (
          <View style={[styles.localPreview, {top: Math.max(insets.top + 74, 110)}]}>
            {call.cameraEnabled ? (
              <RTCView
                streamURL={call.localStream.toURL()}
                objectFit="cover"
                mirror
                style={styles.localVideo}
                zOrder={1}
              />
            ) : (
              <View style={styles.cameraOffPreview}>
                <CameraOff color="#fff" size={25} />
              </View>
            )}
            <Pressable accessibilityRole="button" accessibilityLabel="Đổi camera" onPress={() => callService.switchCamera()} style={styles.switchCamera}>
              <RefreshCw color="#fff" size={17} />
            </Pressable>
          </View>
        ) : null}

        <View style={[styles.controlsArea, {paddingBottom: Math.max(insets.bottom + 22, 34)}]}>
          {call.direction === 'incoming' && call.phase === 'ringing' ? (
            <View style={styles.incomingControls}>
              <CallAction
                label="Từ chối"
                background="#e64040"
                onPress={() => void callService.rejectCall()}
                icon={<PhoneOff color="#fff" size={31} strokeWidth={2.3} />}
              />
              <CallAction
                label="Trả lời"
                background="#24a85a"
                onPress={() => void callService.answerCall()}
                icon={<Phone color="#fff" size={31} strokeWidth={2.3} />}
              />
            </View>
          ) : (
            <View style={styles.activeControls}>
              <CallAction
                compact
                label={call.microphoneEnabled ? 'Tắt mic' : 'Bật mic'}
                background={call.microphoneEnabled ? 'rgba(255,255,255,0.18)' : '#fff'}
                onPress={() => callService.toggleMicrophone()}
                icon={call.microphoneEnabled
                  ? <Mic color="#fff" size={25} />
                  : <MicOff color="#111827" size={25} />}
              />
              <CallAction
                compact
                label={call.speakerEnabled ? 'Loa' : 'Âm thanh'}
                background={call.speakerEnabled ? '#fff' : 'rgba(255,255,255,0.18)'}
                onPress={() => callService.toggleSpeaker()}
                icon={call.speakerEnabled
                  ? <Volume2 color="#111827" size={25} />
                  : <VolumeX color="#fff" size={25} />}
              />
              {video ? (
                <CallAction
                  compact
                  label={call.cameraEnabled ? 'Tắt camera' : 'Bật camera'}
                  background={call.cameraEnabled ? 'rgba(255,255,255,0.18)' : '#fff'}
                  onPress={() => callService.toggleCamera()}
                  icon={call.cameraEnabled
                    ? <Camera color="#fff" size={25} />
                    : <CameraOff color="#111827" size={25} />}
                />
              ) : null}
              <CallAction
                compact
                label="Kết thúc"
                background="#e64040"
                onPress={() => void callService.hangup()}
                icon={<PhoneOff color="#fff" size={26} strokeWidth={2.5} />}
              />
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function CallAction({label, background, icon, onPress, compact = false}: {
  label: string;
  background: string;
  icon: React.ReactNode;
  onPress: () => void;
  compact?: boolean;
}) {
  return (
    <View style={styles.actionWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={({pressed}) => [
          styles.actionButton,
          compact ? styles.actionButtonCompact : null,
          {backgroundColor: background},
          pressed ? styles.pressed : null,
        ]}>
        {icon}
      </Pressable>
      <Text style={styles.actionLabel}>{label}</Text>
    </View>
  );
}

function callStatus(call: ActiveCall | null, now: number): string {
  if (!call) {
    return '';
  }
  if (call.phase === 'error') {
    return call.error ?? 'Không thể thực hiện cuộc gọi';
  }
  if (call.phase === 'ringing') {
    return call.direction === 'incoming' ? 'Cuộc gọi đến…' : 'Đang gọi…';
  }
  if (call.phase === 'connecting') {
    return call.direction === 'outgoing' ? 'Đang kết nối…' : 'Đang chuẩn bị cuộc gọi…';
  }
  if (call.phase === 'connected' && call.startedAt) {
    const seconds = Math.max(0, Math.floor((now - call.startedAt) / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  return 'Cuộc gọi đã kết thúc';
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: '#07101f'},
  voiceBackground: {backgroundColor: '#081326'},
  videoShade: {backgroundColor: 'rgba(1, 6, 16, 0.28)'},
  topBar: {position: 'absolute', top: 0, left: 20, right: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  securityPill: {height: 34, paddingHorizontal: 12, borderRadius: 17, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'rgba(9, 20, 34, 0.62)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)'},
  securityText: {color: '#e7fff1', fontSize: 12, fontWeight: '700'},
  callKind: {color: 'rgba(255,255,255,0.72)', fontSize: 12, fontWeight: '800', letterSpacing: 1.1},
  identity: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingBottom: 98},
  avatar: {borderWidth: 3, borderColor: 'rgba(255,255,255,0.28)'},
  name: {marginTop: 24, color: '#fff', fontSize: 31, lineHeight: 37, fontWeight: '800', textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.45)', textShadowRadius: 10},
  statusRow: {marginTop: 12, minHeight: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: 16, paddingVertical: 7, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.24)'},
  status: {color: 'rgba(255,255,255,0.82)', fontSize: 15, fontWeight: '700'},
  error: {color: '#ffb4b4', textAlign: 'center'},
  localPreview: {position: 'absolute', right: 18, width: 112, height: 158, borderRadius: 19, overflow: 'hidden', backgroundColor: '#111827', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: {width: 0, height: 7}},
  localVideo: {width: '100%', height: '100%'},
  cameraOffPreview: {flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#182337'},
  switchCamera: {position: 'absolute', right: 7, bottom: 7, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.52)'},
  controlsArea: {position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 34, paddingHorizontal: 16, backgroundColor: 'rgba(1,6,16,0.38)'},
  incomingControls: {flexDirection: 'row', justifyContent: 'space-evenly', paddingHorizontal: 26},
  activeControls: {flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: 13},
  actionWrap: {alignItems: 'center', minWidth: 68},
  actionButton: {width: 70, height: 70, borderRadius: 35, alignItems: 'center', justifyContent: 'center'},
  actionButtonCompact: {width: 56, height: 56, borderRadius: 28},
  actionLabel: {marginTop: 8, color: 'rgba(255,255,255,0.82)', fontSize: 11, fontWeight: '600', textAlign: 'center'},
  pressed: {opacity: 0.72, transform: [{scale: 0.94}]},
});
