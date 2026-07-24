import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ActionSheetIOS, ActivityIndicator, Alert, Animated, Easing, FlatList, InteractionManager, Keyboard, Modal, NativeScrollEvent, NativeSyntheticEvent, PermissionsAndroid, Platform, Pressable, StyleSheet, Text, TextInput, Vibration, View, useWindowDimensions, type KeyboardEvent, type TextStyle, type ViewToken, DeviceEventEmitter, TouchableOpacity} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {launchImageLibrary, type Asset} from 'react-native-image-picker';
import {errorCodes as documentErrorCodes, isErrorWithCode, pick, types as documentTypes, type DocumentPickerResponse} from '@react-native-documents/picker';
import {createSound} from 'react-native-nitro-sound';
import RNFS from 'react-native-fs';
import {useSafeAreaInsets} from '../../platform/safeArea';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {MessageService, type TimelineItem, type TimelineMediaItem, type TimelineReaction} from '../../core/matrix/MessageService';
import {matrixClientService} from '../../core/matrix/MatrixClientService';
import type {RootStackParamList} from '../../navigation/RootNavigator';
import {useSession} from '../../context/SessionContext';
import {RoomService} from '../../core/matrix/RoomService';
import {matrixErrorMessage} from '../../core/matrix/errors';
import {nativeMatrixService, type NativeMediaUpload} from '../../core/matrix/NativeMatrixService';
import {useAppTheme} from '../../theme/useAppTheme';
import {GlassSurface} from '../../components/GlassSurface';
import {MatrixAvatar} from '../../components/MatrixAvatar';
import {MatrixMediaAudio} from '../../components/MatrixMediaAudio';
import {MatrixMediaImage} from '../../components/MatrixMediaImage';
import {MatrixMediaVideo} from '../../components/MatrixMediaVideo';
import {KlipyPicker} from '../../components/KlipyPicker';
import type {KlipyItem, KlipyMediaType} from '../../core/media/KlipyService';
import {saveMatrixAttachment} from '../../core/media/saveMatrixAttachment';
import { JitsiCallModal } from '../../components/JitsiCallModal';
import { generateJitsiJWT } from '../../utils/JitsiAuth';
import {
  ArrowUp,
  BarChart3,
  File,
  FileText,
  Forward,
  Image as ImageIcon,
  Mic,
  Pin,
  Reply,
  Smile,
  Trash2,
  Type,
  Video,
  PhoneOff,
} from 'lucide-react-native';

type Props = NativeStackScreenProps<RootStackParamList, 'Chat'>;
type TimelineListItem =
  | {kind: 'date'; id: string; timestamp: number; label: string}
  | {kind: 'message'; id: string; message: TimelineItem};
type NitroSound = ReturnType<typeof createSound>;
type FormatState = {bold: boolean; italic: boolean; underline: boolean; color?: string};

const INITIAL_FORMAT_STATE: FormatState = {bold: false, italic: false, underline: false};
// Keep these values aligned with the web client's formatted-body whitelist.
// Unknown colors are intentionally stripped by the web sanitizer.
const FORMAT_COLORS = ['#0d6efd', '#198754', '#dc3545', '#fd7e14', '#e91e63', '#6f42c1'];

export function ChatScreen({navigation, route}: Props) {
  const {pendingDirectUserId} = route.params;
  const colors = useAppTheme();
  const insets = useSafeAreaInsets();
  const {height: windowHeight} = useWindowDimensions();
  const {state} = useSession();
  const usingNative = state.status === 'signed_in' && nativeMatrixService.isActive();
  const client = state.status === 'signed_in' && !usingNative ? matrixClientService.currentClient : null;
  const service = useMemo(() => (client ? new MessageService(client) : null), [client]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(route.params.roomId ?? null);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<TimelineItem | null>(null);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [focusedMessage, setFocusedMessage] = useState<TimelineItem | null>(null);
  const [focusedJitsiEnded, setFocusedJitsiEnded] = useState(false);
  const [focusedJitsiDuration, setFocusedJitsiDuration] = useState<string | undefined>(undefined);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showExpressionMenu, setShowExpressionMenu] = useState(false);
  const [showFormatToolbar, setShowFormatToolbar] = useState(false);
  const [formatState, setFormatState] = useState<FormatState>(INITIAL_FORMAT_STATE);
  const [mediaSendProgress, setMediaSendProgress] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingMs, setRecordingMs] = useState(0);
  const [attachMenuMounted, setAttachMenuMounted] = useState(false);
  const [openingTimeline, setOpeningTimeline] = useState(Boolean(route.params.roomId));
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [currentDateLabel, setCurrentDateLabel] = useState('');
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(0);

  const [showJitsiModal, setShowJitsiModal] = useState(false);
  const [jitsiToken, setJitsiToken] = useState<string>('');
  const [jitsiRoomId, setJitsiRoomId] = useState<string>('');
  const [jitsiAudioOnly, setJitsiAudioOnly] = useState<boolean>(false);
  const [jitsiDisplayName, setJitsiDisplayName] = useState<string>('User');
  const [jitsiAvatarUrl, setJitsiAvatarUrl] = useState<string>('');
  const [isJitsiMinimized, setIsJitsiMinimized] = useState(false);
  const [activeJitsiWidget, setActiveJitsiWidget] = useState<any>(null);

  useEffect(() => {
    navigation.setOptions({
      headerShown: !(showJitsiModal && !isJitsiMinimized)
    });
  }, [navigation, showJitsiModal, isJitsiMinimized]);

  const listRef = useRef<FlatList<TimelineListItem>>(null);
  const attachMenuAnim = useRef(new Animated.Value(0)).current;
  const recordingPulse = useRef(new Animated.Value(0)).current;
  const firstTimelinePaint = useRef(true);
  const shouldStickToBottom = useRef(true);
  const userStartedScroll = useRef(false);
  const loadingOlderRef = useRef(false);
  const scrollOffsetYRef = useRef(0);
  const contentHeightRef = useRef(0);
  const pendingHistoryAdjustRef = useRef<{height: number; offset: number} | null>(null);
  const lastHistoryLoadAtRef = useRef(0);
  const recorderRef = useRef<{sound: NitroSound; uri: string} | null>(null);
  const cryptoReady = usingNative || matrixClientService.getCryptoStatus().ready;
  const room = activeRoomId ? client?.getRoom(activeRoomId) ?? null : null;
  const encrypted =
    usingNative
      ? false
      : client && room
        ? new RoomService(client).isEncrypted(room)
        : false;
  const canSend = state.status === 'signed_in' && (usingNative || !encrypted || cryptoReady);
  const ownUserId = state.status === 'signed_in' ? state.auth.userId : '';
  const visibleItems = useMemo(() => attachReactionSummaries(items), [items]);
  const itemById = useMemo(() => new Map(visibleItems.map(item => [item.id, item])), [visibleItems]);
  const timelineData = useMemo(() => withDateSeparators(visibleItems), [visibleItems]);
  const viewabilityConfig = useRef({itemVisiblePercentThreshold: 8, minimumViewTime: 60}).current;
  const onViewableItemsChanged = useRef(({viewableItems}: {viewableItems: ViewToken<TimelineListItem>[]}) => {
    const firstVisible = viewableItems.find(item => item.isViewable)?.item;
    if (!firstVisible) {
      return;
    }
    const label = firstVisible.kind === 'date'
      ? firstVisible.label
      : formatDateLabel(firstVisible.message.timestamp);
    setCurrentDateLabel(label);
  }).current;

  useEffect(() => {
    const latest = items.at(-1);
    setCurrentDateLabel(latest ? formatDateLabel(latest.timestamp) : '');

    const jitsiWidgets = items.filter(i => i.type === 'im.vector.modular.widgets');
    if (jitsiWidgets.length > 0) {
      const active = jitsiWidgets.find(w => w.raw?.data?.domain);
      setActiveJitsiWidget(active || null);
    } else {
      setActiveJitsiWidget(null);
    }
  }, [items]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('OPEN_JITSI_MODAL', (data) => {
      joinJitsiCall({ raw: { data: { conferenceId: data.conferenceId, domain: data.domain, type: data.type } } });
    });
    return () => sub.remove();
  }, []);

  const joinJitsiCall = async (widgetEvent: any) => {
    try {
      const data = widgetEvent.raw?.data || widgetEvent.raw?.content?.['org.eclo.jitsi'];
      if (!data || !data.conferenceId && !data.roomName) return;

      const confId = data.conferenceId || data.roomName;
      const domain = data.domain || 'jitsi.5hpc.com';
      const isAudioOnly = data.type === 'audio';
      const user = client ? client.getUser(ownUserId) : null;
      let displayName = user?.displayName || 'User';
      let avatarUrl = user?.avatarUrl ? client?.mxcUrlToHttp(user.avatarUrl) : '';

      if (usingNative) {
        try {
          const profile = await (nativeMatrixService as any).getOwnProfile();
          if (profile.displayName) displayName = profile.displayName;
          if (profile.avatarUrl) avatarUrl = profile.avatarUrl;
        } catch (e) {
          console.warn('Failed to get own profile', e);
        }
      }

      if (usingNative) {
        const auth = (nativeMatrixService as any).currentAccessToken;
        const baseUrl = (nativeMatrixService as any).currentBaseUrl;
        if (auth && baseUrl) {
          const res = await fetch(`${baseUrl.replace(/\/$/, '')}/_matrix/client/v3/user/${encodeURIComponent(ownUserId)}/openid/request_token`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${auth}`
            },
            body: JSON.stringify({})
          });
          const openIdToken = await res.json();
          const jwtToken = generateJitsiJWT(openIdToken, confId, domain, displayName, avatarUrl);
          setJitsiToken(jwtToken);
        }
      } else if (client) {
        const openIdToken = await client.getOpenIdToken();
        const jwtToken = generateJitsiJWT(openIdToken, confId, domain, displayName, avatarUrl);
        setJitsiToken(jwtToken);
      }

      setJitsiDisplayName(displayName);
      setJitsiAvatarUrl(avatarUrl);
      setJitsiRoomId(confId);
      setJitsiAudioOnly(isAudioOnly);
      setShowJitsiModal(true);
    } catch (e) {
      console.error("Failed to start Jitsi widget", e);
      Alert.alert("Lỗi", "Không thể tham gia cuộc gọi Jitsi");
    }
  };

  useEffect(() => () => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder) {
      recorder.sound.removeRecordBackListener();
      recorder.sound.stopRecorder().catch(() => undefined);
      recorder.sound.dispose();
    }
  }, []);

  useEffect(() => {
    if (!recording) {
      recordingPulse.stopAnimation();
      recordingPulse.setValue(0);
      return;
    }
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(recordingPulse, {toValue: 1, duration: 520, easing: Easing.inOut(Easing.ease), useNativeDriver: true}),
      Animated.timing(recordingPulse, {toValue: 0, duration: 520, easing: Easing.inOut(Easing.ease), useNativeDriver: true}),
    ]));
    animation.start();
    return () => animation.stop();
  }, [recording, recordingPulse]);

  const loadTimeline = useCallback((targetRoomId = activeRoomId) => {
    if (!targetRoomId) {
      setItems([]);
      return;
    }
    if (usingNative) {
      setItems(nativeMatrixService.getTimeline(targetRoomId));
      return;
    }
    if (!client) {
      return;
    }
    const room = client.getRoom(targetRoomId);
    setItems(room?.timeline.map(event => service?.mapTimelineEvent(event)).filter(Boolean) as TimelineItem[] ?? []);
  }, [activeRoomId, client, service, usingNative]);

  const markRoomRead = useCallback(() => {
    if (!activeRoomId) {
      return;
    }
    if (usingNative) {
      nativeMatrixService.markRoomRead(activeRoomId).catch(() => undefined);
      return;
    }
    if (!client) {
      return;
    }
    const currentRoom = client.getRoom(activeRoomId);
    const latest = currentRoom?.timeline.at(-1);
    if (latest) {
      client.sendReadReceipt(latest).catch(() => undefined);
      const eventId = latest.getId();
      if (eventId) {
        client.setRoomReadMarkers(activeRoomId, eventId, latest).catch(() => undefined);
      }
    }
    (currentRoom as any)?.setUnreadNotificationCount?.('total', 0);
    (currentRoom as any)?.setUnreadNotificationCount?.('highlight', 0);
  }, [activeRoomId, client, usingNative]);

  useEffect(() => {
    setActiveRoomId(route.params.roomId ?? null);
  }, [route.params.roomId, pendingDirectUserId]);

  useEffect(() => {
    if (!activeRoomId) {
      setItems([]);
      setOpeningTimeline(false);
      return;
    }
    let cancelled = false;
    setOpeningTimeline(true);
    if (usingNative) {
      const unsubscribe = nativeMatrixService.subscribeTimeline(activeRoomId, () => {
        if (cancelled) {
          return;
        }
        setItems(nativeMatrixService.getTimeline(activeRoomId));
        nativeMatrixService.markRoomRead(activeRoomId).catch(() => undefined);
      });
      nativeMatrixService.openTimeline(activeRoomId)
        .then(nextItems => {
          if (cancelled) {
            return;
          }
          setItems(nextItems);
          nativeMatrixService.markRoomRead(activeRoomId).catch(() => undefined);
        })
        .catch(err => {
          if (!cancelled) {
            setError(matrixErrorMessage(err));
          }
        })
        .finally(() => {
          if (!cancelled) {
            setOpeningTimeline(false);
          }
        });
      return () => {
        cancelled = true;
        unsubscribe();
      };
    }
    loadTimeline();
    markRoomRead();
    setOpeningTimeline(false);
    if (!client) {
      return;
    }
    const refreshTimeline = () => {
      loadTimeline();
      markRoomRead();
    };
    (client as any).on('Room.timeline', refreshTimeline);
    (client as any).on('Event.decrypted', refreshTimeline);
    return () => {
      (client as any).removeListener('Room.timeline', refreshTimeline);
      (client as any).removeListener('Event.decrypted', refreshTimeline);
    };
  }, [activeRoomId, client, loadTimeline, markRoomRead, usingNative]);

  useEffect(() => {
    if (!activeRoomId) {
      setPinnedIds(new Set());
      return;
    }
    let cancelled = false;
    if (usingNative) {
      nativeMatrixService.getPinnedEventIds(activeRoomId)
        .then(ids => {
          if (!cancelled) {
            setPinnedIds(new Set(ids));
          }
        })
        .catch(() => {
          if (!cancelled) {
            setPinnedIds(new Set());
          }
        });
      return () => {
        cancelled = true;
      };
    }
    if (!client) {
      setPinnedIds(new Set());
      return;
    }
    const content = client.getRoom(activeRoomId)?.currentState.getStateEvents('m.room.pinned_events', '')?.getContent?.() as {pinned?: string[]} | undefined;
    setPinnedIds(new Set(content?.pinned ?? []));
    const refreshPinned = () => {
      const nextContent = client.getRoom(activeRoomId)?.currentState.getStateEvents('m.room.pinned_events', '')?.getContent?.() as {pinned?: string[]} | undefined;
      setPinnedIds(new Set(nextContent?.pinned ?? []));
    };
    (client as any).on('RoomState.events', refreshPinned);
    return () => {
      (client as any).removeListener('RoomState.events', refreshPinned);
    };
  }, [activeRoomId, client, usingNative]);

  useEffect(() => {
    firstTimelinePaint.current = true;
    shouldStickToBottom.current = true;
    userStartedScroll.current = false;
  }, [activeRoomId, pendingDirectUserId]);

  const scrollToLatest = useCallback((animated: boolean) => {
    const scroll = () => listRef.current?.scrollToEnd({animated});
    scroll();
    requestAnimationFrame(scroll);
    const interaction = InteractionManager.runAfterInteractions(scroll);
    const shortTimer = setTimeout(scroll, 120);
    const longTimer = setTimeout(scroll, 360);
    return () => {
      interaction.cancel();
      clearTimeout(shortTimer);
      clearTimeout(longTimer);
    };
  }, []);

  const stickToLatestSoon = useCallback((animated: boolean) => {
    shouldStickToBottom.current = true;
    firstTimelinePaint.current = false;
    const cleanup = scrollToLatest(animated);
    const timer = setTimeout(() => scrollToLatest(animated), 180);
    return () => {
      cleanup();
      clearTimeout(timer);
    };
  }, [scrollToLatest]);

  useEffect(() => {
    const syncKeyboard = (event?: KeyboardEvent) => {
      const end = event?.endCoordinates;
      const nextOffset = end && end.screenY < windowHeight - 1
        ? Math.max(0, end.height)
        : 0;
      setKeyboardOffset(nextOffset);
      if (nextOffset > 0) {
        setShowAttachMenu(false);
      }
    };

    const subscriptions = Platform.OS === 'ios'
      ? [
          Keyboard.addListener('keyboardWillChangeFrame', syncKeyboard),
          Keyboard.addListener('keyboardWillHide', () => syncKeyboard()),
        ]
      : [
          Keyboard.addListener('keyboardDidShow', syncKeyboard),
          Keyboard.addListener('keyboardDidHide', () => syncKeyboard()),
        ];
    return () => {
      subscriptions.forEach(subscription => subscription.remove());
    };
  }, [windowHeight]);

  useEffect(() => {
    if (keyboardOffset > 0 && shouldStickToBottom.current) {
      const shortTimer = setTimeout(() => scrollToLatest(false), 30);
      const longTimer = setTimeout(() => scrollToLatest(false), 120);
      return () => {
        clearTimeout(shortTimer);
        clearTimeout(longTimer);
      };
    }
  }, [keyboardOffset, scrollToLatest]);

  useEffect(() => {
    if (bottomPanelHeight > 0 && shouldStickToBottom.current) {
      const timer = setTimeout(() => scrollToLatest(false), 80);
      return () => clearTimeout(timer);
    }
  }, [bottomPanelHeight, scrollToLatest]);

  useEffect(() => {
    if (showAttachMenu) {
      setAttachMenuMounted(true);
      Animated.spring(attachMenuAnim, {
        toValue: 1,
        damping: 18,
        stiffness: 230,
        mass: 0.8,
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.timing(attachMenuAnim, {
      toValue: 0,
      duration: 140,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({finished}) => {
      if (finished) {
        setAttachMenuMounted(false);
      }
    });
  }, [attachMenuAnim, showAttachMenu]);

  useFocusEffect(
    useCallback(() => {
      shouldStickToBottom.current = true;
      firstTimelinePaint.current = true;
      const timer = setTimeout(() => scrollToLatest(false), 80);
      return () => clearTimeout(timer);
    }, [activeRoomId, scrollToLatest]),
  );

  useEffect(() => {
    if (!timelineData.length || loadingOlder || !shouldStickToBottom.current) {
      return;
    }
    const cleanup = scrollToLatest(false);
    firstTimelinePaint.current = false;
    return cleanup;
  }, [timelineData.length, loadingOlder, scrollToLatest]);

  useEffect(() => {
    if (route.params.jumpToEventId && timelineData.length) {
      jumpToMessage(route.params.jumpToEventId);
    }
  }, [route.params.jumpToEventId, timelineData.length]);

  useEffect(() => {
    if (showJitsiModal && jitsiRoomId && timelineData.length) {
      const confId = jitsiRoomId;
      const endMsg = timelineData.find(m => m.kind === 'message' && 
        ((confId && (m.message.raw as any)?.['org.eclo.jitsi_end']?.conferenceId === confId))
      );
      if (endMsg) {
        setShowJitsiModal(false);
        setActiveJitsiWidget(null);
      }
    }
  }, [timelineData, jitsiRoomId, showJitsiModal]);

  async function ensureRoomForOutgoing(): Promise<string> {
    if (activeRoomId) {
      return activeRoomId;
    }
    if (!pendingDirectUserId) {
      throw new Error('Chưa có phòng chat.');
    }
    const roomId = usingNative
      ? await nativeMatrixService.createOrOpenDirectChat(pendingDirectUserId)
      : await new RoomService(matrixClientService.currentClient).createOrOpenDirectChat(pendingDirectUserId);
    setActiveRoomId(roomId);
    return roomId;
  }

  async function send() {
    const text = body.trim();
    if (!text) {
      return;
    }
    setError(null);
    try {
      const formattedHtml = hasActiveFormatting(formatState) ? formattedHtmlBody(text, formatState) : undefined;
      if (usingNative) {
        const roomId = await ensureRoomForOutgoing();
        if (formattedHtml) {
          await nativeMatrixService.sendFormattedText(roomId, text, formattedHtml, replyTo?.id);
        } else {
          await nativeMatrixService.sendText(roomId, text, replyTo?.id);
        }
        setBody('');
        setFormatState(INITIAL_FORMAT_STATE);
        setShowFormatToolbar(false);
        setReplyTo(null);
        setShowAttachMenu(false);
        loadTimeline(roomId);
        stickToLatestSoon(false);
        return;
      }
      if (!service) {
        throw new Error('Phiên kết nối chưa sẵn sàng.');
      }
      const roomId = await ensureRoomForOutgoing();
      if (formattedHtml) {
        await service.sendFormattedText(roomId, text, formattedHtml, replyTo?.id);
      } else if (replyTo) {
        await service.sendReply(roomId, text, replyTo.id);
      } else {
        await service.sendText(roomId, text);
      }
      setBody('');
      setFormatState(INITIAL_FORMAT_STATE);
      setShowFormatToolbar(false);
      setReplyTo(null);
      setShowAttachMenu(false);
      loadTimeline(roomId);
      stickToLatestSoon(false);
    } catch (err) {
      setError(matrixErrorMessage(err));
    }
  }

  async function reactToMessage(message: TimelineItem, key = '👍') {
    if (!activeRoomId) {
      return;
    }
    setError(null);
    try {
      if (usingNative) {
        await nativeMatrixService.react(activeRoomId, message.id, key);
        loadTimeline(activeRoomId);
        return;
      }
      if (!service) {
        throw new Error('Phiên kết nối chưa sẵn sàng.');
      }
      await service.sendReaction(activeRoomId, message.id, key);
      loadTimeline(activeRoomId);
    } catch (err) {
      setError(matrixErrorMessage(err));
    }
  }

  async function openPollComposer() {
    setError(null);
    try {
      const roomId = await ensureRoomForOutgoing();
      setShowAttachMenu(false);
      navigation.navigate('PollComposer', {roomId, title: route.params.title});
    } catch (err) {
      setError(matrixErrorMessage(err));
    }
  }

  async function votePoll(message: TimelineItem, answerId: string) {
    if (!activeRoomId || message.poll?.answers.find(answer => answer.id === answerId)?.selected) {
      return;
    }
    setError(null);
    try {
      if (usingNative) {
        await nativeMatrixService.sendPollResponse(activeRoomId, message.id, answerId);
      } else if (service) {
        await service.sendPollResponse(activeRoomId, message.id, answerId);
      }
      loadTimeline(activeRoomId);
    } catch (err) {
      setError(matrixErrorMessage(err));
    }
  }

  async function loadMore() {
    if (loadingOlderRef.current || !activeRoomId) {
      return;
    }
    const now = Date.now();
    if (now - lastHistoryLoadAtRef.current < 850) {
      return;
    }
    lastHistoryLoadAtRef.current = now;
    const previousFirstId = items[0]?.id;
    const previousLength = items.length;
    pendingHistoryAdjustRef.current = {
      height: contentHeightRef.current,
      offset: scrollOffsetYRef.current,
    };
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    shouldStickToBottom.current = false;
    setError(null);
    try {
      if (usingNative) {
        await nativeMatrixService.loadMore(activeRoomId);
        const nextItems = nativeMatrixService.getTimeline(activeRoomId);
        setItems(nextItems);
        updateHistoryAvailability(nextItems, previousLength, previousFirstId);
        return;
      }
      await service?.loadMore(activeRoomId);
      const room = client?.getRoom(activeRoomId);
      const nextItems = room?.timeline.map(event => service?.mapTimelineEvent(event)).filter(Boolean) as TimelineItem[] ?? [];
      setItems(nextItems);
      updateHistoryAvailability(nextItems, previousLength, previousFirstId);
    } catch (err) {
      setError(err instanceof Error ? matrixErrorMessage(err) : 'Không thể tải thêm tin nhắn.');
      pendingHistoryAdjustRef.current = null;
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }

  function updateHistoryAvailability(nextItems: TimelineItem[], previousLength: number, previousFirstId?: string) {
    const nextFirstId = nextItems[0]?.id;
    const stillSameStart = previousFirstId && nextFirstId === previousFirstId;
    const noGrowth = nextItems.length <= previousLength;
    if (noGrowth || stillSameStart) {
      pendingHistoryAdjustRef.current = null;
    }
  }

  function handleScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const {contentOffset, contentSize, layoutMeasurement} = event.nativeEvent;
    scrollOffsetYRef.current = contentOffset.y;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    shouldStickToBottom.current = distanceFromBottom < 120;
    if (userStartedScroll.current && contentOffset.y < 72 && items.length > 0 && !loadingOlderRef.current) {
      loadMore();
    }
  }

  function handleContentSizeChange(_width: number, height: number) {
    const pendingAdjust = pendingHistoryAdjustRef.current;
    const previousHeight = contentHeightRef.current;
    contentHeightRef.current = height;

    if (pendingAdjust) {
      pendingHistoryAdjustRef.current = null;
      const delta = height - pendingAdjust.height;
      if (delta > 0) {
        requestAnimationFrame(() => {
          listRef.current?.scrollToOffset({
            offset: Math.max(0, pendingAdjust.offset + delta),
            animated: false,
          });
        });
      }
      return;
    }

    if (loadingOlderRef.current) {
      return;
    }

    if (firstTimelinePaint.current || shouldStickToBottom.current) {
      scrollToLatest(false);
      firstTimelinePaint.current = false;
    }
  }

  async function togglePinnedMessage(message: TimelineItem) {
    if (!activeRoomId) {
      return;
    }
    if (usingNative) {
      setError(null);
      try {
        if (pinnedIds.has(message.id)) {
          await nativeMatrixService.unpinMessage(activeRoomId, message.id);
          const next = new Set(pinnedIds);
          next.delete(message.id);
          setPinnedIds(next);
        } else {
          await nativeMatrixService.pinMessage(activeRoomId, message.id);
          setPinnedIds(new Set([...pinnedIds, message.id]));
        }
      } catch (err) {
        setError(matrixErrorMessage(err));
      }
      return;
    }
    if (!client) {
      setError('Phiên kết nối chưa sẵn sàng.');
      return;
    }
    setError(null);
    try {
      const next = new Set(pinnedIds);
      if (next.has(message.id)) {
        next.delete(message.id);
      } else {
        next.add(message.id);
      }
      await (client as any).sendStateEvent(activeRoomId, 'm.room.pinned_events', {pinned: [...next]}, '');
      setPinnedIds(next);
    } catch (err) {
      setError(matrixErrorMessage(err));
    }
  }

  async function redactMessage(message: TimelineItem) {
    if (!activeRoomId) {
      return;
    }
    if (usingNative) {
      setError(null);
      try {
        await nativeMatrixService.redactMessage(activeRoomId, message.id, 'Thu hồi tin nhắn');
        loadTimeline(activeRoomId);
      } catch (err) {
        setError(matrixErrorMessage(err));
      }
      return;
    }
    if (!client) {
      setError('Phiên kết nối chưa sẵn sàng.');
      return;
    }
    if (!service) {
      setError('Phiên kết nối chưa sẵn sàng.');
      return;
    }
    setError(null);
    try {
      await service.redactMessage(activeRoomId, message.id, 'Thu hồi tin nhắn');
      loadTimeline(activeRoomId);
    } catch (err) {
      setError(matrixErrorMessage(err));
    }
  }

  function openMessageActions(message: TimelineItem, isJitsiCallEnded?: boolean, callDurationText?: string) {
    if (Platform.OS !== 'ios') {
      Vibration.vibrate(6);
    }
    setFocusedMessage(message);
    setFocusedJitsiEnded(isJitsiCallEnded ?? false);
    setFocusedJitsiDuration(callDurationText);
  }

  function showReactionDetails(message: TimelineItem) {
    const grouped = groupReactions(message.reactions ?? []);
    const detail = grouped
      .map(reaction => `${reaction.key} ${reaction.count} lượt\n${reactionSendersLabel(reaction.senders)}`)
      .join('\n\n');
    Alert.alert('Reaction', detail || 'Chưa có reaction');
  }

  function openMediaViewer(mediaId: string) {
    if (!activeRoomId) {
      return;
    }
    navigation.navigate('MediaViewer', {roomId: activeRoomId, title: route.params.title, mediaId});
  }

  async function jumpToMessage(eventId: string, attempts = 0) {
    const index = timelineData.findIndex(item => item.kind === 'message' && item.message.id === eventId);
    if (index >= 0) {
      shouldStickToBottom.current = false;
      listRef.current?.scrollToIndex({index, animated: true, viewPosition: 0.45});
      setHighlightedMessageId(eventId);
      setTimeout(() => setHighlightedMessageId(current => current === eventId ? null : current), 1600);
      return;
    }
    if (attempts < 3 && activeRoomId && !loadingOlderRef.current) {
      await loadMore();
      setTimeout(() => jumpToMessage(eventId, attempts + 1), 180);
    }
  }

  async function leaveRoom() {
    if (!activeRoomId) {
      setError('Cuộc trò chuyện này chưa tạo phòng.');
      return;
    }
    setError(null);
    try {
      if (usingNative) {
        await nativeMatrixService.leaveRoom(activeRoomId);
        setError('Đã rời cuộc trò chuyện.');
        return;
      }
      if (!client) {
        throw new Error('Phiên kết nối chưa sẵn sàng.');
      }
      await new RoomService(client).leaveRoom(activeRoomId);
      setError('Đã rời cuộc trò chuyện.');
    } catch (err) {
      setError(err instanceof Error ? matrixErrorMessage(err) : 'Không thể rời cuộc trò chuyện.');
    }
  }

  async function choosePhotosAndVideos() {
    setShowAttachMenu(false);
    setError(null);
    try {
      const result = await launchImageLibrary({
        mediaType: 'mixed',
        selectionLimit: 0,
        quality: 0.9,
        assetRepresentationMode: 'compatible',
        formatAsMp4: true,
      });
      if (result.didCancel) {
        return;
      }
      if (result.errorCode) {
        throw new Error(result.errorMessage || `Không mở được thư viện (${result.errorCode}).`);
      }
      const uploads = (result.assets ?? []).map(mediaUploadFromAsset).filter((item): item is NativeMediaUpload => Boolean(item));
      if (!uploads.length) {
        throw new Error('Không đọc được ảnh hoặc video đã chọn.');
      }
      if (!usingNative) {
        throw new Error('Phiên đăng nhập chưa sẵn sàng để gửi nội dung. Hãy đăng nhập lại.');
      }
      const roomId = await ensureRoomForOutgoing();
      setMediaSendProgress(`Đang gửi 0/${uploads.length} ảnh/video…`);
      await nativeMatrixService.sendMediaUploads(roomId, uploads, replyTo?.id, (sent, total) => {
        setMediaSendProgress(`Đang gửi ${sent}/${total} ảnh/video…`);
      });
      setReplyTo(null);
      loadTimeline(roomId);
      stickToLatestSoon(false);
    } catch (err) {
      setError(matrixErrorMessage(err));
    } finally {
      setMediaSendProgress(null);
    }
  }

  async function chooseGifOrSticker() {
    setShowExpressionMenu(false);
    setError(null);
    try {
      const result = await launchImageLibrary({
        mediaType: 'photo',
        selectionLimit: 1,
        quality: 1,
        assetRepresentationMode: 'current',
      });
      if (result.didCancel) {
        return;
      }
      if (result.errorCode) {
        throw new Error(result.errorMessage || `Không mở được thư viện (${result.errorCode}).`);
      }
      const upload = result.assets?.map(mediaUploadFromAsset).find((item): item is NativeMediaUpload => Boolean(item));
      if (!upload) {
        throw new Error('Không đọc được GIF hoặc sticker đã chọn.');
      }
      if (!usingNative) {
        throw new Error('Phiên đăng nhập chưa sẵn sàng để gửi nội dung. Hãy đăng nhập lại.');
      }
      const roomId = await ensureRoomForOutgoing();
      setMediaSendProgress('Đang gửi GIF/sticker…');
      await nativeMatrixService.sendStickerUpload(roomId, {...upload, kind: 'sticker'}, replyTo?.id);
      setReplyTo(null);
      loadTimeline(roomId);
      stickToLatestSoon(false);
    } catch (err) {
      setError(matrixErrorMessage(err));
    } finally {
      setMediaSendProgress(null);
    }
  }

  async function chooseFiles() {
    setShowAttachMenu(false);
    setError(null);
    try {
      const result = await pick({
        type: [documentTypes.allFiles],
        allowMultiSelection: true,
        mode: 'import',
      });
      const uploads = result.map(mediaUploadFromDocument);
      if (!usingNative) {
        throw new Error('Phiên đăng nhập chưa sẵn sàng để gửi tệp. Hãy đăng nhập lại.');
      }
      const roomId = await ensureRoomForOutgoing();
      setMediaSendProgress(`Đang gửi 0/${uploads.length} tệp…`);
      await nativeMatrixService.sendMediaUploads(roomId, uploads, replyTo?.id, (sent, total) => {
        setMediaSendProgress(`Đang gửi ${sent}/${total} tệp…`);
      });
      setReplyTo(null);
      loadTimeline(roomId);
      stickToLatestSoon(false);
    } catch (err) {
      if (isErrorWithCode(err) && err.code === documentErrorCodes.OPERATION_CANCELED) {
        return;
      }
      setError(matrixErrorMessage(err));
    } finally {
      setMediaSendProgress(null);
    }
  }

  function runAttachAction(index: number) {
    switch (index) {
      case 0:
        void chooseFiles();
        break;
      case 1:
        void choosePhotosAndVideos();
        break;
      case 2:
        void openPollComposer();
        break;
      case 3:
        toggleFormatToolbar();
        break;
      default:
        break;
    }
  }

  function openAttachActions() {
    Keyboard.dismiss();
    setShowExpressionMenu(false);
    if (Platform.OS === 'ios') {
      setShowAttachMenu(false);
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: 'Tiện ích tin nhắn',
          options: ['File', 'Ảnh & video', 'Bình chọn', 'Định dạng', 'Hủy'],
          cancelButtonIndex: 4,
          disabledButtonIndices: canSend ? undefined : [0, 1, 2, 3],
          tintColor: colors.primary,
          userInterfaceStyle: colors.dark ? 'dark' : 'light',
        },
        index => runAttachAction(index),
      );
      return;
    }
    setShowAttachMenu(current => !current);
  }

  function toggleFormatToolbar() {
    setShowAttachMenu(false);
    setShowExpressionMenu(false);
    setShowFormatToolbar(current => !current);
  }

  async function startVoiceNote() {
    if (recording) {
      await finishVoiceNote(true);
      return;
    }
    setError(null);
    try {
      if (!usingNative) {
        throw new Error('Phiên đăng nhập chưa sẵn sàng để gửi ghi âm. Hãy đăng nhập lại.');
      }
      if (Platform.OS === 'android') {
        const permission = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
          title: 'Quyền ghi âm',
          message: 'ECLO Chat cần dùng micro để gửi tin nhắn thoại.',
          buttonPositive: 'Cho phép',
          buttonNegative: 'Không cho phép',
        });
        if (permission !== PermissionsAndroid.RESULTS.GRANTED) {
          throw new Error('Bạn chưa cho phép ECLO Chat sử dụng micro.');
        }
      }
      const sound = createSound();
      sound.setSubscriptionDuration(0.2);
      sound.addRecordBackListener(event => setRecordingMs(event.currentPosition));
      const recordingPath = `${RNFS.CachesDirectoryPath}/voice-${Date.now()}-${Math.random().toString(36).slice(2)}.m4a`;
      await RNFS.unlink(recordingPath).catch(() => undefined);
      const uri = await sound.startRecorder(recordingPath, undefined, true);
      recorderRef.current = {sound, uri};
      setRecordingMs(0);
      setRecording(true);
    } catch (err) {
      setError(matrixErrorMessage(err));
    }
  }

  async function finishVoiceNote(shouldSend: boolean) {
    const recorder = recorderRef.current;
    if (!recorder) {
      setRecording(false);
      return;
    }
    recorderRef.current = null;
    setRecording(false);
    try {
      const stoppedUri = await recorder.sound.stopRecorder();
      recorder.sound.removeRecordBackListener();
      const uri = stoppedUri || recorder.uri;
      if (!shouldSend) {
        await RNFS.unlink(localPathFromUri(uri)).catch(() => undefined);
        return;
      }
      const roomId = await ensureRoomForOutgoing();
      const stat = await RNFS.stat(localPathFromUri(uri)).catch(() => undefined);
      setMediaSendProgress('Đang gửi tin nhắn thoại…');
      await nativeMatrixService.sendMediaUploads(roomId, [{
        uri,
        kind: 'audio',
        fileName: `voice-${Date.now()}.m4a`,
        mimeType: 'audio/mp4',
        fileSize: stat ? Number(stat.size) : undefined,
        durationMs: Math.max(1, recordingMs),
      }], replyTo?.id);
      setReplyTo(null);
      loadTimeline(roomId);
      stickToLatestSoon(false);
    } catch (err) {
      setError(matrixErrorMessage(err));
    } finally {
      recorder.sound.dispose();
      setRecordingMs(0);
      setMediaSendProgress(null);
    }
  }

  function handlePrimaryAction() {
    if (body.trim()) {
      send();
      return;
    }
    void startVoiceNote();
  }

  async function sendKlipyItem(item: KlipyItem, type: KlipyMediaType) {
    setShowExpressionMenu(false);
    setError(null);
    let downloadedPath: string | undefined;
    try {
      if (!usingNative) {
        throw new Error('Phiên đăng nhập chưa sẵn sàng để gửi nội dung. Hãy đăng nhập lại.');
      }
      const media = klipyMediaFormat(item.url);
      downloadedPath = `${RNFS.CachesDirectoryPath}/klipy-${type}-${Date.now()}-${Math.random().toString(36).slice(2)}.${media.extension}`;
      const result = await RNFS.downloadFile({fromUrl: item.url, toFile: downloadedPath}).promise;
      if (result.statusCode < 200 || result.statusCode >= 300) {
        throw new Error('Không thể tải sticker. Vui lòng thử lại.');
      }
      const stat = await RNFS.stat(downloadedPath);
      const roomId = await ensureRoomForOutgoing();
      setMediaSendProgress(type === 'sticker' ? 'Đang gửi sticker…' : 'Đang gửi GIF…');
      const upload: NativeMediaUpload = {
        uri: `file://${downloadedPath}`,
        kind: type === 'sticker' ? 'sticker' : 'image',
        fileName: `${type}-${Date.now()}.${media.extension}`,
        mimeType: media.mimeType,
        fileSize: Number(stat.size),
      };
      if (type === 'sticker') {
        await nativeMatrixService.sendStickerUpload(roomId, upload, replyTo?.id);
      } else {
        await nativeMatrixService.sendMediaUploads(roomId, [upload], replyTo?.id);
      }
      setReplyTo(null);
      loadTimeline(roomId);
      stickToLatestSoon(false);
    } catch (err) {
      setError(matrixErrorMessage(err));
    } finally {
      if (downloadedPath) {
        await RNFS.unlink(downloadedPath).catch(() => undefined);
      }
      setMediaSendProgress(null);
    }
  }

  async function downloadAttachment(message: TimelineItem) {
    setError(null);
    try {
      await saveMatrixAttachment(message);
    } catch (err) {
      if (isErrorWithCode(err) && err.code === documentErrorCodes.OPERATION_CANCELED) {
        return;
      }
      setError(matrixErrorMessage(err));
    }
  }

  const hasText = Boolean(body.trim());
  const glassTint = colors.dark ? 'rgba(28, 34, 48, 0.58)' : 'rgba(255, 255, 255, 0.58)';
  const menuGlassTint = colors.dark ? 'rgba(24, 30, 44, 0.76)' : 'rgba(255, 255, 255, 0.78)';
  const iconSurface = colors.dark ? 'rgba(255,255,255,0.08)' : 'rgba(7, 113, 246, 0.08)';
  const composerBottomInset = keyboardOffset > 0 ? 8 : Math.max(insets.bottom, 8) + 8;
  const measuredPanelHeight = bottomPanelHeight || 112 + Math.max(insets.bottom, 8);
  const timelineBottomPadding = measuredPanelHeight + keyboardOffset + (showAttachMenu && Platform.OS !== 'ios' ? 128 : 12);
  const composerLift = -keyboardOffset;
  const attachMenuTranslateY = attachMenuAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [16, 0],
  });
  const attachMenuScale = attachMenuAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.96, 1],
  });

  return (
    <View style={[styles.screen, chatBackgroundStyle(colors)]}>
      <FlatList
        ref={listRef}
        data={timelineData}
        keyExtractor={item => item.id}
        contentContainerStyle={[
          styles.timeline,
          {paddingTop: insets.top + 58},
          timelineData.length === 0 ? styles.timelineEmptyContainer : null,
        ]}
        initialNumToRender={30}
        maxToRenderPerBatch={20}
        windowSize={12}
        removeClippedSubviews={false}
        automaticallyAdjustKeyboardInsets={false}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={() => {
          userStartedScroll.current = true;
          setShowAttachMenu(false);
        }}
        onScroll={handleScroll}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        onContentSizeChange={handleContentSizeChange}
        onScrollToIndexFailed={info => {
          listRef.current?.scrollToOffset({offset: Math.max(0, info.averageItemLength * info.index), animated: true});
        }}
        scrollEventThrottle={16}
        ListFooterComponent={<View style={{height: timelineBottomPadding}} />}
        ListHeaderComponent={
          <View style={styles.timelineHeader}>
            {encrypted && !cryptoReady ? (
              <Text style={[styles.warning, {backgroundColor: colors.warningSoft, color: colors.warning}]}>
                Cuộc trò chuyện chưa sẵn sàng. Vui lòng mở lại ứng dụng.
              </Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <View style={[styles.empty, openingTimeline ? {borderWidth: 0} : {backgroundColor: colors.surface, borderColor: colors.separator}]}>
            {openingTimeline ? <ActivityIndicator color={colors.primary} /> : null}
            <Text style={[styles.emptyTitle, {color: colors.text}]}>{openingTimeline ? 'Đang tải tin nhắn...' : 'Chưa có tin nhắn'}</Text>
            <Text style={[styles.emptyText, {color: colors.secondaryText}]}>
              {openingTimeline ? 'Đang mở lịch sử đã lưu trên máy.' : 'Gửi tin đầu tiên để bắt đầu cuộc trò chuyện.'}
            </Text>
          </View>
        }
        renderItem={({item, index}) => {
          if (item.kind === 'date') {
            return (
              <View style={styles.dateSeparator}>
                <GlassSurface effect="clear" style={[styles.datePillSurface, {shadowColor: colors.shadow}]}>
                  <Text style={[styles.datePillText, {color: colors.secondaryText}]}>{item.label}</Text>
                </GlassSurface>
              </View>
            );
          }
          const message = item.message;
          if (message.messageKind === 'system') {
            if (message.type === 'm.call.hangup' || message.type === 'org.eclo.jitsi.call_end' || message.type === 'im.vector.modular.widgets') {
              return null;
            }
            return (
              <View style={styles.systemRow}>
                <GlassSurface effect="clear" style={[styles.systemPill, {shadowColor: colors.shadow}]}>
                  <Text style={[styles.systemText, {color: colors.secondaryText}]}>{message.body || 'Cập nhật nhóm'}</Text>
                </GlassSurface>
              </View>
            );
          }
          if (isMediaGroupContinuation(timelineData, index)) {
            return null;
          }
          const mediaGroup = mediaGroupFromTimeline(timelineData, index);
          const previousMessage = nearestMessage(timelineData, index, -1);
          const nextMessage = nearestMessage(timelineData, index, 1);
          const groupedWithPrevious = Boolean(previousMessage && canGroupMessages(previousMessage, message));
          const groupedWithNext = Boolean(nextMessage && canGroupMessages(message, nextMessage)) || mediaGroup.length > 1;
          const isMine = message.sender === ownUserId;
          const showSender = !isMine && !groupedWithPrevious;
          const showAvatar = !isMine && !groupedWithNext;
          const showTimestamp = !groupedWithNext;
          const replyMessage = message.replyTo ? itemById.get(message.replyTo) : undefined;
          const highlighted = highlightedMessageId === message.id;
          
          let isJitsiCallEnded = false;
          let jitsiData = (message.raw as any)?.['org.eclo.jitsi'];
          const bodyIncludesUrl = message.body?.includes('jitsi.5hpc.com/');
          if (!jitsiData && bodyIncludesUrl) {
            const match = message.body?.match(/jitsi\.5hpc\.com\/([a-zA-Z0-9_-]+)/);
            if (match) {
              jitsiData = {
                conferenceId: match[1],
                domain: 'jitsi.5hpc.com',
                type: message.body?.includes('video') ? 'video' : 'audio'
              };
            }
          }
          
          const isEndCallMessage = Boolean((message.raw as any)?.['org.eclo.jitsi_end']) || message.body?.includes('đã kết thúc');
          const isJitsiCall = Boolean(jitsiData) || message.body?.includes('Cuộc gọi video nhóm') || message.body?.includes('Cuộc gọi thoại nhóm');
          
          let callDurationText = '';
          if (isJitsiCall) {
            const confId = jitsiData?.roomName || jitsiData?.conferenceId;
            if (isEndCallMessage) {
              isJitsiCallEnded = true;
              const startMsg = timelineData.find(m => m.kind === 'message' && 
                m.message.timestamp < message.timestamp && 
                ((m.message.raw as any)?.['org.eclo.jitsi']?.conferenceId === confId || (confId && m.message.body?.includes(`jitsi.5hpc.com/${confId}`))));
              if (startMsg && startMsg.kind === 'message') {
                const diffMs = message.timestamp - startMsg.message.timestamp;
                const minutes = Math.floor(diffMs / 60000);
                const seconds = Math.floor((diffMs % 60000) / 1000);
                callDurationText = minutes > 0 ? `${minutes} phút ${seconds} giây` : `${seconds} giây`;
              }
            } else {
              const endMsg = timelineData.find(m => m.kind === 'message' && (
                (confId && (m.message.raw as any)?.['org.eclo.jitsi_end']?.conferenceId === confId) ||
                (m.message.type === 'm.call.hangup' && m.message.timestamp > message.timestamp) ||
                (m.message.timestamp > message.timestamp && m.message.body?.includes('đã kết thúc') && (m.message.body?.includes('Cuộc gọi thoại nhóm') || m.message.body?.includes('Cuộc gọi video nhóm') || m.message.body?.includes('Cuộc gọi đã kết thúc')))
              ));
              if (endMsg && endMsg.kind === 'message') {
                isJitsiCallEnded = true;
                const diffMs = endMsg.message.timestamp - message.timestamp;
                const minutes = Math.floor(diffMs / 60000);
                const seconds = Math.floor((diffMs % 60000) / 1000);
                callDurationText = minutes > 0 ? `${minutes} phút ${seconds} giây` : `${seconds} giây`;
              }
            }
          }
          
          if (isEndCallMessage) {
            return null;
          }
          
          const mediaOnly = isFramelessMedia(message) || mediaGroup.length > 1 || isJitsiCall;
          return (
            <View
              style={[
                styles.messageRow,
                isMine ? styles.messageRowMine : styles.messageRowOther,
                groupedWithPrevious ? styles.messageRowGrouped : null,
              ]}>
              {!isMine ? (
                <View style={styles.avatarSlot}>
                  {showAvatar ? (
                    <MatrixAvatar
                      label={message.senderName || message.sender}
                      uri={message.senderAvatarUrl}
                      size={30}
                      backgroundColor={colors.primary}
                    />
                  ) : null}
                </View>
              ) : null}
              <View style={[styles.messageStack, mediaOnly ? styles.mediaMessageStack : null]}>
                {showSender ? <Text style={[styles.senderOutside, themedText(colors, 12, 16), {color: colors.tertiaryText}]}>{message.senderName || message.sender}</Text> : null}
                <Pressable
                  delayLongPress={260}
                  onLongPress={() => openMessageActions(message, isJitsiCallEnded, callDurationText)}
                  onPress={() => {
                    let jitsiDataPress = (message.raw as any)?.['org.eclo.jitsi'];
                    const bodyIncludesUrl = message.body?.includes('jitsi.5hpc.com/');
                    if (!jitsiDataPress && bodyIncludesUrl) {
                      const match = message.body?.match(/jitsi\.5hpc\.com\/([a-zA-Z0-9_-]+)/);
                      if (match) {
                        jitsiDataPress = { conferenceId: match[1], domain: 'jitsi.5hpc.com', type: message.body?.includes('video') ? 'video' : 'audio' };
                      }
                    }
                    if (jitsiDataPress && !isJitsiCallEnded) {
                      joinJitsiCall({ raw: { data: { conferenceId: jitsiDataPress.roomName || jitsiDataPress.conferenceId, domain: jitsiDataPress.domain, type: jitsiDataPress.type } } });
                    }
                  }}
                  style={[
                    styles.bubble,
                    mediaOnly ? styles.mediaOnlyBubble : null,
                    highlighted ? [styles.bubbleHighlighted, {borderColor: colors.primary}] : null,
                    mediaOnly
                      ? null
                      : isMine
                      ? [
                          {backgroundColor: colors.bubbleMine},
                          groupedWithPrevious ? styles.bubbleMineGroupedTop : null,
                          groupedWithNext ? styles.bubbleMineGroupedBottom : null,
                        ]
                      : [
                          {backgroundColor: colors.bubbleOther},
                          groupedWithPrevious ? styles.bubbleOtherGroupedTop : null,
                          groupedWithNext ? styles.bubbleOtherGroupedBottom : null,
                        ],
                  ]}>
                  {message.replyTo ? <ReplyPreview colors={colors} isMine={isMine} reply={replyMessage} onPress={() => jumpToMessage(message.replyTo as string)} /> : null}
                  {pinnedIds.has(message.id) ? <Text style={[styles.pinnedLabel, {color: isMine ? '#dbeafe' : colors.primary}]}>Đã ghim</Text> : null}
                  <MessageContentView
                    message={message}
                    mediaGroup={mediaGroup.length > 1 ? mediaGroup : undefined}
                    isMine={isMine}
                    colors={colors}
                    onOpenMedia={openMediaViewer}
                    onDownloadFile={downloadAttachment}
                    onVote={votePoll}
                    isJitsiCallEnded={isJitsiCallEnded}
                    callDurationText={callDurationText}
                  />
                  {showTimestamp ? (
                    <Text style={[
                      styles.timestamp,
                      mediaOnly ? styles.mediaTimestamp : null,
                      themedText(colors, 10),
                      {color: mediaOnly ? '#fff' : isMine ? 'rgba(255,255,255,0.66)' : colors.tertiaryText},
                    ]}>
                      {new Date(message.timestamp).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
                    </Text>
                  ) : null}
                </Pressable>
                {message.reactions?.length ? (
                  <ReactionSummaryRow
                    colors={colors}
                    isMine={isMine}
                    reactions={message.reactions}
                    onPress={() => showReactionDetails(message)}
                  />
                ) : null}
              </View>
            </View>
          );
        }}
      />
      <MessageActionOverlay
        colors={colors}
        message={focusedMessage}
        isJitsiCallEnded={focusedJitsiEnded}
        callDurationText={focusedJitsiDuration}
        ownUserId={ownUserId}
        pinned={focusedMessage ? pinnedIds.has(focusedMessage.id) : false}
        onClose={() => setFocusedMessage(null)}
        onReact={key => {
          const message = focusedMessage;
          if (message) {
            reactToMessage(message, key);
          }
        }}
        onReply={() => {
          if (focusedMessage) {
            setReplyTo(focusedMessage);
          }
          setFocusedMessage(null);
        }}
        onForward={() => {
          if (focusedMessage && activeRoomId) {
            navigation.navigate('ForwardMessage', {sourceRoomId: activeRoomId, eventId: focusedMessage.id});
          }
          setFocusedMessage(null);
        }}
        onPin={() => {
          const message = focusedMessage;
          setFocusedMessage(null);
          if (message) {
            togglePinnedMessage(message);
          }
        }}
        onRedact={() => {
          const message = focusedMessage;
          setFocusedMessage(null);
          if (message) {
            redactMessage(message);
          }
        }}
      />
      {currentDateLabel ? (
        <View pointerEvents="none" style={styles.floatingDate}>
          <GlassSurface effect="clear" style={[styles.datePillSurface, {shadowColor: colors.shadow}]}>
            <Text style={[styles.datePillText, {color: colors.secondaryText}]}>{currentDateLabel}</Text>
          </GlassSurface>
        </View>
      ) : null}
      {loadingOlder ? (
        <View pointerEvents="none" style={[styles.historySpinner, {top: insets.top + 52}]}>
          <GlassSurface effect="regular" style={styles.historySpinnerSurface}>
            <ActivityIndicator color={colors.primary} />
          </GlassSurface>
        </View>
      ) : null}

      <Animated.View
        pointerEvents="box-none"
        onLayout={event => setBottomPanelHeight(event.nativeEvent.layout.height)}
        style={[styles.bottomPanel, {paddingBottom: composerBottomInset, transform: [{translateY: composerLift}]}]}>
        {mediaSendProgress ? (
          <View style={[styles.sendProgress, {backgroundColor: colors.surface, borderColor: colors.separator}]}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.sendProgressText, {color: colors.secondaryText}]}>{mediaSendProgress}</Text>
          </View>
        ) : null}
        {error ? <Text style={[styles.error, {backgroundColor: colors.dangerSoft, color: colors.danger}]}>{error}</Text> : null}
        {replyTo ? (
          <View style={[styles.replyBox, {backgroundColor: colors.surface, borderColor: colors.separator}]}>
            <Text numberOfLines={1} style={[styles.replyBoxText, {color: colors.secondaryText}]}>Trả lời: {replyTo.body || replyTo.id}</Text>
            <Pressable accessibilityRole="button" onPress={() => setReplyTo(null)} hitSlop={8}>
              <Text style={[styles.cancelText, {color: colors.primary}]}>Hủy</Text>
            </Pressable>
          </View>
        ) : null}
        {attachMenuMounted && Platform.OS !== 'ios' ? (
          <Animated.View
            pointerEvents={showAttachMenu ? 'auto' : 'none'}
            style={[
              styles.attachMenuWrap,
              {
                opacity: attachMenuAnim,
                transform: [{translateY: attachMenuTranslateY}, {scale: attachMenuScale}],
              },
            ]}>
            <GlassSurface
              effect="regular"
              tintColor={menuGlassTint}
              fallbackColor={colors.dark ? 'rgba(24, 30, 44, 0.94)' : 'rgba(255, 255, 255, 0.96)'}
              style={[
                styles.attachMenu,
                {shadowColor: colors.shadow},
              ]}>
              <AttachMenuItem icon="file" label="File" onPress={() => void chooseFiles()} disabled={!canSend || Boolean(mediaSendProgress)} colors={colors} iconSurface={iconSurface} />
              <AttachMenuItem icon="photo" label="Ảnh & video" onPress={() => void choosePhotosAndVideos()} disabled={!canSend || Boolean(mediaSendProgress)} colors={colors} iconSurface={iconSurface} />
              <AttachMenuItem icon="poll" label="Bình chọn" onPress={() => void openPollComposer()} disabled={!canSend} colors={colors} iconSurface={iconSurface} />
              <AttachMenuItem icon="format" label="Định dạng" onPress={toggleFormatToolbar} colors={colors} iconSurface={iconSurface} />
            </GlassSurface>
          </Animated.View>
        ) : null}
        {showExpressionMenu ? (
          <GlassSurface
            effect="regular"
            tintColor={menuGlassTint}
            fallbackColor={colors.surface}
            style={[styles.expressionMenu, {shadowColor: colors.shadow}]}>
            <KlipyPicker
              onEmoji={emoji => setBody(current => current + emoji)}
              onSelect={(item, type) => void sendKlipyItem(item, type)}
            />
          </GlassSurface>
        ) : null}
        {showFormatToolbar && !recording ? (
          <FormatToolbar colors={colors} value={formatState} onChange={setFormatState} />
        ) : null}
        {recording ? (
          <GlassSurface effect="regular" tintColor={glassTint} style={[styles.voiceComposer, {shadowColor: colors.shadow}]}> 
            <Pressable accessibilityRole="button" accessibilityLabel="Hủy ghi âm" onPress={() => void finishVoiceNote(false)} style={({pressed}) => [styles.voiceCancelButton, pressed ? styles.pressed : null]}>
              <Trash2 size={20} color={colors.danger} strokeWidth={2.4} />
            </Pressable>
            <View style={styles.voiceStatus}>
              <Animated.View style={[styles.recordingDot, {transform: [{scale: recordingPulse.interpolate({inputRange: [0, 1], outputRange: [0.8, 1.3]})}], opacity: recordingPulse.interpolate({inputRange: [0, 1], outputRange: [0.55, 1]})}]} />
              <View style={styles.waveform}>
                {[0.62, 1, 0.78, 0.48, 0.9, 0.58, 0.82, 0.44, 0.72].map((height, index) => (
                  <Animated.View
                    key={`wave-${index}`}
                    style={[
                      styles.waveBar,
                      {backgroundColor: colors.primary, height: 8 + height * 18, transform: [{scaleY: recordingPulse.interpolate({inputRange: [0, 1], outputRange: [index % 2 ? 0.7 : 1, index % 2 ? 1 : 0.72]})}]},
                    ]}
                  />
                ))}
              </View>
              <Text style={[styles.voiceDuration, {color: colors.text}]}>{formatRecordingDuration(recordingMs)}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Gửi ghi âm" onPress={() => void finishVoiceNote(true)} style={({pressed}) => [styles.voiceSendButton, {backgroundColor: colors.primary}, pressed ? styles.pressed : null]}>
              <ArrowUp size={22} color="#fff" strokeWidth={3} />
            </Pressable>
          </GlassSurface>
        ) : (
        <View style={styles.composerRow}>
          <ComposerGlassButton
            accessibilityLabel="Mở tiện ích"
            active={showAttachMenu && Platform.OS !== 'ios'}
            onPress={openAttachActions}
            disabled={!canSend || recording || Boolean(mediaSendProgress)}
            colors={colors}>
            <Text style={[styles.plusButtonText, {color: showAttachMenu && Platform.OS !== 'ios' ? '#fff' : colors.text}]}>{showAttachMenu && Platform.OS !== 'ios' ? '×' : '+'}</Text>
          </ComposerGlassButton>
          <GlassSurface
            effect="regular"
            tintColor={glassTint}
            style={[
              styles.composerDock,
              {shadowColor: colors.shadow},
            ]}>
            <TextInput
              editable={canSend && !recording && !mediaSendProgress}
              multiline
              placeholder={canSend ? 'Tin nhắn' : 'Cuộc trò chuyện chưa sẵn sàng'}
              placeholderTextColor={colors.tertiaryText}
              style={[
                styles.input,
                themedText(colors, 16, 21),
                composerFormatStyle(colors.text, formatState),
              ]}
              selectionColor={formatState.color ?? colors.primary}
              value={body}
              onFocus={() => {
                setShowAttachMenu(false);
                setShowExpressionMenu(false);
                shouldStickToBottom.current = true;
                setTimeout(() => scrollToLatest(false), 40);
                setTimeout(() => scrollToLatest(false), 140);
              }}
              onChangeText={text => {
                setBody(text);
                if (text.trim()) {
                  setShowAttachMenu(false);
                }
              }}
            />
            <ComposerIconButton
              accessibilityLabel="Emoji, sticker, GIF"
              active={showExpressionMenu}
              onPress={() => {
                setShowAttachMenu(false);
                setShowExpressionMenu(current => !current);
              }}
              disabled={!canSend || recording || Boolean(mediaSendProgress)}
              colors={colors}>
              <Smile size={24} color={showExpressionMenu ? '#fff' : colors.text} strokeWidth={2.4} />
            </ComposerIconButton>
            <ComposerIconButton
              accessibilityLabel={hasText ? 'Gửi tin nhắn' : 'Ghi âm'}
              active={hasText || recording}
              onPress={handlePrimaryAction}
              disabled={!canSend || Boolean(mediaSendProgress)}
              colors={colors}>
              {hasText ? <ArrowUp size={24} color="#fff" strokeWidth={3} /> : <Mic size={24} color={recording ? '#fff' : colors.text} strokeWidth={2.4} />}
            </ComposerIconButton>
          </GlassSurface>
        </View>
        )}


      </Animated.View>

      {/* Jitsi Modal */}
      <JitsiCallModal
        visible={showJitsiModal}
        roomName={jitsiRoomId}
        token={jitsiToken}
        audioOnly={jitsiAudioOnly}
        onClose={() => setShowJitsiModal(false)}
        onMinimizeToggle={setIsJitsiMinimized}
        serverURL={'https://jitsi.5hpc.com'}
        displayName={jitsiDisplayName}
        avatarUrl={jitsiAvatarUrl}
        onEndCall={async () => {
          try {
            const auth = (nativeMatrixService as any).currentAccessToken;
            const baseUrl = (nativeMatrixService as any).currentBaseUrl;
            if (auth && baseUrl) {
              await fetch(`${baseUrl.replace(/\/$/, '')}/_matrix/client/v3/rooms/${encodeURIComponent(activeRoomId)}/state/im.vector.modular.widgets/jitsi`, {
                method: 'PUT',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${auth}`
                },
                body: JSON.stringify({})
              });
            }
            await (nativeMatrixService as any).requireRoom(activeRoomId).sendRaw('m.call.hangup', JSON.stringify({
              call_id: jitsiRoomId,
              reason: 'user_hangup',
              "org.eclo.jitsi_end": { conferenceId: jitsiRoomId, ts: Date.now() }
            }));
          } catch (e) {
            console.error('Failed to end jitsi call', e);
          }
        }}
      />
    </View>
  );
}

function FormatToolbar({colors, onChange, value}: {colors: ReturnType<typeof useAppTheme>; onChange: (value: FormatState) => void; value: FormatState}) {
  return (
    <GlassSurface effect="regular" fallbackColor={colors.surface} style={styles.formatToolbar}>
      <Pressable accessibilityRole="button" accessibilityState={{selected: value.bold}} onPress={() => onChange({...value, bold: !value.bold})} style={[styles.formatButton, value.bold ? {backgroundColor: colors.primary} : {backgroundColor: colors.input}]}>
        <Text style={[styles.formatButtonText, {color: value.bold ? '#fff' : colors.text, fontWeight: '900'}]}>B</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityState={{selected: value.italic}} onPress={() => onChange({...value, italic: !value.italic})} style={[styles.formatButton, value.italic ? {backgroundColor: colors.primary} : {backgroundColor: colors.input}]}>
        <Text style={[styles.formatButtonText, {color: value.italic ? '#fff' : colors.text, fontStyle: 'italic'}]}>I</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityState={{selected: value.underline}} onPress={() => onChange({...value, underline: !value.underline})} style={[styles.formatButton, value.underline ? {backgroundColor: colors.primary} : {backgroundColor: colors.input}]}>
        <Text style={[styles.formatButtonText, {color: value.underline ? '#fff' : colors.text, textDecorationLine: 'underline'}]}>U</Text>
      </Pressable>
      <View style={[styles.formatDivider, {backgroundColor: colors.separator}]} />
      {FORMAT_COLORS.map(color => (
        <Pressable key={color} accessibilityRole="button" accessibilityLabel={`Màu chữ ${color}`} accessibilityState={{selected: value.color === color}} onPress={() => onChange({...value, color: value.color === color ? undefined : color})} style={[styles.colorButton, {borderColor: value.color === color ? colors.primary : 'transparent'}]}>
          <View style={[styles.colorDot, {backgroundColor: color}]} />
        </Pressable>
      ))}
    </GlassSurface>
  );
}

function FormattedMessageText({colors, isMine, message}: {colors: ReturnType<typeof useAppTheme>; isMine: boolean; message: TimelineItem}) {
  const html = message.formattedBody ?? '';
  const colorMatch = html.match(/color\s*:\s*([^;"']+)/i)?.[1]?.trim();
  const allowedColor = colorMatch && /^#[0-9a-f]{3,8}$/i.test(colorMatch) ? colorMatch : undefined;
  const style: TextStyle = {
    color: allowedColor ?? (isMine ? '#fff' : colors.text),
    fontWeight: /<(strong|b)(\s|>)/i.test(html) ? '800' : '500',
    fontStyle: /<(em|i)(\s|>)/i.test(html) ? 'italic' : 'normal',
    textDecorationLine: /<u(\s|>)/i.test(html) ? 'underline' : 'none',
  };
  return <Text style={[styles.messageText, themedText(colors, 16, 22), style]}>{message.body || `[${message.type}]`}</Text>;
}

function MessageContentView({
  colors,
  isMine,
  mediaGroup,
  message,
  onDownloadFile,
  onOpenMedia,
  onVote,
  isJitsiCallEnded,
  callDurationText,
}: {
  colors: ReturnType<typeof useAppTheme>;
  isMine: boolean;
  mediaGroup?: TimelineItem[];
  message: TimelineItem;
  onDownloadFile?: (message: TimelineItem) => void;
  onOpenMedia?: (mediaId: string) => void;
  onVote?: (message: TimelineItem, answerId: string) => void;
  isJitsiCallEnded?: boolean;
  callDurationText?: string;
}) {
  const textColor = isMine ? '#fff' : colors.text;
  if (message.messageKind === 'sticker') {
    return (
      <View style={styles.stickerMessage}>
        {message.mediaUrl || message.mediaSourceJson ? (
          <MatrixMediaImage
            item={message}
            style={styles.stickerImage}
            resizeMode="contain"
            preserveAspectRatio
            backgroundColor="transparent"
            indicatorColor={isMine ? '#fff' : colors.primary}
            textColor={textColor}
            showLabel={false}
          />
        ) : (
          <View style={[styles.stickerImage, styles.stickerFallback, {backgroundColor: isMine ? 'rgba(255,255,255,0.10)' : colors.input}]}>
            <Text style={[styles.mediaPlaceholderText, {color: textColor}]}>Sticker</Text>
          </View>
        )}
      </View>
    );
  }
  if (message.mediaItems?.length) {
    return <MediaGroupView colors={colors} isMine={isMine} messages={message.mediaItems} onOpenMedia={onOpenMedia} />;
  }
  if (mediaGroup?.length) {
    return <MediaGroupView colors={colors} isMine={isMine} messages={mediaGroup.map(item => mediaItemFromTimelineItem(item))} onOpenMedia={onOpenMedia} />;
  }
  if (message.messageKind === 'image') {
    return (
      <View style={styles.mediaMessage}>
        {message.mediaUrl ? (
          <Pressable accessibilityRole="imagebutton" onPress={() => onOpenMedia?.(message.id)} style={({pressed}) => [pressed ? styles.pressed : null]}>
            <SafeMediaImage colors={colors} isMine={isMine} item={message} style={styles.mediaImage} />
          </Pressable>
        ) : message.mediaSourceJson ? (
          <MediaPendingTile colors={colors} isMine={isMine} style={styles.mediaPlaceholder} />
        ) : (
          <View style={[styles.mediaPlaceholder, {backgroundColor: isMine ? 'rgba(255,255,255,0.16)' : colors.input}]}>
            <Text style={[styles.mediaPlaceholderText, {color: textColor}]}>Hình ảnh</Text>
          </View>
        )}
      </View>
    );
  }
  if (message.messageKind === 'video') {
    return (
      <View style={styles.mediaMessage}>
        {message.mediaUrl ? (
          <SafeMediaVideo colors={colors} isMine={isMine} item={message} style={styles.mediaImage} onExpand={() => onOpenMedia?.(message.id)} />
        ) : message.mediaSourceJson ? (
          <MediaPendingTile colors={colors} isMine={isMine} style={styles.mediaPlaceholder} />
        ) : (
          <View style={[styles.mediaPlaceholder, {backgroundColor: isMine ? 'rgba(255,255,255,0.16)' : colors.input}]}>
            <Text style={[styles.mediaPlaceholderText, {color: textColor}]}>Video</Text>
          </View>
        )}
      </View>
    );
  }
  if (message.messageKind === 'audio') {
    if (message.mediaUrl) {
      return (
        <MatrixMediaAudio
          item={message}
          backgroundColor={isMine ? 'rgba(255,255,255,0.14)' : colors.input}
          buttonColor={isMine ? 'rgba(255,255,255,0.34)' : colors.primary}
          textColor={textColor}
        />
      );
    }
    return (
      <View style={styles.inlineFeatureRow}>
        <FeatureGlyph name="audio" color={textColor} compact />
        <Text style={[styles.messageText, themedText(colors, 16, 22), {color: textColor}]}>{message.body || 'Tin nhắn thoại'}</Text>
      </View>
    );
  }
  if (message.messageKind === 'file') {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={`Tải ${message.body || 'tệp đính kèm'}`} onPress={() => onDownloadFile?.(message)} style={({pressed}) => [styles.fileDownloadRow, {backgroundColor: isMine ? 'rgba(255,255,255,0.14)' : colors.input}, pressed ? styles.pressed : null]}>
        <View style={[styles.fileDownloadIcon, {backgroundColor: isMine ? 'rgba(255,255,255,0.18)' : colors.surface}]}>
          <FeatureGlyph name="file" color={textColor} compact />
        </View>
        <View style={styles.fileDownloadText}>
          <Text numberOfLines={2} style={[styles.fileName, {color: textColor}]}>{message.body || 'Tệp đính kèm'}</Text>
          <Text style={[styles.fileHint, {color: isMine ? 'rgba(255,255,255,0.72)' : colors.secondaryText}]}>Chạm để tải về</Text>
        </View>
      </Pressable>
    );
  }
  if (message.messageKind === 'poll' && message.poll) {
    return (
      <View style={styles.pollBox}>
        <Text style={[styles.messageText, themedText(colors, 16, 22), {color: textColor}]}>{message.poll.question}</Text>
        {message.poll.answers.slice(0, 8).map(answer => (
          <Pressable key={answer.id} accessibilityRole="button" accessibilityState={{selected: Boolean(answer.selected)}} onPress={() => onVote?.(message, answer.id)} style={({pressed}) => [styles.pollOption, {backgroundColor: answer.selected ? (isMine ? 'rgba(255,255,255,0.28)' : colors.input) : isMine ? 'rgba(255,255,255,0.14)' : colors.input, borderColor: answer.selected ? (isMine ? '#fff' : colors.primary) : 'transparent'}, pressed ? styles.pressed : null]}>
            <View style={[styles.pollRadio, {borderColor: answer.selected ? (isMine ? '#fff' : colors.primary) : isMine ? 'rgba(255,255,255,0.65)' : colors.tertiaryText}]}>
              {answer.selected ? <View style={[styles.pollRadioDot, {backgroundColor: isMine ? '#fff' : colors.primary}]} /> : null}
            </View>
            <Text numberOfLines={2} style={[styles.pollOptionText, {color: textColor}]}>{answer.text}</Text>
            <Text style={[styles.pollCount, {color: isMine ? 'rgba(255,255,255,0.78)' : colors.secondaryText}]}>{answer.count ?? 0}</Text>
          </Pressable>
        ))}
        <Text style={[styles.pollTotal, {color: isMine ? 'rgba(255,255,255,0.72)' : colors.secondaryText}]}>{message.poll.totalVotes ?? 0} lượt chọn</Text>
      </View>
    );
  }
  
  let jitsiData = (message.raw as any)?.['org.eclo.jitsi'];
  const bodyIncludesUrl = message.body?.includes('jitsi.5hpc.com/');
  if (!jitsiData && bodyIncludesUrl) {
    const match = message.body?.match(/jitsi\.5hpc\.com\/([a-zA-Z0-9_-]+)/);
    if (match) {
      jitsiData = { conferenceId: match[1], domain: 'jitsi.5hpc.com', type: message.body?.includes('video') ? 'video' : 'audio' };
    }
  }
  
  const isEndCallMessage = Boolean((message.raw as any)?.['org.eclo.jitsi_end']) || message.body?.includes('đã kết thúc');
  const isJitsiCall = Boolean(jitsiData) || message.body?.includes('Cuộc gọi video nhóm') || message.body?.includes('Cuộc gọi thoại nhóm');
  
  if (isJitsiCall) {
    const isVideo = jitsiData ? jitsiData.type !== 'audio' : message.body?.includes('video');
    return (
      <View style={{
        flexDirection: 'row', 
        alignItems: 'center', 
        backgroundColor: colors.surface, 
        padding: 12, 
        borderRadius: 24,
        marginVertical: 2,
        minWidth: 260
      }}>
        <View style={{
          width: 48, height: 48, borderRadius: 24, backgroundColor: isEndCallMessage ? '#fee2e2' : (isVideo ? '#dbeafe' : '#dcfce7'), 
          alignItems: 'center', justifyContent: 'center', marginRight: 12
        }}>
          {isEndCallMessage ? <PhoneOff size={24} color="#ef4444" /> : (isVideo ? <Video size={24} color="#2563eb" fill="#2563eb" /> : <Mic size={24} color="#16a34a" fill="#16a34a" />)}
        </View>
        <View style={{flex: 1}}>
          <Text style={{fontWeight: '600', fontSize: 16, color: colors.text}}>{isVideo ? 'Cuộc gọi video nhóm' : 'Cuộc gọi thoại nhóm'}</Text>
          <Text style={{fontSize: 14, color: colors.secondaryText, marginTop: 2}}>
            {(isJitsiCallEnded || isEndCallMessage) ? (callDurationText ? `Đã kết thúc • ${callDurationText}` : 'Đã kết thúc') : 'Đang diễn ra'}
          </Text>
        </View>
        {!(isJitsiCallEnded || isEndCallMessage) && (
          <View style={{
            backgroundColor: '#3b82f6',
            paddingHorizontal: 16,
            paddingVertical: 8,
            borderRadius: 20,
            marginLeft: 8
          }}>
            <Text style={{color: '#fff', fontWeight: '600', fontSize: 14}}>Tham gia</Text>
          </View>
        )}
      </View>
    );
  }

  return <FormattedMessageText colors={colors} isMine={isMine} message={message} />;
}

function MediaGroupView({colors, isMine, messages, onOpenMedia}: {colors: ReturnType<typeof useAppTheme>; isMine: boolean; messages: TimelineMediaItem[]; onOpenMedia?: (mediaId: string) => void}) {
  const visible = messages.slice(0, 4);
  return (
    <View style={styles.mediaGrid}>
      {visible.map((message, index) => (
        <Pressable key={message.id} accessibilityRole="imagebutton" onPress={() => onOpenMedia?.(message.id)} style={({pressed}) => [styles.mediaGridTile, pressed ? styles.pressed : null]}>
          {message.mediaUrl ? (
            message.kind === 'video' ? (
              <SafeMediaVideo compact colors={colors} isMine={isMine} item={message} style={styles.mediaGridImage} onExpand={() => onOpenMedia?.(message.id)} />
            ) : (
              <SafeMediaImage colors={colors} isMine={isMine} item={message} style={styles.mediaGridImage} />
            )
          ) : message.mediaSourceJson ? (
            <MediaPendingTile colors={colors} isMine={isMine} style={styles.mediaGridImage} />
          ) : (
            <View style={[styles.mediaPlaceholder, styles.mediaGridImage, {backgroundColor: isMine ? 'rgba(255,255,255,0.16)' : colors.input}]}>
              <Text style={[styles.mediaPlaceholderText, {color: isMine ? '#fff' : colors.text}]}>Ảnh</Text>
            </View>
          )}
          {index === 3 && messages.length > visible.length ? (
            <View style={styles.mediaMoreOverlay}>
              <Text style={styles.mediaMoreText}>+{messages.length - visible.length}</Text>
            </View>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

function ReplyPreview({colors, isMine, onPress, reply}: {colors: ReturnType<typeof useAppTheme>; isMine: boolean; onPress: () => void; reply?: TimelineItem}) {
  const preview = reply
    ? `${reply.senderName || compactUserId(reply.sender)}: ${reply.body || reply.type}`
    : 'Tin nhắn được trả lời';
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.replyPreview, {borderLeftColor: isMine ? 'rgba(255,255,255,0.62)' : colors.primary, backgroundColor: isMine ? 'rgba(255,255,255,0.13)' : colors.input}]}>
      <Text style={[styles.replyTitle, {color: isMine ? '#fff' : colors.primary}]}>Trả lời</Text>
      <Text numberOfLines={1} style={[styles.replyBody, {color: isMine ? 'rgba(255,255,255,0.82)' : colors.secondaryText}]}>{preview}</Text>
    </Pressable>
  );
}

function SafeMediaImage({colors, isMine, item, style}: {colors: ReturnType<typeof useAppTheme>; isMine: boolean; item: TimelineItem | TimelineMediaItem; style: object}) {
  return (
    <MatrixMediaImage
      item={item}
      style={style}
      backgroundColor={isMine ? 'rgba(255,255,255,0.16)' : colors.input}
      indicatorColor={isMine ? '#fff' : colors.primary}
      textColor={isMine ? '#fff' : colors.text}
    />
  );
}

function SafeMediaVideo({colors, compact, isMine, item, onExpand, style}: {colors: ReturnType<typeof useAppTheme>; compact?: boolean; isMine: boolean; item: TimelineItem | TimelineMediaItem; onExpand?: () => void; style: object}) {
  return (
    <MatrixMediaVideo
      item={item}
      style={style}
      compact={compact}
      onExpand={onExpand}
      backgroundColor={isMine ? 'rgba(255,255,255,0.16)' : colors.input}
      indicatorColor={isMine ? '#fff' : colors.primary}
      textColor={isMine ? '#fff' : colors.text}
    />
  );
}

function MediaPendingTile({colors, isMine, style}: {colors: ReturnType<typeof useAppTheme>; isMine: boolean; style: object}) {
  return (
    <View style={[styles.mediaPlaceholder, style, {backgroundColor: isMine ? 'rgba(255,255,255,0.16)' : colors.input}]}>
      <ActivityIndicator color={isMine ? '#fff' : colors.primary} />
    </View>
  );
}

function MessageActionOverlay({
  colors,
  message,
  isJitsiCallEnded,
  callDurationText,
  onClose,
  onForward,
  onPin,
  onReact,
  onRedact,
  onReply,
  ownUserId,
  pinned,
}: {
  colors: ReturnType<typeof useAppTheme>;
  message: TimelineItem | null;
  isJitsiCallEnded?: boolean;
  callDurationText?: string;
  onClose: () => void;
  onForward: () => void;
  onPin: () => void;
  onReact: (key: string) => void;
  onRedact: () => void;
  onReply: () => void;
  ownUserId: string;
  pinned: boolean;
}) {
  if (!message) {
    return null;
  }
  const isMine = message.sender === ownUserId;
  const reactions = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
  const overlayTint = colors.dark ? 'rgba(20, 25, 38, 0.90)' : 'rgba(255,255,255,0.90)';
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable style={styles.actionBackdrop} onPress={onClose}>
        <Pressable style={styles.actionStage} onPress={event => event.stopPropagation()}>
          <GlassSurface
            interactive
            effect="regular"
            tintColor={overlayTint}
            fallbackColor={colors.surface}
            style={[styles.reactionStrip, {shadowColor: colors.shadow}]}>
            {reactions.map(reaction => (
              <Pressable
                key={reaction}
                accessibilityRole="button"
                accessibilityLabel={`Reaction ${reaction}`}
                onPress={() => onReact(reaction)}
                style={({pressed}) => [styles.reactionButton, pressed ? styles.pressed : null]}>
                <Text style={styles.reactionText}>{reaction}</Text>
              </Pressable>
            ))}
          </GlassSurface>

          <View
            style={[
              styles.actionBubblePreview,
              isMine ? {backgroundColor: colors.bubbleMine, alignSelf: 'flex-end'} : {backgroundColor: colors.bubbleOther, borderColor: colors.bubbleOtherBorder, borderWidth: 1, alignSelf: 'flex-start'},
            ]}>
            <MessageContentView message={message} isMine={isMine} colors={colors} isJitsiCallEnded={isJitsiCallEnded} callDurationText={callDurationText} />
            <Text style={[styles.timestamp, themedText(colors, 10), {color: isMine ? 'rgba(255,255,255,0.66)' : colors.tertiaryText}]}>
              {new Date(message.timestamp).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
            </Text>
          </View>

          <GlassSurface
            interactive
            effect="regular"
            tintColor={overlayTint}
            fallbackColor={colors.surface}
            style={[styles.messageMenu, {shadowColor: colors.shadow}]}>
            <MessageMenuRow colors={colors} label="Trả lời" symbol="reply" onPress={onReply} />
            <MessageMenuRow colors={colors} label={pinned ? 'Bỏ ghim' : 'Ghim tin nhắn'} symbol="pin" onPress={onPin} />
            <MessageMenuRow colors={colors} label="Chuyển tiếp" symbol="forward" onPress={onForward} />
            <MessageMenuRow colors={colors} destructive label="Thu hồi tin nhắn" symbol="trash" onPress={onRedact} />
          </GlassSurface>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function MessageMenuRow({
  colors,
  destructive,
  label,
  onPress,
  symbol,
}: {
  colors: ReturnType<typeof useAppTheme>;
  destructive?: boolean;
  label: string;
  onPress: () => void;
  symbol: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({pressed}) => [styles.messageMenuRow, pressed ? {backgroundColor: colors.input} : null]}>
      <MenuGlyph name={symbol} color={destructive ? colors.danger : colors.primary} />
      <Text style={[styles.messageMenuLabel, {color: destructive ? colors.danger : colors.text}]}>{label}</Text>
    </Pressable>
  );
}

function MenuGlyph({color, name}: {color: string; name: string}) {
  const props = {size: 22, color, strokeWidth: 2.4};
  if (name === 'reply') {
    return <Reply {...props} />;
  }
  if (name === 'pin') {
    return <Pin {...props} />;
  }
  if (name === 'forward') {
    return <Forward {...props} />;
  }
  return <Trash2 {...props} />;
}

function ReactionSummaryRow({
  colors,
  isMine,
  onPress,
  reactions,
}: {
  colors: ReturnType<typeof useAppTheme>;
  isMine: boolean;
  onPress: () => void;
  reactions: TimelineReaction[];
}) {
  const grouped = groupReactions(reactions);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({pressed}) => [
        styles.reactionSummary,
        isMine ? styles.reactionSummaryMine : styles.reactionSummaryOther,
        {backgroundColor: colors.dark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.92)', shadowColor: colors.shadow},
        pressed ? styles.pressed : null,
      ]}>
      {grouped.slice(0, 4).map(reaction => (
        <Text key={reaction.key} style={styles.reactionSummaryText}>
          {reaction.key}
        </Text>
      ))}
      {grouped.length > 4 ? <Text style={styles.reactionSummaryText}>+{grouped.length - 4}</Text> : null}
    </Pressable>
  );
}

function nearestMessage(items: TimelineListItem[], index: number, direction: -1 | 1): TimelineItem | null {
  for (let cursor = index + direction; cursor >= 0 && cursor < items.length; cursor += direction) {
    const item = items[cursor];
    if (!item || item.kind === 'date') {
      return null;
    }
    return item.message;
  }
  return null;
}

function attachReactionSummaries(items: TimelineItem[]): TimelineItem[] {
  const reactionMap = new Map<string, Map<string, string[]>>();
  const messages: TimelineItem[] = [];

  for (const item of items) {
    if (item.messageKind === 'reaction' && item.reactionTargetId && item.reactionKey) {
      const byKey = reactionMap.get(item.reactionTargetId) ?? new Map<string, string[]>();
      const key = normalizeReactionKey(item.reactionKey);
      const senders = byKey.get(key) ?? [];
      senders.push(item.sender);
      byKey.set(key, senders);
      reactionMap.set(item.reactionTargetId, byKey);
      continue;
    }
    messages.push(item);
  }

  return messages.map(message => {
    const byKey = reactionMap.get(message.id);
    const eventReactions = byKey
      ? [...byKey.entries()].map(([key, senders]) => ({
        key,
        count: senders.length,
        senders,
      }))
      : [];
    const reactions = groupReactions([...(message.reactions ?? []), ...eventReactions]);
    return reactions.length ? {...message, reactions} : {...message, reactions: undefined};
  });
}

function groupReactions(reactions: TimelineReaction[]): TimelineReaction[] {
  const byKey = new Map<string, string[]>();
  for (const reaction of reactions) {
    const key = normalizeReactionKey(reaction.key);
    if (!key) {
      continue;
    }
    const senders = byKey.get(key) ?? [];
    if (reaction.senders.length) {
      senders.push(...reaction.senders);
    } else {
      for (let index = 0; index < reaction.count; index += 1) {
        senders.push('');
      }
    }
    byKey.set(key, senders);
  }
  return [...byKey.entries()].map(([key, senders]) => ({key, count: senders.length, senders}));
}

function normalizeReactionKey(key: string): string {
  const clean = key.trim();
  const known = ['👍', '❤️', '❤', '😂', '😮', '😢', '🙏'].find(reaction => clean.startsWith(reaction));
  return known ?? clean.replace(/\d+$/u, '');
}

function compactUserId(userId: string): string {
  return userId.replace(/^@/, '').split(':')[0] || userId;
}

function reactionSendersLabel(senders: string[]): string {
  const counts = new Map<string, number>();
  for (const sender of senders) {
    const name = compactUserId(sender);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => count > 1 ? `${name} x${count}` : name).join(', ');
}

function canGroupMessages(first: TimelineItem, second: TimelineItem): boolean {
  if (first.messageKind === 'sticker' || second.messageKind === 'sticker') {
    return false;
  }
  return first.sender === second.sender
    && dayKey(first.timestamp) === dayKey(second.timestamp)
    && Math.abs(second.timestamp - first.timestamp) < 5 * 60 * 1000;
}

function isMediaMessage(message: TimelineItem): boolean {
  return message.messageKind === 'image' || message.messageKind === 'video';
}

function mediaItemFromTimelineItem(message: TimelineItem): TimelineMediaItem {
  return {
    id: message.id,
    kind: message.messageKind === 'video' ? 'video' : 'image',
    mediaUrl: message.mediaUrl,
    mediaHeaders: message.mediaHeaders,
    mediaSourceJson: message.mediaSourceJson,
    mediaFileName: message.mediaFileName,
    mediaMimeType: message.mediaMimeType,
  };
}

function canGroupMedia(first: TimelineItem, second: TimelineItem): boolean {
  if (!isMediaMessage(first) || !isMediaMessage(second) || first.sender !== second.sender || dayKey(first.timestamp) !== dayKey(second.timestamp)) {
    return false;
  }
  if (first.mediaBatchId && second.mediaBatchId) {
    return first.mediaBatchId === second.mediaBatchId;
  }
  return Math.abs(second.timestamp - first.timestamp) < 2 * 60 * 1000;
}

function isMediaGroupContinuation(items: TimelineListItem[], index: number): boolean {
  const item = items[index];
  const previous = nearestMessage(items, index, -1);
  return item?.kind === 'message' && previous ? canGroupMedia(previous, item.message) : false;
}

function mediaGroupFromTimeline(items: TimelineListItem[], index: number): TimelineItem[] {
  const item = items[index];
  if (item?.kind !== 'message' || !isMediaMessage(item.message)) {
    return [];
  }
  const group = [item.message];
  for (let cursor = index + 1; cursor < items.length; cursor += 1) {
    const next = items[cursor];
    if (!next || next.kind === 'date' || !canGroupMedia(group[group.length - 1] as TimelineItem, next.message)) {
      break;
    }
    group.push(next.message);
  }
  return group;
}

function mediaUploadFromAsset(asset: Asset): NativeMediaUpload | undefined {
  if (!asset.uri) {
    return undefined;
  }
  const mimeType = asset.type?.toLowerCase();
  const kind = mimeType?.startsWith('video/') || asset.duration != null ? 'video' : 'image';
  return {
    uri: asset.uri,
    kind,
    fileName: asset.fileName ?? `${kind}-${Date.now()}.${kind === 'video' ? 'mp4' : 'jpg'}`,
    mimeType: asset.type,
    fileSize: asset.fileSize,
    width: asset.width,
    height: asset.height,
    durationMs: typeof asset.duration === 'number' ? Math.max(1, Math.round(asset.duration * 1000)) : undefined,
  };
}

function mediaUploadFromDocument(document: DocumentPickerResponse): NativeMediaUpload {
  const mimeType = document.type?.toLowerCase() ?? '';
  const name = document.name ?? `file-${Date.now()}`;
  const kind: NativeMediaUpload['kind'] = mimeType.startsWith('image/')
    ? 'image'
    : mimeType.startsWith('video/')
      ? 'video'
      : mimeType.startsWith('audio/')
        ? 'audio'
        : 'file';
  return {
    uri: document.uri,
    kind,
    fileName: name,
    mimeType: document.type ?? undefined,
    fileSize: document.size ?? undefined,
  };
}

function localPathFromUri(uri: string): string {
  if (!uri.startsWith('file://')) {
    return uri;
  }
  try {
    return decodeURIComponent(uri.slice('file://'.length));
  } catch {
    return uri.slice('file://'.length);
  }
}

function formatRecordingDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function AttachMenuItem({
  colors,
  disabled,
  icon,
  iconSurface,
  label,
  onPress,
}: {
  colors: ReturnType<typeof useAppTheme>;
  disabled?: boolean;
  icon: FeatureGlyphName;
  iconSurface: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.attachRow,
        disabled ? styles.disabled : null,
        pressed && !disabled ? {backgroundColor: colors.input} : null,
      ]}>
      <View style={[styles.attachIconSurface, {backgroundColor: iconSurface}]}>
        <FeatureGlyph name={icon} color={colors.primary} />
      </View>
      <Text style={[styles.attachLabel, themedText(colors, 15, 20), {color: colors.text}]}>{label}</Text>
    </Pressable>
  );
}

function ComposerIconButton({
  accessibilityLabel,
  active,
  children,
  colors,
  disabled,
  onPress,
}: {
  accessibilityLabel: string;
  active?: boolean;
  children: React.ReactNode;
  colors: ReturnType<typeof useAppTheme>;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.composerIconButton,
        active ? {backgroundColor: colors.primary} : null,
        disabled ? styles.disabled : null,
        pressed && !disabled ? styles.pressed : null,
      ]}>
      {children}
    </Pressable>
  );
}

function ComposerGlassButton({
  accessibilityLabel,
  active,
  children,
  colors,
  disabled,
  onPress,
}: {
  accessibilityLabel: string;
  active?: boolean;
  children: React.ReactNode;
  colors: ReturnType<typeof useAppTheme>;
  disabled?: boolean;
  onPress: () => void;
}) {
  const tintColor = active
    ? colors.primary
    : colors.dark
      ? 'rgba(32, 40, 58, 0.58)'
      : 'rgba(255, 255, 255, 0.58)';
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.composerGlassButtonPressable,
        disabled ? styles.disabled : null,
        pressed && !disabled ? styles.pressed : null,
      ]}>
      <GlassSurface
        interactive
        effect="regular"
        tintColor={tintColor}
        fallbackColor={active ? colors.primary : colors.input}
        style={[styles.composerGlassButton, {shadowColor: colors.shadow}]}>
        {children}
      </GlassSurface>
    </Pressable>
  );
}

type FeatureGlyphName = 'audio' | 'file' | 'format' | 'photo' | 'poll' | 'video';

function FeatureGlyph({color, compact, name}: {color: string; compact?: boolean; name: FeatureGlyphName}) {
  const size = compact ? 22 : 28;
  const props = {size, color, strokeWidth: compact ? 2.5 : 2.3};
  if (name === 'audio') {
    return <Mic {...props} />;
  }
  if (name === 'video') {
    return <Video {...props} />;
  }
  if (name === 'photo') {
    return <ImageIcon {...props} />;
  }
  if (name === 'poll') {
    return <BarChart3 {...props} />;
  }
  if (name === 'format') {
    return <Type {...props} />;
  }
  return compact ? <FileText {...props} /> : <File {...props} />;
}

const styles = StyleSheet.create({
  screen: {flex: 1},
  timeline: {paddingHorizontal: 12, paddingBottom: 18},
  timelineEmptyContainer: {flexGrow: 1, justifyContent: 'center'},
  timelineHeader: {paddingTop: 8, gap: 8, marginBottom: 6},
  warning: {borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, overflow: 'hidden', fontWeight: '700'},
  dateSeparator: {alignItems: 'center', paddingVertical: 8},
  floatingDate: {position: 'absolute', top: 8, left: 0, right: 0, alignItems: 'center', zIndex: 10},
  historySpinner: {position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 12},
  historySpinnerSurface: {width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center'},
  datePillSurface: {
    borderRadius: 14,
    paddingHorizontal: 11,
    paddingVertical: 5,
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  datePillText: {fontSize: 12, lineHeight: 15, fontWeight: '800'},
  systemRow: {alignItems: 'center', paddingVertical: 6, paddingHorizontal: 24},
  systemPill: {
    maxWidth: '88%',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
    shadowOffset: {width: 0, height: 6},
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  systemText: {fontSize: 12, lineHeight: 16, fontWeight: '800', textAlign: 'center'},
  messageRow: {marginVertical: 4, flexDirection: 'row', alignItems: 'flex-end'},
  messageRowGrouped: {marginTop: 1},
  messageRowMine: {justifyContent: 'flex-end'},
  messageRowOther: {justifyContent: 'flex-start'},
  avatarSlot: {width: 38, alignItems: 'center', justifyContent: 'flex-end', marginRight: 4},
  messageStack: {maxWidth: '78%', gap: 3},
  mediaMessageStack: {maxWidth: '84%'},
  bubble: {borderRadius: 20, paddingHorizontal: 13, paddingVertical: 9, alignSelf: 'flex-start'},
  mediaOnlyBubble: {paddingHorizontal: 0, paddingVertical: 0, backgroundColor: 'transparent', overflow: 'hidden'},
  bubbleHighlighted: {borderWidth: 2},
  bubbleMineGroupedTop: {borderTopRightRadius: 10},
  bubbleMineGroupedBottom: {borderBottomRightRadius: 10},
  bubbleOtherGroupedTop: {borderTopLeftRadius: 10},
  bubbleOtherGroupedBottom: {borderBottomLeftRadius: 10},
  sender: {fontSize: 11, fontWeight: '800', marginBottom: 3},
  senderOutside: {fontSize: 12, fontWeight: '800', marginLeft: 5, marginBottom: 1},
  reply: {fontSize: 12, fontWeight: '800', marginBottom: 4},
  replyPreview: {borderLeftWidth: 3, borderRadius: 11, paddingHorizontal: 9, paddingVertical: 7, marginBottom: 6, minWidth: 150},
  replyTitle: {fontSize: 11, lineHeight: 14, fontWeight: '900'},
  replyBody: {fontSize: 12, lineHeight: 16, fontWeight: '700', marginTop: 1},
  pinnedLabel: {fontSize: 11, lineHeight: 14, fontWeight: '900', marginBottom: 4},
  messageText: {fontSize: 16, lineHeight: 22, fontWeight: '500'},
  timestamp: {fontSize: 10, fontWeight: '700', marginTop: 4, alignSelf: 'flex-end'},
  mediaTimestamp: {position: 'absolute', right: 7, bottom: 6, marginTop: 0, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.52)', paddingHorizontal: 6, paddingVertical: 3, overflow: 'hidden'},
  likeButton: {
    position: 'absolute',
    bottom: -9,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  likeButtonMine: {left: -10},
  likeButtonOther: {right: -10},
  likeText: {fontSize: 15, lineHeight: 18, fontWeight: '900'},
  mediaMessage: {overflow: 'hidden'},
  mediaImage: {width: 252, height: 188, borderRadius: 18, overflow: 'hidden'},
  stickerMessage: {alignSelf: 'flex-start', overflow: 'visible'},
  stickerImage: {width: 252, aspectRatio: 1, borderRadius: 0},
  stickerFallback: {alignItems: 'center', justifyContent: 'center'},
  mediaGrid: {width: 252, minHeight: 124, flexDirection: 'row', flexWrap: 'wrap', gap: 4},
  mediaGridTile: {width: 124, height: 124, borderRadius: 16, overflow: 'hidden'},
  mediaGridImage: {width: '100%', height: '100%', borderRadius: 16, overflow: 'hidden'},
  mediaMoreOverlay: {position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)'},
  mediaMoreText: {color: '#fff', fontSize: 20, lineHeight: 24, fontWeight: '900'},
  mediaPlaceholder: {width: 252, height: 166, borderRadius: 18, alignItems: 'center', justifyContent: 'center'},
  mediaPlaceholderText: {fontSize: 14, fontWeight: '900'},
  inlineFeatureRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  fileDownloadRow: {minWidth: 210, maxWidth: 264, minHeight: 62, borderRadius: 16, padding: 8, flexDirection: 'row', alignItems: 'center', gap: 9},
  fileDownloadIcon: {width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center'},
  fileDownloadText: {flex: 1, gap: 2},
  fileName: {fontSize: 14, lineHeight: 18, fontWeight: '800'},
  fileHint: {fontSize: 11, lineHeight: 14, fontWeight: '700'},
  pollBox: {gap: 8, minWidth: 190},
  pollOption: {minHeight: 42, borderRadius: 13, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 7, gap: 8},
  pollRadio: {width: 18, height: 18, borderRadius: 9, borderWidth: 1.8, alignItems: 'center', justifyContent: 'center'},
  pollRadioDot: {width: 8, height: 8, borderRadius: 4},
  pollOptionText: {flex: 1, fontSize: 14, lineHeight: 18, fontWeight: '800'},
  pollCount: {fontSize: 12, lineHeight: 15, fontWeight: '900'},
  pollTotal: {fontSize: 11, lineHeight: 15, fontWeight: '700', textAlign: 'right'},
  bottomPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 10,
    paddingTop: 8,
    gap: 8,
  },
  attachMenuWrap: {
    width: 218,
    alignSelf: 'flex-start',
    marginLeft: 2,
    marginBottom: 2,
  },
  attachMenu: {
    borderRadius: 24,
    overflow: 'hidden',
    padding: 8,
    gap: 4,
    shadowOffset: {width: 0, height: 10},
    shadowOpacity: 0.14,
    shadowRadius: 26,
    elevation: 12,
  },
  attachRow: {height: 48, borderRadius: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 10, paddingHorizontal: 8},
  attachIconSurface: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachLabel: {fontSize: 15, lineHeight: 20, fontWeight: '800'},
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  composerGlassButtonPressable: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  composerGlassButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: {width: 0, height: 12},
    shadowOpacity: 0.16,
    shadowRadius: 24,
    elevation: 12,
  },
  composerDock: {
    flex: 1,
    minHeight: 56,
    maxHeight: 142,
    borderRadius: 30,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 7,
    paddingVertical: 7,
    gap: 8,
    shadowOffset: {width: 0, height: 12},
    shadowOpacity: 0.20,
    shadowRadius: 30,
    elevation: 14,
  },
  composerIconButton: {width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center'},
  plusButton: {width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center'},
  plusButtonText: {fontSize: 28, lineHeight: 31, fontWeight: '500'},
  input: {flex: 1, minHeight: 42, maxHeight: 118, paddingTop: 10, paddingBottom: 9, fontSize: 16, lineHeight: 21},
  formatToolbar: {minHeight: 50, borderRadius: 18, paddingHorizontal: 8, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 5, overflow: 'hidden'},
  formatButton: {width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center'},
  formatButtonText: {fontSize: 17, lineHeight: 21},
  formatDivider: {width: StyleSheet.hairlineWidth, height: 28, marginHorizontal: 2},
  colorButton: {width: 30, height: 34, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center'},
  colorDot: {width: 18, height: 18, borderRadius: 9},
  voiceComposer: {height: 58, borderRadius: 29, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 7, gap: 8, overflow: 'hidden', shadowOffset: {width: 0, height: 12}, shadowOpacity: 0.18, shadowRadius: 26, elevation: 12},
  voiceCancelButton: {width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center'},
  voiceStatus: {flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8},
  waveform: {flex: 1, height: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3},
  waveBar: {width: 3, borderRadius: 2},
  voiceDuration: {minWidth: 38, fontSize: 13, lineHeight: 17, fontWeight: '900', fontVariant: ['tabular-nums']},
  voiceSendButton: {width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center'},
  primaryButton: {width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center'},
  primaryButtonText: {fontSize: 19, lineHeight: 22, fontWeight: '900'},
  smileGlyph: {width: 24, height: 24, borderRadius: 12, borderWidth: 2},
  smileEye: {position: 'absolute', top: 7, width: 3, height: 3, borderRadius: 1.5},
  smileMouth: {position: 'absolute', left: 6, right: 6, bottom: 6, height: 6, borderBottomWidth: 2, borderRadius: 8},
  micGlyph: {width: 24, height: 25, alignItems: 'center'},
  micHead: {width: 12, height: 16, borderRadius: 7, borderWidth: 2},
  micStem: {width: 2, height: 6, borderRadius: 1, marginTop: -1},
  micBase: {width: 14, height: 2, borderRadius: 1, marginTop: 1},
  featureGlyphBox: {width: 28, height: 28, alignItems: 'center', justifyContent: 'center'},
  featureGlyphBoxCompact: {width: 22, height: 22, alignItems: 'center', justifyContent: 'center'},
  featureAudioHead: {width: 12, height: 17, borderRadius: 7, borderWidth: 2.2},
  featureAudioHeadCompact: {width: 10, height: 15, borderWidth: 2},
  featureAudioStem: {width: 2.2, height: 6, borderRadius: 1.1, marginTop: -1},
  featureAudioBase: {width: 14, height: 2.2, borderRadius: 1.1, marginTop: 1},
  featureVideoFrame: {width: 19, height: 14, borderRadius: 4, borderWidth: 2.2},
  featureVideoFrameCompact: {width: 17, height: 13, borderWidth: 2},
  featureVideoLens: {position: 'absolute', right: 1, width: 8, height: 10, borderTopWidth: 2.2, borderRightWidth: 2.2, transform: [{rotate: '45deg'}]},
  featurePhotoFrame: {width: 22, height: 18, borderRadius: 5, borderWidth: 2.1},
  featurePhotoFrameCompact: {width: 19, height: 16, borderWidth: 2},
  featurePhotoSun: {position: 'absolute', right: 4, top: 4, width: 4, height: 4, borderRadius: 2},
  featurePhotoMountain: {position: 'absolute', left: 4, right: 4, bottom: 4, height: 7, borderLeftWidth: 2, borderBottomWidth: 2, transform: [{rotate: '-45deg'}]},
  featurePollBox: {flexDirection: 'row', alignItems: 'flex-end'},
  featurePollBar: {width: 4, borderRadius: 2, marginHorizontal: 1.5},
  featureFormatA: {width: 17, height: 18, borderLeftWidth: 2.4, borderTopWidth: 2.4, borderRightWidth: 2.4, borderRadius: 3, transform: [{skewX: '-8deg'}]},
  featureFormatLine: {position: 'absolute', bottom: 5, width: 20, height: 2.4, borderRadius: 1.2},
  featureFilePage: {width: 18, height: 23, borderRadius: 4, borderWidth: 2.1},
  featureFilePageCompact: {width: 16, height: 20, borderWidth: 2},
  featureFileFold: {position: 'absolute', right: 5, top: 3, width: 7, height: 7, borderTopWidth: 2, borderRightWidth: 2},
  actionBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.58)',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  actionStage: {gap: 12},
  reactionStrip: {
    alignSelf: 'center',
    minHeight: 44,
    borderRadius: 22,
    paddingHorizontal: 6,
    flexDirection: 'row',
    alignItems: 'center',
    shadowOffset: {width: 0, height: 14},
    shadowOpacity: 0.34,
    shadowRadius: 34,
    elevation: 16,
  },
  reactionButton: {width: 35, height: 35, borderRadius: 18, alignItems: 'center', justifyContent: 'center'},
  reactionText: {fontSize: 20, lineHeight: 24},
  actionBubblePreview: {
    maxWidth: '78%',
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginHorizontal: 12,
  },
  messageMenu: {
    borderRadius: 24,
    overflow: 'hidden',
    padding: 6,
    shadowOffset: {width: 0, height: 14},
    shadowOpacity: 0.34,
    shadowRadius: 34,
    elevation: 14,
  },
  messageMenuRow: {height: 48, borderRadius: 16, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 11},
  messageMenuIcon: {width: 38, height: 38, alignItems: 'center', justifyContent: 'center'},
  replyGlyphCurve: {width: 22, height: 16, borderLeftWidth: 2.6, borderTopWidth: 2.6, borderRadius: 6, transform: [{rotate: '-6deg'}]},
  replyGlyphHead: {position: 'absolute', left: 6, top: 10, width: 10, height: 10, borderRightWidth: 2.6, borderBottomWidth: 2.6, transform: [{rotate: '135deg'}]},
  pinGlyphHead: {width: 19, height: 10, borderRadius: 3, transform: [{rotate: '45deg'}]},
  pinGlyphStem: {width: 4, height: 16, borderRadius: 2, marginTop: -1, transform: [{rotate: '45deg'}]},
  pinGlyphNeedle: {width: 2.5, height: 11, borderRadius: 1.25, marginTop: -6, transform: [{rotate: '45deg'}]},
  forwardGlyphLine: {width: 23, height: 4, borderRadius: 2, transform: [{translateX: -2}]},
  forwardGlyphHead: {position: 'absolute', right: 6, width: 13, height: 13, borderTopWidth: 2.8, borderRightWidth: 2.8, transform: [{rotate: '45deg'}]},
  trashGlyphLid: {width: 20, height: 4, borderRadius: 2, marginBottom: 3},
  trashGlyphCan: {width: 19, height: 22, borderWidth: 2.4, borderRadius: 4},
  messageMenuLabel: {fontSize: 15, lineHeight: 20, fontWeight: '800'},
  reactionSummary: {
    minHeight: 26,
    borderRadius: 13,
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: -3,
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  reactionSummaryMine: {alignSelf: 'flex-end', marginRight: 6},
  reactionSummaryOther: {alignSelf: 'flex-start', marginLeft: 6},
  reactionSummaryText: {fontSize: 12, lineHeight: 16, fontWeight: '900'},
  replyBox: {borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 10},
  replyBoxText: {flex: 1, fontSize: 13, fontWeight: '700'},
  cancelText: {fontSize: 13, fontWeight: '900'},
  sendProgress: {minHeight: 42, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 9},
  sendProgressText: {fontSize: 13, fontWeight: '700'},
  recordingBar: {minHeight: 42, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 9},
  recordingDot: {width: 9, height: 9, borderRadius: 5, backgroundColor: '#ff3b30'},
  recordingText: {flex: 1, fontSize: 13, fontWeight: '800'},
  expressionMenu: {borderRadius: 18, padding: 10, gap: 9, shadowOffset: {width: 0, height: 8}, shadowOpacity: 0.12, shadowRadius: 18, elevation: 5},
  emojiRow: {flexDirection: 'row', justifyContent: 'space-between'},
  emojiButton: {width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center'},
  emojiText: {fontSize: 24},
  gifPickerButton: {height: 42, borderRadius: 13, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8},
  gifPickerText: {fontSize: 13, fontWeight: '800'},
  error: {borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, overflow: 'hidden', fontWeight: '700'},
  empty: {borderWidth: 1, borderRadius: 18, padding: 24, alignItems: 'center', gap: 8, marginHorizontal: 10},
  emptyTitle: {fontSize: 17, fontWeight: '900'},
  emptyText: {fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 6},
  disabled: {opacity: 0.44},
  pressed: {opacity: 0.72},
});

function withDateSeparators(items: TimelineItem[]): TimelineListItem[] {
  const rows: TimelineListItem[] = [];
  let lastDay = '';
  for (const message of items) {
    const day = dayKey(message.timestamp);
    if (day !== lastDay) {
      rows.push({kind: 'date', id: `date-${day}`, timestamp: message.timestamp, label: formatDateLabel(message.timestamp)});
      lastDay = day;
    }
    rows.push({kind: 'message', id: message.id, message});
  }
  return rows;
}

function dayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatDateLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  if (startDate === startToday) {
    return 'Hôm nay';
  }
  if (startDate === startToday - 24 * 60 * 60 * 1000) {
    return 'Hôm qua';
  }
  return date.toLocaleDateString('vi-VN', {day: '2-digit', month: '2-digit', year: 'numeric'});
}

function themedText(colors: ReturnType<typeof useAppTheme>, baseSize: number, baseLineHeight?: number) {
  return {
    fontFamily: colors.fontFamily,
    fontSize: Math.round(baseSize * colors.fontScale),
    lineHeight: baseLineHeight ? Math.round(baseLineHeight * colors.fontScale) : undefined,
  };
}

function composerFormatStyle(defaultColor: string, format: FormatState): TextStyle {
  return {
    color: format.color ?? defaultColor,
    fontWeight: format.bold ? '800' : '500',
    fontStyle: format.italic ? 'italic' : 'normal',
    textDecorationLine: format.underline ? 'underline' : 'none',
  };
}

function hasActiveFormatting(format: FormatState): boolean {
  return format.bold || format.italic || format.underline || Boolean(format.color);
}

function formattedHtmlBody(body: string, format: FormatState): string {
  let html = escapeHtml(body).replace(/\n/g, '<br />');
  if (format.color) html = `<span style="color:${format.color}">${html}</span>`;
  if (format.underline) html = `<u>${html}</u>`;
  if (format.italic) html = `<em>${html}</em>`;
  if (format.bold) html = `<strong>${html}</strong>`;
  return html;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isFramelessMedia(message: TimelineItem): boolean {
  return Boolean(message.mediaItems?.length)
    || message.messageKind === 'image'
    || message.messageKind === 'video'
    || message.messageKind === 'sticker';
}

function klipyMediaFormat(url: string): {extension: string; mimeType: string} {
  const clean = url.split('?')[0]?.toLowerCase() ?? '';
  if (clean.endsWith('.webp')) return {extension: 'webp', mimeType: 'image/webp'};
  if (clean.endsWith('.png')) return {extension: 'png', mimeType: 'image/png'};
  if (/\.jpe?g$/.test(clean)) return {extension: 'jpg', mimeType: 'image/jpeg'};
  return {extension: 'gif', mimeType: 'image/gif'};
}

function chatBackgroundStyle(colors: ReturnType<typeof useAppTheme>) {
  if (colors.chatBackground === 'doodle') {
    return {backgroundColor: colors.dark ? colors.background : `${colors.primary}12`};
  }
  if (colors.chatBackground === 'wave') {
    return {backgroundColor: colors.dark ? colors.background : `${colors.primary}0f`};
  }
  if (colors.chatBackground === 'stars') {
    return {backgroundColor: colors.dark ? colors.background : `${colors.primary}0a`};
  }
  return {backgroundColor: colors.background};
}
