import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {CameraRoll} from '@react-native-camera-roll/camera-roll';
import {launchImageLibrary, type Asset} from 'react-native-image-picker';
import RNFS from 'react-native-fs';
import qrcode from 'qrcode-generator';
import {useSafeAreaInsets} from '../../platform/safeArea';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {Room} from 'matrix-js-sdk';
import {GlassSurface} from '../../components/GlassSurface';
import {MatrixAvatar} from '../../components/MatrixAvatar';
import {MatrixMediaImage} from '../../components/MatrixMediaImage';
import {MatrixMediaVideo} from '../../components/MatrixMediaVideo';
import {useSession} from '../../context/SessionContext';
import {matrixClientService} from '../../core/matrix/MatrixClientService';
import {nativeMatrixService, type NativeRoomMember} from '../../core/matrix/NativeMatrixService';
import {RoomService} from '../../core/matrix/RoomService';
import {loadBlockedUsers, saveBlockedUsers} from '../../core/matrix/AccountManagementService';
import {updateMatrixRoomProfile} from '../../core/matrix/ProfileSettingsService';
import {matrixErrorMessage} from '../../core/matrix/errors';
import {resolveMatrixMediaUri} from '../../core/matrix/MediaDecryptor';
import {saveMatrixAttachment} from '../../core/media/saveMatrixAttachment';
import {MessageService, type TimelineItem} from '../../core/matrix/MessageService';
import {displayNameForContact, loadLocalContacts, mergeContacts, shortContactId, type ContactRecord} from '../../core/matrix/ContactService';
import {ECLO_EVENT, MATRIX_TO_BASE_URL} from '../../config/matrix';
import type {RootStackParamList} from '../../navigation/RootNavigator';
import {useAppTheme} from '../../theme/useAppTheme';
import {
  ArrowLeft,
  BarChart3,
  Bell,
  BellOff,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Image as ImageIcon,
  Mic,
  Pin,
  Search,
  Trash2,
  Users,
} from 'lucide-react-native';

type InfoProps = NativeStackScreenProps<RootStackParamList, 'RoomInfo'>;
type MembersProps = NativeStackScreenProps<RootStackParamList, 'RoomMembers'>;
type InviteMembersProps = NativeStackScreenProps<RootStackParamList, 'RoomInviteMembers'>;
type EditProps = NativeStackScreenProps<RootStackParamList, 'RoomEdit'>;
type DetailProps<RouteName extends 'RoomMedia' | 'RoomFiles' | 'RoomPolls'> = NativeStackScreenProps<RootStackParamList, RouteName>;
type SearchProps = NativeStackScreenProps<RootStackParamList, 'RoomSearch'>;
type PinnedProps = NativeStackScreenProps<RootStackParamList, 'RoomPinned'>;
type MediaViewerProps = NativeStackScreenProps<RootStackParamList, 'MediaViewer'>;
type PollDetailsProps = NativeStackScreenProps<RootStackParamList, 'PollDetails'>;
type RoomInfoState = {
  roomId: string;
  name: string;
  avatarUrl?: string;
  encrypted: boolean;
  isDirect: boolean;
  joinedMembersCount: number;
  invitedMembersCount: number;
  members: RoomInfoMember[];
  timeline: TimelineItem[];
  ownPowerLevel?: number;
  canEditRoom?: boolean;
  canInvite?: boolean;
  canKick?: boolean;
  isOnline?: boolean;
};
type RoomInfoMember = NativeRoomMember & {powerLevel?: number; role?: string};

type InfoRow =
  | {kind: 'hero'}
  | {kind: 'quickActions'}
  | {kind: 'link'}
  | {kind: 'groupSummary'}
  | {kind: 'preview'; title: string; value: string; route: 'RoomMedia' | 'RoomFiles' | 'RoomPolls' | 'RoomPinned'; items: TimelineItem[]}
  | {kind: 'section'; title: string}
  | {kind: 'danger'; id: 'clearMe' | 'clearAll' | 'block' | 'leave'; title: string; subtitle: string};

export function RoomInfoScreen({navigation, route}: InfoProps) {
  const {roomId} = route.params;
  const colors = useAppTheme();
  const insets = useSafeAreaInsets();
  const {state} = useSession();
  const [info, setInfo] = useState<RoomInfoState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [roomPinned, setRoomPinnedState] = useState(false);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const data = useRoomInfo(roomId, setError);
  const mediaItems = useMemo(() => data.info ? expandMediaItems(filterMedia(data.info.timeline)) : [], [data.info]);
  const fileItems = useMemo(() => data.info ? filterFiles(data.info.timeline) : [], [data.info]);
  const pollItems = useMemo(() => data.info ? filterPolls(data.info.timeline) : [], [data.info]);
  const pinnedItems = useMemo(() => {
    if (!data.info) {
      return [];
    }
    const byId = new Map(data.info.timeline.map(item => [item.id, item]));
    return pinnedIds.map(id => byId.get(id)).filter((item): item is TimelineItem => Boolean(item));
  }, [data.info, pinnedIds]);

  useEffect(() => setInfo(data.info), [data.info]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadRoomMuted(roomId),
      loadRoomPinned(roomId),
      loadPinnedIds(roomId).catch(() => []),
    ])
      .then(([nextMuted, nextPinned, nextPinnedIds]) => {
        if (!cancelled) {
          setMuted(nextMuted);
          setRoomPinnedState(nextPinned);
          setPinnedIds(nextPinnedIds);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  async function toggleMuted() {
    const next = !muted;
    setMuted(next);
    setError(null);
    try {
      await setRoomMuted(roomId, next);
    } catch (err) {
      setMuted(!next);
      setError(matrixErrorMessage(err));
    }
  }

  async function toggleRoomPinned() {
    const next = !roomPinned;
    setRoomPinnedState(next);
    setError(null);
    try {
      await setRoomPinned(roomId, next);
    } catch (err) {
      setRoomPinnedState(!next);
      setError(matrixErrorMessage(err));
    }
  }

  const rows = useMemo<InfoRow[]>(() => {
    const next: InfoRow[] = [
      {kind: 'hero'},
      {kind: 'quickActions'},
    ];
    if (info && !info.isDirect) {
      next.push({kind: 'link'});
      next.push({kind: 'groupSummary'});
    }
    next.push(
      {kind: 'preview', title: 'Ảnh / Video', value: `${mediaItems.length}`, route: 'RoomMedia', items: mediaItems.slice(0, 4)},
      {kind: 'preview', title: 'File đã gửi', value: `${fileItems.length}`, route: 'RoomFiles', items: fileItems.slice(0, 3)},
      {kind: 'preview', title: 'Tin nhắn ghim', value: `${pinnedItems.length}`, route: 'RoomPinned', items: pinnedItems.slice(0, 3)},
      {kind: 'preview', title: 'Bình chọn', value: `${pollItems.length}`, route: 'RoomPolls', items: pollItems.slice(0, 3)},
      {kind: 'section', title: info?.isDirect ? 'Riêng tư / Bảo mật' : 'Quản trị / Bảo mật'},
    );
    if (info?.isDirect) {
      next.push(
        {kind: 'danger', id: 'clearMe', title: 'Xóa lịch sử cho riêng tôi', subtitle: 'Ẩn lịch sử đã có trên thiết bị này; tin mới vẫn hiện bình thường.'},
        {kind: 'danger', id: 'clearAll', title: 'Xóa lịch sử của cả 2', subtitle: 'Thu hồi các tin nhắn đang có trong cuộc trò chuyện.'},
        {kind: 'danger', id: 'block', title: 'Chặn người này', subtitle: 'Người này sẽ không thể gửi tin nhắn mới cho bạn.'},
      );
    } else {
      next.push(
        {kind: 'danger', id: 'clearMe', title: 'Xóa lịch sử cho riêng tôi', subtitle: 'Ẩn lịch sử nhóm đã có trên thiết bị này; tin mới vẫn hiện bình thường.'},
        {kind: 'danger', id: 'clearAll', title: 'Xóa lịch sử của phòng', subtitle: 'Thu hồi các tin nhắn đang có trong cuộc trò chuyện.'},
        {kind: 'danger', id: 'leave', title: 'Rời nhóm', subtitle: 'Bạn sẽ rời khỏi nhóm này.'},
      );
    }
    return next;
  }, [fileItems, info, mediaItems, pinnedItems, pollItems]);

  const runDangerAction = useCallback(async (id: 'clearMe' | 'clearAll' | 'block' | 'leave') => {
    setBusyAction(id);
    setError(null);
    try {
      if (nativeMatrixService.isActive()) {
        if (id === 'clearMe') {
          await nativeMatrixService.hideRoomHistoryForMe(roomId);
          setInfo(current => current ? {...current, timeline: []} : current);
          setError('Đã ẩn lịch sử cũ trên thiết bị này. Tin nhắn mới vẫn sẽ xuất hiện.');
          return;
        }
        if (id === 'clearAll') {
          const count = await nativeMatrixService.redactVisibleTimeline(roomId, 'Xóa lịch sử cuộc trò chuyện');
          setError(count ? `Đã thu hồi ${count} tin nhắn.` : 'Không có tin nhắn nào để thu hồi.');
          return;
        }
        if (id === 'block') {
          const targetUserId = info?.members[0]?.userId;
          if (!targetUserId) {
            throw new Error('Không tìm thấy người dùng cần chặn.');
          }
          await nativeMatrixService.ignoreUser(targetUserId);
          setError('Đã chặn người dùng này.');
          return;
        }
        if (id === 'leave') {
          await nativeMatrixService.leaveRoom(roomId);
          navigation.goBack();
          return;
        }
        throw new Error('Thao tác không hợp lệ.');
      }
      const client = matrixClientService.currentClient;
      if (id === 'clearAll') {
        const count = await new MessageService(client).redactVisibleTimeline(roomId, 'Xóa lịch sử cuộc trò chuyện');
        setError(count ? `Đã thu hồi ${count} tin nhắn.` : 'Không có tin nhắn nào để thu hồi.');
        return;
      }
      if (id === 'leave') {
        await new RoomService(client).leaveRoom(roomId);
        navigation.goBack();
        return;
      }
      if (id === 'block') {
        if (state.status !== 'signed_in') {
          throw new Error('Phiên đăng nhập chưa sẵn sàng.');
        }
        const targetUserId = info?.members[0]?.userId;
        if (!targetUserId) {
          throw new Error('Không tìm thấy người dùng cần chặn.');
        }
        const blocked = await loadBlockedUsers(state.auth);
        await saveBlockedUsers(state.auth, [...blocked, targetUserId]);
        setError('Đã chặn người dùng này.');
        return;
      }
      throw new Error('Phiên đăng nhập chưa sẵn sàng để ẩn lịch sử cục bộ.');
    } catch (err) {
      setError(matrixErrorMessage(err));
    } finally {
      setBusyAction(null);
    }
  }, [info?.members, navigation, roomId, state]);

  const handleDanger = useCallback((id: 'clearMe' | 'clearAll' | 'block' | 'leave') => {
    const title = id === 'clearAll' ? 'Xóa lịch sử của cả hai?' : id === 'leave' ? 'Rời nhóm?' : id === 'block' ? 'Chặn người này?' : 'Xóa lịch sử cho riêng tôi?';
    const message = id === 'clearAll'
      ? 'Tin nhắn sẽ được thu hồi khỏi cuộc trò chuyện đối với các thành viên.'
      : 'Thao tác này sẽ được thực hiện trên tài khoản và phòng hiện tại.';
    Alert.alert(title, message, [
      {text: 'Hủy', style: 'cancel'},
      {
        text: id === 'clearAll' ? 'Xóa' : 'Tiếp tục',
        style: id === 'clearAll' || id === 'leave' ? 'destructive' : 'default',
        onPress: () => runDangerAction(id),
      },
    ]);
  }, [runDangerAction]);

  return (
    <View style={[styles.screen, {backgroundColor: colors.background}]}>
      <FlatList
        data={rows}
        keyExtractor={(item, index) => `${item.kind}-${index}`}
        contentContainerStyle={[styles.content, {paddingTop: insets.top + 70, paddingBottom: insets.bottom + 36}]}
        renderItem={({item}) => {
          if (item.kind === 'hero') {
            return (
              <InfoHero
                info={info}
                fallbackTitle={route.params.title ?? roomId}
                colors={colors}
                onEditGroup={() => navigation.navigate('RoomEdit', {roomId, title: info?.name ?? route.params.title})}
              />
            );
          }
          if (item.kind === 'quickActions') {
            return (
              <QuickActions
                isDirect={Boolean(info?.isDirect)}
                muted={muted}
                pinned={roomPinned}
                colors={colors}
                onSearch={() => navigation.navigate('RoomSearch', {roomId, title: info?.name ?? route.params.title})}
                onTogglePinned={toggleRoomPinned}
                onToggleMuted={toggleMuted}
              />
            );
          }
          if (item.kind === 'link') {
            return <RoomLinkCard roomId={roomId} encrypted={Boolean(info?.encrypted)} colors={colors} />;
          }
          if (item.kind === 'groupSummary') {
            return (
              <GroupSummaryCard
                colors={colors}
                count={info?.joinedMembersCount ?? 0}
                invited={info?.invitedMembersCount ?? 0}
                onPress={() => navigation.navigate('RoomMembers', {roomId, title: info?.name ?? route.params.title})}
              />
            );
          }
          if (item.kind === 'preview') {
            return (
              <PreviewCard
                colors={colors}
                emptyText={emptyTextForPreview(item.route)}
                items={item.items}
                onOpen={() => navigation.navigate(item.route, {roomId, title: info?.name ?? route.params.title})}
                title={item.title}
                value={item.value}
              />
            );
          }
          if (item.kind === 'section') {
            return <Text style={[styles.section, {color: colors.tertiaryText}]}>{item.title}</Text>;
          }
          return (
            <Pressable accessibilityRole="button" onPress={() => handleDanger(item.id)} disabled={busyAction === item.id} style={({pressed}) => [pressed ? styles.pressed : null]}>
              <View style={[styles.dangerRow, {backgroundColor: colors.surface}]}>
                <View style={styles.dangerTitleRow}>
                  <Text style={[styles.dangerTitle, {color: colors.danger}]}>{item.title}</Text>
                  {busyAction === item.id ? <ActivityIndicator color={colors.danger} /> : null}
                </View>
                <Text style={[styles.dangerSubtitle, {color: colors.secondaryText}]}>{item.subtitle}</Text>
              </View>
            </Pressable>
          );
        }}
        ListHeaderComponent={error ? <Text style={[styles.error, {backgroundColor: colors.dangerSoft, color: colors.danger}]}>{error}</Text> : null}
      />
    </View>
  );
}

export function RoomMediaScreen({navigation, route}: DetailProps<'RoomMedia'>) {
  return <RoomDetailList roomId={route.params.roomId} kind="media" onOpenMedia={mediaId => navigation.navigate('MediaViewer', {roomId: route.params.roomId, title: route.params.title, mediaId})} />;
}

export function RoomFilesScreen({route}: DetailProps<'RoomFiles'>) {
  return <RoomDetailList roomId={route.params.roomId} kind="files" />;
}

export function RoomPollsScreen({navigation, route}: DetailProps<'RoomPolls'>) {
  return <RoomDetailList roomId={route.params.roomId} kind="polls" onOpenPoll={pollId => navigation.navigate('PollDetails', {roomId: route.params.roomId, pollId, title: route.params.title})} />;
}

export function PollDetailsScreen({route}: PollDetailsProps) {
  const colors = useAppTheme();
  const insets = useSafeAreaInsets();
  const [error, setError] = useState<string | null>(null);
  const {info} = useRoomInfo(route.params.roomId, setError);
  const item = useMemo(() => info?.timeline.find(entry => entry.id === route.params.pollId && entry.poll), [info, route.params.pollId]);
  const totalVotes = item?.poll?.totalVotes ?? item?.poll?.answers.reduce((total, answer) => total + (answer.count ?? answer.voters?.length ?? 0), 0) ?? 0;
  const members = useMemo(() => new Map(info?.members.map(member => [member.userId, member]) ?? []), [info?.members]);

  return (
    <View style={[styles.screen, {backgroundColor: colors.background}]}>
      <ScrollView contentContainerStyle={[styles.pollDetailsContent, {paddingTop: insets.top + 76, paddingBottom: insets.bottom + 36}]}>
        {error ? <Text style={[styles.error, {backgroundColor: colors.dangerSoft, color: colors.danger}]}>{error}</Text> : null}
        {!info ? <ActivityIndicator color={colors.primary} /> : null}
        {info && !item?.poll ? (
          <View style={styles.emptyDetail}>
            <Text style={[styles.emptyTitle, {color: colors.text}]}>Không tìm thấy bình chọn</Text>
            <Text style={[styles.emptySubtitle, {color: colors.secondaryText}]}>Bình chọn chưa được tải đầy đủ.</Text>
          </View>
        ) : null}
        {item?.poll ? (
          <>
            <GlassSurface style={styles.pollDetailsHero}>
              <View style={[styles.pollDetailsIcon, {backgroundColor: colors.primary}]}>
                <BarChart3 size={24} color="#fff" strokeWidth={2.4} />
              </View>
              <Text style={[styles.pollDetailsQuestion, {color: colors.text}]}>{item.poll.question}</Text>
              <Text style={[styles.pollDetailsMeta, {color: colors.secondaryText}]}>{totalVotes} lượt chọn · {formatDateTime(item.timestamp)}</Text>
            </GlassSurface>
            {item.poll.answers.map((answer, index) => {
              const voters = answer.voters ?? [];
              const count = answer.count ?? voters.length;
              const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
              return (
                <GlassSurface key={answer.id} style={styles.pollDetailsOption}>
                  <View style={styles.pollDetailsOptionHeader}>
                    <View style={[styles.pollDetailsNumber, {backgroundColor: answer.selected ? colors.primary : colors.input}]}>
                      <Text style={[styles.pollDetailsNumberText, {color: answer.selected ? '#fff' : colors.primary}]}>{index + 1}</Text>
                    </View>
                    <Text style={[styles.pollDetailsAnswer, {color: colors.text}]}>{answer.text}</Text>
                    <Text style={[styles.pollDetailsPercentage, {color: colors.primary}]}>{percentage}%</Text>
                  </View>
                  <View style={[styles.pollProgressTrack, {backgroundColor: colors.input}]}>
                    <View style={[styles.pollProgressFill, {backgroundColor: colors.primary, width: `${percentage}%` as `${number}%`}]} />
                  </View>
                  <Text style={[styles.pollDetailsCount, {color: colors.secondaryText}]}>{count} người chọn</Text>
                  <View style={styles.pollVotersList}>
                    {voters.length ? voters.map(userId => {
                      const member = members.get(userId);
                      return (
                        <View key={userId} style={[styles.pollVoterRow, {borderTopColor: colors.separator}]}>
                          <MatrixAvatar label={member?.displayName || userId} uri={member?.avatarUrl} size={30} backgroundColor={colors.primary} />
                          <View style={styles.pollVoterBody}>
                            <Text numberOfLines={1} style={[styles.pollVoterName, {color: colors.text}]}>{member?.displayName || compactUserId(userId)}</Text>
                            <Text numberOfLines={1} style={[styles.pollVoterId, {color: colors.secondaryText}]}>@{compactUserId(userId)}</Text>
                          </View>
                        </View>
                      );
                    }) : <Text style={[styles.pollNoVoters, {color: colors.tertiaryText}]}>Chưa có ai chọn lựa chọn này.</Text>}
                  </View>
                </GlassSurface>
              );
            })}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

export function RoomSearchScreen({navigation, route}: SearchProps) {
  const colors = useAppTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [indexedResults, setIndexedResults] = useState<TimelineItem[]>([]);
  const {info} = useRoomInfo(route.params.roomId, setError);
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle || !info) {
      return [];
    }
    const visible = info.timeline
      .filter(item => item.messageKind !== 'reaction')
      .filter(item => `${item.senderName ?? ''} ${item.body ?? ''} ${item.mediaFileName ?? ''}`.toLowerCase().includes(needle));
    const byId = new Map(indexedResults.map(item => [item.id, item]));
    visible.forEach(item => byId.set(item.id, item));
    return [...byId.values()].sort((a, b) => b.timestamp - a.timestamp);
  }, [indexedResults, info, query]);

  useEffect(() => {
    let active = true;
    const needle = query.trim();
    if (!needle || !nativeMatrixService.isActive()) {
      setIndexedResults([]);
      return () => { active = false; };
    }
    const timer = setTimeout(() => {
      nativeMatrixService.searchLocalTimeline(route.params.roomId, needle)
        .then(items => { if (active) setIndexedResults(items); })
        .catch(err => { if (active) setError(err instanceof Error ? err.message : 'Không thể đọc chỉ mục tìm kiếm.'); });
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, route.params.roomId]);

  return (
    <View style={[styles.screen, {backgroundColor: colors.background}]}>
      <FlatList
        data={results}
        keyExtractor={item => item.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[results.length ? styles.detailContent : styles.detailEmptyContent, {paddingTop: insets.top + 74, paddingBottom: insets.bottom + 32}]}
        ListHeaderComponent={
          <View style={styles.memberPageHeader}>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Tìm trong cuộc trò chuyện"
              placeholderTextColor={colors.tertiaryText}
              value={query}
              onChangeText={setQuery}
              style={[styles.memberSearchInput, {backgroundColor: colors.input, color: colors.text}]}
            />
            {error ? <Text style={[styles.error, {backgroundColor: colors.dangerSoft, color: colors.danger}]}>{error}</Text> : null}
          </View>
        }
        renderItem={({item}) => (
          <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Chat', {roomId: route.params.roomId, title: route.params.title, jumpToEventId: item.id})} style={({pressed}) => [pressed ? styles.pressed : null]}>
            <DetailRow colors={colors} item={item} />
          </Pressable>
        )}
        ListEmptyComponent={<EmptyDetail colors={colors} kind="files" />}
      />
    </View>
  );
}

export function RoomPinnedScreen({navigation, route}: PinnedProps) {
  const colors = useAppTheme();
  const insets = useSafeAreaInsets();
  const [error, setError] = useState<string | null>(null);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const {info} = useRoomInfo(route.params.roomId, setError);

  useEffect(() => {
    let cancelled = false;
    loadPinnedIds(route.params.roomId)
      .then(ids => {
        if (!cancelled) {
          setPinnedIds(ids);
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(matrixErrorMessage(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [route.params.roomId]);

  const pinnedItems = useMemo(() => {
    const byId = new Map((info?.timeline ?? []).map(item => [item.id, item]));
    return pinnedIds.map(id => byId.get(id)).filter((item): item is TimelineItem => Boolean(item));
  }, [info?.timeline, pinnedIds]);

  return (
    <View style={[styles.screen, {backgroundColor: colors.background}]}>
      <FlatList
        data={pinnedItems}
        keyExtractor={item => item.id}
        contentContainerStyle={[pinnedItems.length ? styles.detailContent : styles.detailEmptyContent, {paddingTop: insets.top + 74, paddingBottom: insets.bottom + 32}]}
        ListHeaderComponent={error ? <Text style={[styles.error, {backgroundColor: colors.dangerSoft, color: colors.danger}]}>{error}</Text> : null}
        renderItem={({item}) => (
          <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Chat', {roomId: route.params.roomId, title: route.params.title, jumpToEventId: item.id})} style={({pressed}) => [pressed ? styles.pressed : null]}>
            <DetailRow colors={colors} item={item} />
          </Pressable>
        )}
        ListEmptyComponent={<EmptyDetail colors={colors} kind="files" />}
      />
    </View>
  );
}

export function MediaViewerScreen({navigation, route}: MediaViewerProps) {
  const colors = useAppTheme();
  const insets = useSafeAreaInsets();
  const {width} = useWindowDimensions();
  const listRef = useRef<FlatList<TimelineItem>>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const {info} = useRoomInfo(route.params.roomId, setError);
  const mediaItems = useMemo(() => info ? expandMediaItems(filterMedia(info.timeline)) : [], [info]);

  useEffect(() => {
    const nextIndex = Math.max(0, mediaItems.findIndex(item => item.id === route.params.mediaId));
    setIndex(nextIndex);
    if (mediaItems.length) {
      requestAnimationFrame(() => listRef.current?.scrollToIndex({index: nextIndex, animated: false}));
    }
  }, [mediaItems.length, route.params.mediaId]);

  const current = mediaItems[index];
  const canPrevious = index > 0;
  const canNext = index < mediaItems.length - 1;

  function goToIndex(nextIndex: number) {
    const bounded = Math.max(0, Math.min(mediaItems.length - 1, nextIndex));
    setIndex(bounded);
    listRef.current?.scrollToIndex({index: bounded, animated: true});
  }

  async function saveCurrent() {
    if (!current?.mediaUrl && !current?.mediaSourceJson) {
      setError('Không có nội dung để lưu.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const localUri = await localMediaUri(current);
      const type = current.messageKind === 'video' ? 'video' : 'photo';
      await CameraRoll.saveAsset(localUri, {type});
      Alert.alert('Đã lưu', type === 'video' ? 'Video đã được lưu vào thư viện.' : 'Ảnh đã được lưu vào thư viện.');
    } catch (err) {
      setError(matrixErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={[styles.viewerScreen, {backgroundColor: '#000'}]}>
      {mediaItems.length ? (
        <FlatList
          ref={listRef}
          data={mediaItems}
          horizontal
          pagingEnabled
          bounces={false}
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          extraData={`${current?.id ?? ''}-${controlsVisible}`}
          keyExtractor={item => item.id}
          getItemLayout={(_data, itemIndex) => ({length: width, offset: width * itemIndex, index: itemIndex})}
          onMomentumScrollEnd={event => setIndex(Math.max(0, Math.min(mediaItems.length - 1, Math.round(event.nativeEvent.contentOffset.x / width))))}
          onScrollToIndexFailed={({index: failedIndex}) => requestAnimationFrame(() => listRef.current?.scrollToOffset({offset: failedIndex * width, animated: false}))}
          renderItem={({item}) => (
            <View style={[styles.viewerPage, {width}]}>
              {item.messageKind === 'video' ? (
                <MatrixMediaVideo
                  item={item}
                  style={styles.viewerImage}
                  autoPlay={item.id === current?.id}
                  resizeMode="contain"
                  backgroundColor="#000"
                  indicatorColor="#fff"
                  textColor="#fff"
                />
              ) : (
                <Pressable accessibilityRole="button" accessibilityLabel={controlsVisible ? 'Ẩn nút xem ảnh' : 'Hiện nút xem ảnh'} onPress={() => setControlsVisible(visible => !visible)} style={styles.viewerTapArea}>
                  <MatrixMediaImage
                    item={item}
                    style={styles.viewerImage}
                    resizeMode="contain"
                    backgroundColor="#000"
                    indicatorColor="#fff"
                    textColor="#fff"
                  />
                </Pressable>
              )}
            </View>
          )}
        />
      ) : (
        <View style={styles.viewerPlaceholder}>
          <ActivityIndicator color="#fff" />
          <Text style={styles.viewerPlaceholderText}>{error || 'Đang tải media...'}</Text>
        </View>
      )}
      {controlsVisible ? (
        <>
          <View style={[styles.viewerHeader, {paddingTop: insets.top + 8}]}>
            <Pressable accessibilityRole="button" accessibilityLabel="Quay lại" onPress={() => navigation.goBack()} style={({pressed}) => [styles.viewerCircleButton, pressed ? styles.pressed : null]}>
              <ArrowLeft size={23} color="#fff" strokeWidth={2.5} />
            </Pressable>
            <View style={styles.viewerTitlePill}>
              <Text numberOfLines={1} style={styles.viewerTitle}>{mediaItems.length ? `${index + 1}/${mediaItems.length}` : route.params.title ?? 'Media'}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Lưu media" onPress={saveCurrent} disabled={(!current?.mediaUrl && !current?.mediaSourceJson) || saving} style={({pressed}) => [styles.viewerSaveButton, saving || (!current?.mediaUrl && !current?.mediaSourceJson) ? styles.disabled : null, pressed ? styles.pressed : null]}>
              {saving ? <ActivityIndicator color="#fff" /> : <><Download size={18} color="#fff" strokeWidth={2.4} /><Text style={styles.viewerSaveText}>Lưu</Text></>}
            </Pressable>
          </View>
          {canPrevious ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Media trước" onPress={() => goToIndex(index - 1)} style={({pressed}) => [styles.viewerNavButton, styles.viewerNavLeft, pressed ? styles.pressed : null]}>
              <ChevronLeft size={30} color="#fff" strokeWidth={2.5} />
            </Pressable>
          ) : null}
          {canNext ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Media tiếp theo" onPress={() => goToIndex(index + 1)} style={({pressed}) => [styles.viewerNavButton, styles.viewerNavRight, pressed ? styles.pressed : null]}>
              <ChevronRight size={30} color="#fff" strokeWidth={2.5} />
            </Pressable>
          ) : null}
        </>
      ) : null}
      {error && (current?.mediaUrl || current?.mediaSourceJson) ? <Text style={[styles.viewerError, {bottom: insets.bottom + 24}]}>{error}</Text> : null}
    </View>
  );
}

export function RoomMembersScreen({navigation, route}: MembersProps) {
  const colors = useAppTheme();
  const insets = useSafeAreaInsets();
  const {state} = useSession();
  const [error, setError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const {info} = useRoomInfo(route.params.roomId, setError);
  const members = info?.members ?? [];
  const canInvite = Boolean(info && !info.isDirect && info.canInvite);
  const canKick = Boolean(info && !info.isDirect && info.canKick);
  const ownUserId = state.status === 'signed_in' ? state.auth.userId : '';

  const inviteMember = useCallback(() => {
    if (!canInvite) {
      return;
    }
    navigation.navigate('RoomInviteMembers', {roomId: route.params.roomId, title: route.params.title});
  }, [canInvite, navigation, route.params.roomId, route.params.title]);

  const removeMember = useCallback((member: RoomInfoMember) => {
    if (!canKick || member.userId === ownUserId) {
      return;
    }
    Alert.alert('Xóa thành viên?', `Xóa ${member.displayName || compactUserId(member.userId)} khỏi nhóm này.`, [
      {text: 'Hủy', style: 'cancel'},
      {
        text: 'Xóa',
        style: 'destructive',
        onPress: async () => {
          setBusyUserId(member.userId);
          setError(null);
          try {
            if (nativeMatrixService.isActive()) {
              await nativeMatrixService.kickUser(route.params.roomId, member.userId, 'Removed by room admin');
            } else {
              await (matrixClientService.currentClient as any).kick(route.params.roomId, member.userId, 'Removed by room admin');
            }
          } catch (err) {
            setError(matrixErrorMessage(err));
          } finally {
            setBusyUserId(null);
          }
        },
      },
    ]);
  }, [canKick, ownUserId, route.params.roomId]);

  return (
    <View style={[styles.screen, {backgroundColor: colors.background}]}>
      <FlatList
        data={members}
        keyExtractor={member => member.userId}
        contentContainerStyle={[styles.detailContent, {paddingTop: insets.top + 74, paddingBottom: insets.bottom + 32}]}
        ListHeaderComponent={
          <View style={styles.memberPageHeader}>
            {error ? <Text style={[styles.error, {backgroundColor: colors.dangerSoft, color: colors.danger}]}>{error}</Text> : null}
            <View style={styles.memberHeaderRow}>
              <Text style={[styles.memberPageTitle, {color: colors.text}]}>{members.length} thành viên</Text>
              {canInvite ? (
                <Pressable accessibilityRole="button" onPress={inviteMember} style={({pressed}) => [styles.memberAddButton, {backgroundColor: colors.primary}, pressed ? styles.pressed : null]}>
                  <Text style={styles.memberAddText}>+ Thêm</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        }
        renderItem={({item}) => (
          <MemberRow
            colors={colors}
            member={item}
            showRole
            canRemove={canKick && item.userId !== ownUserId}
            busy={busyUserId === item.userId}
            onRemove={() => removeMember(item)}
          />
        )}
        ListEmptyComponent={<EmptyDetail colors={colors} kind="files" />}
      />
    </View>
  );
}

export function RoomInviteMembersScreen({route}: InviteMembersProps) {
  const colors = useAppTheme();
  const insets = useSafeAreaInsets();
  const {state} = useSession();
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const {info} = useRoomInfo(route.params.roomId, setError);
  const usingNative = state.status === 'signed_in' && nativeMatrixService.isActive();
  const ownerId = state.status === 'signed_in' ? state.auth.userId : '@demo:local';

  const refreshContacts = useCallback(async () => {
    if (state.status !== 'signed_in') {
      setContacts([]);
      return;
    }
    try {
      const local = await loadLocalContacts(ownerId);
      const matrix = usingNative
        ? await nativeMatrixService.listDirectContacts()
        : new RoomService(matrixClientService.currentClient).listDirectContacts();
      setContacts(mergeContacts(local, matrix));
    } catch (err) {
      setError(matrixErrorMessage(err));
    }
  }, [ownerId, state.status, usingNative]);

  useEffect(() => {
    refreshContacts();
  }, [refreshContacts]);

  const existingUserIds = useMemo(() => new Set((info?.members ?? []).map(member => member.userId)), [info?.members]);
  const canInvite = Boolean(info && !info.isDirect && info.canInvite);
  const filteredContacts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return contacts
      .filter(contact => !existingUserIds.has(contact.userId))
      .filter(contact => {
        if (!needle) {
          return true;
        }
        return `${displayNameForContact(contact)} ${contact.userId}`.toLowerCase().includes(needle);
      });
  }, [contacts, existingUserIds, query]);

  async function inviteContact(contact: ContactRecord) {
    if (!canInvite) {
      setError('Chỉ quản trị viên hoặc trưởng nhóm mới có quyền mời thành viên.');
      return;
    }
    setBusyUserId(contact.userId);
    setError(null);
    try {
      if (usingNative) {
        await nativeMatrixService.inviteUser(route.params.roomId, contact.userId);
      } else {
        await (matrixClientService.currentClient as any).invite(route.params.roomId, contact.userId);
      }
    } catch (err) {
      setError(matrixErrorMessage(err));
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <View style={[styles.screen, {backgroundColor: colors.background}]}>
      <FlatList
        data={filteredContacts}
        keyExtractor={contact => contact.userId}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[filteredContacts.length ? styles.detailContent : styles.detailEmptyContent, {paddingTop: insets.top + 74, paddingBottom: insets.bottom + 32}]}
        ListHeaderComponent={
          <View style={styles.memberPageHeader}>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Tìm trong danh bạ"
              placeholderTextColor={colors.tertiaryText}
              value={query}
              onChangeText={setQuery}
              style={[styles.memberSearchInput, {backgroundColor: colors.input, color: colors.text}]}
            />
            {error ? <Text style={[styles.error, {backgroundColor: colors.dangerSoft, color: colors.danger}]}>{error}</Text> : null}
            {info && !canInvite ? (
              <Text style={[styles.error, {backgroundColor: colors.warningSoft, color: colors.warning}]}>Chỉ quản trị viên hoặc trưởng nhóm mới có quyền mời thành viên.</Text>
            ) : null}
          </View>
        }
        renderItem={({item}) => (
          <Pressable accessibilityRole="button" onPress={() => inviteContact(item)} disabled={!canInvite || busyUserId === item.userId} style={({pressed}) => [styles.inviteRow, !canInvite ? styles.disabled : null, pressed ? styles.pressed : null]}>
            <MatrixAvatar label={displayNameForContact(item)} uri={item.avatarUrl} size={44} backgroundColor={colors.primary} />
            <View style={[styles.memberBody, {borderBottomColor: colors.separator}]}>
              <Text numberOfLines={1} style={[styles.memberName, {color: colors.text}]}>{displayNameForContact(item)}</Text>
              <Text numberOfLines={1} style={[styles.memberId, {color: colors.secondaryText}]}>{shortContactId(item.userId)}</Text>
            </View>
            <View style={[styles.inviteButton, {backgroundColor: canInvite ? colors.primary : colors.input}]}>
              {busyUserId === item.userId ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.inviteButtonText}>Mời</Text>}
            </View>
          </Pressable>
        )}
        ListEmptyComponent={<EmptyDetail colors={colors} kind="files" />}
      />
    </View>
  );
}

export function RoomEditScreen({navigation, route}: EditProps) {
  const colors = useAppTheme();
  const insets = useSafeAreaInsets();
  const {state} = useSession();
  const [error, setError] = useState<string | null>(null);
  const {info} = useRoomInfo(route.params.roomId, setError);
  const [name, setName] = useState(route.params.title ?? '');
  const [avatar, setAvatar] = useState<Asset | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (info?.name) {
      setName(info.name);
    }
  }, [info?.name]);

  async function pickAvatar() {
    const result = await launchImageLibrary({
      mediaType: 'photo',
      selectionLimit: 1,
      quality: 0.8,
    });
    const asset = result.assets?.[0];
    if (asset) {
      setAvatar(asset);
    }
  }

  async function saveGroup() {
    const cleanName = name.trim();
    if (info && !info.canEditRoom) {
      setError('Bạn không có quyền chỉnh tên hoặc avatar nhóm này.');
      return;
    }
    if (!cleanName && !avatar) {
      setError('Tên nhóm không được để trống.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (state.status !== 'signed_in') {
        throw new Error('Phiên đăng nhập chưa sẵn sàng.');
      }
      await updateMatrixRoomProfile(state.auth, route.params.roomId, {
        name: cleanName,
        avatar: avatar ?? undefined,
      });
      navigation.goBack();
    } catch (err) {
      setError(matrixErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.screen, {backgroundColor: colors.background}]}>
      <View style={[styles.editContent, {paddingTop: insets.top + 78, paddingBottom: insets.bottom + 32}]}>
        {error ? <Text style={[styles.error, {backgroundColor: colors.dangerSoft, color: colors.danger}]}>{error}</Text> : null}
        <GlassSurface style={styles.editHero}>
          <Pressable accessibilityRole="button" onPress={pickAvatar} style={({pressed}) => [styles.editAvatarButton, pressed ? styles.pressed : null]}>
            <MatrixAvatar label={info?.name ?? name} uri={avatar?.uri ?? info?.avatarUrl} size={96} backgroundColor={colors.primary} />
            <View style={[styles.editCameraDot, {backgroundColor: colors.primary}]}>
              <Text style={styles.editCameraText}>⌾</Text>
            </View>
          </Pressable>
          <Text style={[styles.editAvatarHint, {color: colors.secondaryText}]}>Chạm để đổi avatar nhóm</Text>
        </GlassSurface>
        <GlassSurface style={styles.editCard}>
          <Text style={[styles.editLabel, {color: colors.tertiaryText}]}>TÊN NHÓM</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Tên nhóm"
            placeholderTextColor={colors.tertiaryText}
            style={[styles.editInput, {color: colors.text, backgroundColor: colors.input}]}
          />
          <Pressable disabled={busy} accessibilityRole="button" onPress={saveGroup} style={({pressed}) => [styles.saveButton, {backgroundColor: colors.primary}, pressed ? styles.pressed : null, busy ? styles.disabled : null]}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Lưu thay đổi</Text>}
          </Pressable>
        </GlassSurface>
      </View>
    </View>
  );
}

function RoomDetailList({kind, onOpenMedia, onOpenPoll, roomId}: {kind: 'media' | 'files' | 'polls'; roomId: string; onOpenMedia?: (mediaId: string) => void; onOpenPoll?: (pollId: string) => void}) {
  const colors = useAppTheme();
  const insets = useSafeAreaInsets();
  const {width} = useWindowDimensions();
  const [error, setError] = useState<string | null>(null);
  const {info} = useRoomInfo(roomId, setError);
  const mediaTileSize = Math.floor((width - 24 - 16) / 2);
  const items = useMemo(() => {
    if (!info) {
      return [];
    }
    if (kind === 'media') {
      return filterMedia(info.timeline);
    }
    if (kind === 'files') {
      return filterFiles(info.timeline);
    }
    return filterPolls(info.timeline);
  }, [info, kind]);

  async function downloadFile(item: TimelineItem) {
    setError(null);
    try {
      await saveMatrixAttachment(item);
    } catch (err) {
      setError(matrixErrorMessage(err));
    }
  }

  return (
    <View style={[styles.screen, {backgroundColor: colors.background}]}>
      <FlatList
        data={items}
        keyExtractor={item => item.id}
        key={kind === 'media' ? 'media-grid' : 'detail-list'}
        contentContainerStyle={[items.length ? styles.detailContent : styles.detailEmptyContent, {paddingTop: insets.top + 74, paddingBottom: insets.bottom + 32}]}
        numColumns={kind === 'media' ? 2 : 1}
        ListHeaderComponent={error ? <Text style={[styles.error, {backgroundColor: colors.dangerSoft, color: colors.danger}]}>{error}</Text> : null}
        renderItem={({item}) => kind === 'media'
          ? <MediaTile item={item} colors={colors} size={mediaTileSize} onPress={() => onOpenMedia?.(item.id)} />
          : <DetailRow
              item={item}
              colors={colors}
              onPress={kind === 'files' ? () => void downloadFile(item) : kind === 'polls' ? () => onOpenPoll?.(item.id) : undefined}
              actionHint={kind === 'files' ? 'Chạm để tải về' : kind === 'polls' ? 'Chạm để xem chi tiết' : undefined}
            />}
        ListEmptyComponent={<EmptyDetail colors={colors} kind={kind} />}
      />
    </View>
  );
}

function useRoomInfo(roomId: string, setError: (error: string | null) => void) {
  const {state} = useSession();
  const [info, setInfo] = useState<RoomInfoState | null>(null);
  const usingNative = state.status === 'signed_in' && nativeMatrixService.isActive();

  const refresh = useCallback(async () => {
    try {
      setError(null);
      if (usingNative) {
        const details = await nativeMatrixService.getRoomDetails(roomId);
        setInfo({...details, timeline: nativeMatrixService.getTimeline(roomId)});
        return;
      }
      const room = matrixClientService.currentClient.getRoom(roomId);
      if (!room) {
        throw new Error('Không tìm thấy phòng.');
      }
      setInfo(await roomInfoFromMatrixRoom(room));
    } catch (err) {
      setError(matrixErrorMessage(err));
    }
  }, [roomId, setError, usingNative]);

  useEffect(() => {
    refresh();
    if (usingNative) {
      const unsubscribeTimeline = nativeMatrixService.subscribeTimeline(roomId, refresh);
      const unsubscribeRooms = nativeMatrixService.subscribeRooms(refresh);
      return () => {
        unsubscribeTimeline();
        unsubscribeRooms();
      };
    }
    const client = matrixClientService.currentClient;
    (client as any).on('Room.timeline', refresh);
    (client as any).on('RoomMember.membership', refresh);
    (client as any).on('RoomMember.powerLevel', refresh);
    (client as any).on('Room.name', refresh);
    return () => {
      (client as any).removeListener('Room.timeline', refresh);
      (client as any).removeListener('RoomMember.membership', refresh);
      (client as any).removeListener('RoomMember.powerLevel', refresh);
      (client as any).removeListener('Room.name', refresh);
    };
  }, [refresh, roomId, usingNative]);

  return {info};
}

function InfoHero({colors, fallbackTitle, info, onEditGroup}: {colors: ReturnType<typeof useAppTheme>; fallbackTitle: string; info: RoomInfoState | null; onEditGroup: () => void}) {
  return (
    <View style={styles.heroCard}>
      <View style={styles.heroAvatarWrap}>
        <MatrixAvatar label={info?.name ?? fallbackTitle} uri={info?.avatarUrl} size={88} backgroundColor={colors.primary} />
        {info?.isDirect ? (
          <View style={[styles.statusDot, {backgroundColor: info.isOnline ? colors.success : colors.tertiaryText, borderColor: colors.surface}]} />
        ) : null}
      </View>
      <Text numberOfLines={2} style={[styles.name, {color: colors.text}]}>{info?.name ?? fallbackTitle}</Text>
      <View style={[styles.typePill, {backgroundColor: colors.primary}]}>
        <Text style={styles.typePillText}>{info?.isDirect ? 'Cá nhân' : `${info?.joinedMembersCount ?? 0} thành viên`}</Text>
      </View>
      {info && !info.isDirect && info.canEditRoom ? (
        <Pressable accessibilityRole="button" onPress={onEditGroup} style={({pressed}) => [styles.editGroupButton, {backgroundColor: colors.input}, pressed ? styles.pressed : null]}>
          <Text style={[styles.editGroupText, {color: colors.text}]}>Chỉnh nhóm</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function QuickActions({
  colors,
  isDirect,
  muted,
  onTogglePinned,
  onSearch,
  onToggleMuted,
  pinned,
}: {
  colors: ReturnType<typeof useAppTheme>;
  isDirect: boolean;
  muted: boolean;
  pinned: boolean;
  onSearch: () => void;
  onTogglePinned: () => void;
  onToggleMuted: () => void;
}) {
  const actions = isDirect
    ? [
        {icon: 'search', label: 'Tìm kiếm', onPress: onSearch, active: false},
        {icon: 'pin', label: pinned ? 'Đã ghim' : 'Ghim chat', onPress: onTogglePinned, active: pinned},
        {icon: muted ? 'bellOff' : 'bell', label: muted ? 'Đã tắt' : 'Thông báo', onPress: onToggleMuted, active: muted},
      ]
    : [
        {icon: 'search', label: 'Tìm kiếm', onPress: onSearch, active: false},
        {icon: 'pin', label: pinned ? 'Đã ghim' : 'Ghim chat', onPress: onTogglePinned, active: pinned},
        {icon: muted ? 'bellOff' : 'bell', label: muted ? 'Đã tắt' : 'Thông báo', onPress: onToggleMuted, active: muted},
      ];
  return (
    <View style={styles.quickActions}>
      {actions.map(action => (
        <Pressable key={action.label} accessibilityRole="button" onPress={action.onPress} style={({pressed}) => [styles.quickAction, pressed ? styles.pressed : null]}>
          <View style={[styles.quickActionIcon, {backgroundColor: action.active ? colors.primary : colors.input}]}>
            <InfoGlyph name={action.icon} color={action.active ? '#fff' : colors.primary} />
          </View>
          <Text numberOfLines={1} style={[styles.quickActionLabel, {color: colors.text}]}>{action.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function InfoGlyph({color, name}: {color: string; name: string}) {
  const props = {size: 22, color, strokeWidth: 2.3};
  if (name === 'search') {
    return <Search {...props} />;
  }
  if (name === 'pin') {
    return <Pin {...props} />;
  }
  if (name === 'bell') {
    return <Bell {...props} />;
  }
  if (name === 'bellOff') {
    return <BellOff {...props} />;
  }
  if (name === 'poll') {
    return <BarChart3 {...props} />;
  }
  if (name === 'audio') {
    return <Mic {...props} />;
  }
  if (name === 'photo') {
    return <ImageIcon {...props} />;
  }
  if (name === 'group') {
    return <Users {...props} />;
  }
  return <FileText {...props} />;
}

function GroupSummaryCard({
  colors,
  count,
  invited,
  onPress,
}: {
  colors: ReturnType<typeof useAppTheme>;
  count: number;
  invited: number;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({pressed}) => [pressed ? styles.pressed : null]}>
      <View style={[styles.infoCard, {backgroundColor: colors.surface}]}>
        <View style={styles.memberSummaryRow}>
          <View style={[styles.memberSummaryIcon, {backgroundColor: colors.input}]}>
            <InfoGlyph name="group" color={colors.primary} />
          </View>
          <View style={styles.memberSummaryBody}>
            <Text style={[styles.memberSummaryTitle, {color: colors.text}]}>{count} thành viên</Text>
            <Text style={[styles.memberSummarySubtitle, {color: colors.secondaryText}]}>
              {invited ? `${invited} lời mời đang chờ` : 'Xem thành viên và chức vụ'}
            </Text>
          </View>
          <Text style={[styles.chevron, {color: colors.tertiaryText}]}>›</Text>
        </View>
      </View>
    </Pressable>
  );
}

function RoomLinkCard({colors, encrypted, roomId}: {colors: ReturnType<typeof useAppTheme>; encrypted: boolean; roomId: string}) {
  const matrixToLink = `${MATRIX_TO_BASE_URL}/${encodeURIComponent(roomId)}`;
  const [copied, setCopied] = useState(false);
  function copyRoomId() {
    Clipboard.setString(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }
  return (
    <View style={[styles.infoCard, {backgroundColor: colors.surface}]}>
      <View style={styles.cardHeader}>
        <Text style={[styles.cardTitle, {color: colors.secondaryText}]}>MÃ PHÒNG</Text>
        <View style={[styles.softPill, {backgroundColor: encrypted ? colors.successSoft : colors.input}]}>
          <Text style={[styles.softPillText, {color: encrypted ? colors.success : colors.secondaryText}]}>{encrypted ? 'Được bảo vệ' : 'Riêng tư'}</Text>
        </View>
      </View>
      <View style={[styles.linkBox, {backgroundColor: colors.input}]}>
        <QrCode value={matrixToLink} colors={colors} />
        <View style={styles.linkBody}>
          <Text numberOfLines={1} style={[styles.linkText, {color: colors.secondaryText}]}>Quét mã để mở cuộc trò chuyện</Text>
          <Pressable accessibilityRole="button" onPress={copyRoomId} style={({pressed}) => [styles.copyButton, {backgroundColor: colors.primary}, pressed ? styles.pressed : null]}>
            <Text style={styles.copyText}>{copied ? 'Đã sao chép' : 'Sao chép mã'}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function QrCode({colors, value}: {colors: ReturnType<typeof useAppTheme>; value: string}) {
  const matrix = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const size = qr.getModuleCount();
    return Array.from({length: size}, (_, row) => Array.from({length: size}, (_item, col) => qr.isDark(row, col)));
  }, [value]);
  return (
    <View style={[styles.qrPlaceholder, {backgroundColor: '#fff'}]}>
      {matrix.map((row, rowIndex) => (
        <View key={`r-${rowIndex}`} style={styles.qrRow}>
          {row.map((dark, colIndex) => (
            <View key={`c-${colIndex}`} style={[styles.qrCell, {backgroundColor: dark ? '#0b1220' : '#fff'}]} />
          ))}
        </View>
      ))}
    </View>
  );
}

function PreviewCard({
  colors,
  emptyText,
  items,
  onOpen,
  title,
  value,
}: {
  colors: ReturnType<typeof useAppTheme>;
  emptyText: string;
  items: TimelineItem[];
  onOpen: () => void;
  title: string;
  value: string;
}) {
  const mediaPreview = items.some(isTimelineMedia);
  return (
    <View style={[styles.infoCard, {backgroundColor: colors.surface}]}>
      <View style={styles.cardHeader}>
        <Text style={[styles.cardTitle, {color: colors.secondaryText}]}>{title.toUpperCase()}</Text>
        <Pressable accessibilityRole="button" onPress={onOpen} hitSlop={8}>
          <Text style={[styles.seeAll, {color: colors.primary}]}>Xem tất cả</Text>
        </Pressable>
      </View>
      {items.length ? (
        <View style={mediaPreview ? styles.previewMediaGrid : styles.previewList}>
          {items.map(item => <PreviewItem key={item.id} item={item} colors={colors} />)}
        </View>
      ) : (
        <View style={[styles.emptyPreview, {backgroundColor: colors.input}]}>
          <Text style={[styles.emptyPreviewText, {color: colors.secondaryText}]}>{emptyText}</Text>
        </View>
      )}
      <Text style={[styles.previewCount, {color: colors.tertiaryText}]}>{value} mục</Text>
    </View>
  );
}

function PreviewItem({colors, item}: {colors: ReturnType<typeof useAppTheme>; item: TimelineItem}) {
  if (isTimelineMedia(item)) {
    return <MediaPreviewTile colors={colors} item={item} style={styles.previewImage} />;
  }
  return (
    <View style={[styles.previewRow, {backgroundColor: colors.input}]}>
      <View style={styles.previewIconWrap}>
        <InfoGlyph name={item.messageKind === 'poll' ? 'poll' : 'file'} color={colors.primary} />
      </View>
      <Text numberOfLines={1} style={[styles.previewText, {color: colors.text}]}>{item.poll?.question ?? item.body}</Text>
      <Text style={[styles.chevron, {color: colors.tertiaryText}]}>›</Text>
    </View>
  );
}

function MemberRow({
  busy,
  canRemove,
  colors,
  member,
  onRemove,
  showRole,
}: {
  busy?: boolean;
  canRemove?: boolean;
  colors: ReturnType<typeof useAppTheme>;
  member: RoomInfoMember;
  onRemove?: () => void;
  showRole?: boolean;
}) {
  return (
    <View style={styles.memberRow}>
      <MatrixAvatar label={member.displayName || member.userId} uri={member.avatarUrl} size={42} backgroundColor={colors.primary} />
      <View style={[styles.memberBody, {borderBottomColor: colors.separator}]}>
        <Text numberOfLines={1} style={[styles.memberName, {color: colors.text}]}>{member.displayName || compactUserId(member.userId)}</Text>
        <Text numberOfLines={1} style={[styles.memberId, {color: colors.secondaryText}]}>
          @{compactUserId(member.userId)}{showRole ? ` · ${member.role ?? 'Thành viên'}` : ''}
        </Text>
      </View>
      {canRemove ? (
        <Pressable accessibilityRole="button" onPress={onRemove} disabled={busy} style={({pressed}) => [styles.memberRemoveButton, {backgroundColor: colors.dangerSoft}, pressed ? styles.pressed : null, busy ? styles.disabled : null]}>
          {busy ? <ActivityIndicator size="small" color={colors.danger} /> : <Trash2 size={19} color={colors.danger} strokeWidth={2.4} />}
        </Pressable>
      ) : null}
    </View>
  );
}

function MediaTile({colors, item, onPress, size}: {colors: ReturnType<typeof useAppTheme>; item: TimelineItem; onPress?: () => void; size: number}) {
  return (
    <Pressable accessibilityRole="imagebutton" onPress={onPress} style={({pressed}) => [styles.mediaTileButton, {width: size, height: size}, pressed ? styles.pressed : null]}>
      <MediaPreviewTile colors={colors} item={item} style={styles.mediaTile} />
    </Pressable>
  );
}

function MediaPreviewTile({colors, item, style}: {colors: ReturnType<typeof useAppTheme>; item: TimelineItem; style: object}) {
  if (item.messageKind === 'video') {
    return (
      <MatrixMediaVideo
        item={item}
        style={style}
        compact
        backgroundColor={colors.input}
        indicatorColor={colors.primary}
        textColor={colors.secondaryText}
      />
    );
  }
  return (
    <MatrixMediaImage
      item={item}
      style={style}
      backgroundColor={colors.input}
      indicatorColor={colors.primary}
      textColor={colors.secondaryText}
      showLabel={false}
    />
  );
}

function DetailRow({colors, item, onPress, actionHint}: {colors: ReturnType<typeof useAppTheme>; item: TimelineItem; onPress?: () => void; actionHint?: string}) {
  return (
    <Pressable accessibilityRole={onPress ? 'button' : undefined} onPress={onPress} disabled={!onPress} style={({pressed}) => [pressed ? styles.pressed : null]}>
      <GlassSurface style={styles.detailRow}>
        <View style={[styles.detailIcon, {backgroundColor: colors.input}]}> 
          <InfoGlyph name={item.messageKind === 'poll' ? 'poll' : item.messageKind === 'audio' ? 'audio' : 'file'} color={colors.primary} />
        </View>
        <View style={styles.detailBody}>
          <Text numberOfLines={1} style={[styles.detailTitle, {color: colors.text}]}>{item.poll?.question ?? (item.body || item.type)}</Text>
          <Text style={[styles.detailSubtitle, {color: colors.secondaryText}]}>{actionHint ? `${actionHint} · ` : ''}{formatDateTime(item.timestamp)}</Text>
        </View>
        {onPress ? <Text style={[styles.chevron, {color: colors.tertiaryText}]}>{item.messageKind === 'poll' ? '›' : '↓'}</Text> : null}
      </GlassSurface>
    </Pressable>
  );
}

function EmptyDetail({colors, kind}: {colors: ReturnType<typeof useAppTheme>; kind: 'media' | 'files' | 'polls'}) {
  return (
    <View style={styles.emptyDetail}>
      <Text style={[styles.emptyTitle, {color: colors.text}]}>{kind === 'media' ? 'Chưa có ảnh/video' : kind === 'files' ? 'Chưa có file' : 'Chưa có bình chọn'}</Text>
      <Text style={[styles.emptySubtitle, {color: colors.secondaryText}]}>Nội dung được chia sẻ trong cuộc trò chuyện sẽ xuất hiện tại đây.</Text>
    </View>
  );
}

async function roomInfoFromMatrixRoom(room: Room): Promise<RoomInfoState> {
  const client = matrixClientService.currentClient;
  const service = new RoomService(client);
  const directUserId = service.getDirectUserId(room);
  const powerContent = room.currentState.getStateEvents('m.room.power_levels', '')?.getContent?.() as {users?: Record<string, number | string>; users_default?: number | string; state_default?: number | string; events?: Record<string, number | string>; invite?: number | string; kick?: number | string} | undefined;
  const creator = String(room.currentState.getStateEvents('m.room.create', '')?.getContent?.()?.creator ?? '');
  const ownUserId = client.getUserId() ?? '';
  const ownMember = room.getMember(ownUserId);
  const ownPowerLevel = numberValue(ownMember?.powerLevel, powerLevelForMember(ownUserId, powerContent, creator));
  const stateDefault = numberValue(powerContent?.state_default, 50);
  const editLevel = Math.max(
    numberValue(powerContent?.events?.['m.room.name'], stateDefault),
    numberValue(powerContent?.events?.['m.room.avatar'], stateDefault),
    numberValue(powerContent?.events?.['m.room.topic'], stateDefault),
  );
  const inviteLevel = numberValue(powerContent?.invite, 0);
  const kickLevel = numberValue(powerContent?.kick, 50);
  const productEditLevel = Math.max(50, editLevel);
  const members = room.getJoinedMembers().map(member => ({
    userId: member.userId,
    displayName: member.name,
    avatarUrl: mediaUrl(member.getMxcAvatarUrl?.() ?? member.events.member?.getContent()?.avatar_url),
    powerLevel: numberValue(member.powerLevel, powerLevelForMember(member.userId, powerContent, creator)),
    role: roleFromPowerLevel(numberValue(member.powerLevel, powerLevelForMember(member.userId, powerContent, creator))),
  }));
  const directMember = directUserId ? members.find(member => member.userId === directUserId) : undefined;
  const isOnline = directUserId ? await userIsOnline(client, directUserId).catch(() => false) : undefined;
  return {
    roomId: room.roomId,
    name: directMember?.displayName || room.name || room.roomId,
    avatarUrl: directMember?.avatarUrl || mediaUrl(room.getMxcAvatarUrl?.()),
    encrypted: service.isEncrypted(room),
    isDirect: Boolean(directUserId),
    joinedMembersCount: members.length,
    invitedMembersCount: room.currentState.getMembers().filter(member => member.membership === 'invite').length,
    members: directMember ? [directMember] : members,
    timeline: room.timeline.map(event => new MessageService(client).mapTimelineEvent(event)).filter((item): item is TimelineItem => Boolean(item)),
    ownPowerLevel,
    canEditRoom: ownPowerLevel >= productEditLevel,
    canInvite: room.canInvite(ownUserId) || ownPowerLevel >= inviteLevel,
    canKick: ownPowerLevel >= kickLevel,
    isOnline,
  };
}

function filterMedia(items: TimelineItem[]) {
  return items.filter(item => item.messageKind === 'image' || item.messageKind === 'video');
}

function expandMediaItems(items: TimelineItem[]): TimelineItem[] {
  return items.flatMap(item => {
    if (!item.mediaItems?.length) {
      return [item];
    }
    return item.mediaItems.map(media => ({
      ...item,
      id: media.id,
      messageKind: media.kind === 'video' ? 'video' : 'image',
      mediaUrl: media.mediaUrl,
      mediaHeaders: media.mediaHeaders,
      mediaSourceJson: media.mediaSourceJson,
      mediaFileName: media.mediaFileName,
      mediaMimeType: media.mediaMimeType,
      mediaItems: undefined,
    }));
  });
}

function isTimelineMedia(item: TimelineItem): boolean {
  return item.messageKind === 'image' || item.messageKind === 'video';
}

function filterFiles(items: TimelineItem[]) {
  return items.filter(item => item.messageKind === 'file' || item.messageKind === 'audio');
}

function filterPolls(items: TimelineItem[]) {
  return items.filter(item => item.messageKind === 'poll');
}

function mediaUrl(uri?: string | null): string | undefined {
  if (!uri) {
    return undefined;
  }
  return (matrixClientService.currentClient as any).mxcUrlToHttp?.(uri, 240, 240, 'crop', false, true)
    ?? (matrixClientService.currentClient as any).mxcUrlToHttp?.(uri, 240, 240, 'crop')
    ?? undefined;
}

async function userIsOnline(client: any, userId: string): Promise<boolean> {
  const presence = await client.getPresence?.(userId);
  return presence?.currently_active === true || presence?.presence === 'online';
}

async function loadRoomMuted(roomId: string): Promise<boolean> {
  if (nativeMatrixService.isActive()) {
    return nativeMatrixService.getRoomMuted(roomId);
  }
  const content = (matrixClientService.currentClient as any).getAccountData?.(ECLO_EVENT.mute)?.getContent?.() as {rooms?: Record<string, boolean>} | undefined;
  return Boolean(content?.rooms?.[roomId]);
}

async function setRoomMuted(roomId: string, muted: boolean): Promise<void> {
  if (nativeMatrixService.isActive()) {
    await nativeMatrixService.setRoomMuted(roomId, muted);
    return;
  }
  const client = matrixClientService.currentClient as any;
  const content = client.getAccountData?.(ECLO_EVENT.mute)?.getContent?.() as {rooms?: Record<string, boolean>} | undefined;
  const rooms = {...(content?.rooms ?? {})};
  if (muted) {
    rooms[roomId] = true;
  } else {
    delete rooms[roomId];
  }
  await client.setAccountData(ECLO_EVENT.mute, {rooms});
}

async function loadRoomPinned(roomId: string): Promise<boolean> {
  if (nativeMatrixService.isActive()) {
    return nativeMatrixService.getRoomPinned(roomId);
  }
  const client = matrixClientService.currentClient as any;
  const tags = await client.getRoomTags?.(roomId).catch(() => undefined);
  if (tags?.tags) {
    return Boolean(tags.tags['m.favourite']);
  }
  const room = client.getRoom?.(roomId);
  const accountTags = room?.getAccountData?.('m.tag')?.getContent?.()?.tags;
  return Boolean(accountTags?.['m.favourite']);
}

async function setRoomPinned(roomId: string, pinned: boolean): Promise<void> {
  if (nativeMatrixService.isActive()) {
    await nativeMatrixService.setRoomPinned(roomId, pinned);
    return;
  }
  const client = matrixClientService.currentClient as any;
  if (pinned) {
    await client.setRoomTag(roomId, 'm.favourite', {order: -Date.now()});
  } else {
    await client.deleteRoomTag(roomId, 'm.favourite');
  }
}

async function loadPinnedIds(roomId: string): Promise<string[]> {
  if (nativeMatrixService.isActive()) {
    return nativeMatrixService.getPinnedEventIds(roomId);
  }
  const content = matrixClientService.currentClient.getRoom(roomId)?.currentState.getStateEvents('m.room.pinned_events', '')?.getContent?.() as {pinned?: string[]} | undefined;
  return content?.pinned ?? [];
}

async function localMediaUri(item: TimelineItem): Promise<string> {
  const uri = await resolveMatrixMediaUri(item);
  if (!uri) {
    throw new Error('Không có nội dung để hiển thị.');
  }
  if (uri.startsWith('file://')) {
    return uri;
  }
  const extension = extensionForMedia(item);
  const target = `${RNFS.CachesDirectoryPath}/eclo-save-${item.id.replace(/[^a-z0-9_-]+/gi, '_')}.${extension}`;
  await RNFS.downloadFile({
    fromUrl: uri,
    toFile: target,
    headers: item.mediaHeaders,
  }).promise;
  return `file://${target}`;
}

function extensionForMedia(item: TimelineItem): string {
  const nameExt = item.mediaFileName?.split('.').pop()?.toLowerCase();
  if (nameExt && /^[a-z0-9]{2,5}$/.test(nameExt)) {
    return nameExt;
  }
  if (item.mediaMimeType?.includes('png')) {
    return 'png';
  }
  if (item.mediaMimeType?.includes('webp')) {
    return 'webp';
  }
  if (item.mediaMimeType?.includes('gif')) {
    return 'gif';
  }
  if (item.messageKind === 'video' || item.mediaMimeType?.includes('mp4')) {
    return 'mp4';
  }
  return 'jpg';
}

function compactUserId(userId: string): string {
  return userId.replace(/^@/, '').split(':')[0] || userId;
}

function normalizeMemberUserId(value: string | undefined, ownUserId: string): string {
  const clean = (value ?? '').trim();
  if (!clean) {
    return '';
  }
  if (clean.startsWith('@') && clean.includes(':')) {
    return clean;
  }
  const server = ownUserId.split(':')[1];
  return server ? `@${clean.replace(/^@/, '').replace(/:.+$/, '')}:${server}` : clean;
}

function powerLevelForMember(userId: string, powerContent: {users?: Record<string, number | string>; users_default?: number | string} | undefined, creator: string): number {
  const explicit = powerContent?.users?.[userId];
  const parsedExplicit = numberValue(explicit, Number.NaN);
  if (Number.isFinite(parsedExplicit)) {
    return parsedExplicit;
  }
  if (creator && userId === creator) {
    return 100;
  }
  return numberValue(powerContent?.users_default, 0);
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

function roleFromPowerLevel(powerLevel: number): string {
  if (powerLevel >= 100) {
    return 'Trưởng nhóm';
  }
  if (powerLevel >= 50) {
    return 'Phó nhóm';
  }
  return 'Thành viên';
}

function emptyTextForPreview(route: 'RoomMedia' | 'RoomFiles' | 'RoomPolls' | 'RoomPinned') {
  if (route === 'RoomMedia') {
    return 'Chưa có ảnh/video';
  }
  if (route === 'RoomFiles') {
    return 'Chưa có file';
  }
  if (route === 'RoomPinned') {
    return 'Chưa có tin nhắn ghim';
  }
  return 'Chưa có bình chọn';
}

function formatDateTime(timestamp: number) {
  return new Date(timestamp).toLocaleString([], {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'});
}

const styles = StyleSheet.create({
  screen: {flex: 1},
  content: {paddingHorizontal: 12, gap: 12},
  detailContent: {paddingHorizontal: 12, gap: 10},
  detailEmptyContent: {flexGrow: 1, paddingHorizontal: 12},
  heroCard: {
    minHeight: 190,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingTop: 4,
    paddingBottom: 10,
  },
  heroAvatarWrap: {width: 94, height: 94, alignItems: 'center', justifyContent: 'center'},
  statusDot: {position: 'absolute', right: 2, bottom: 10, width: 20, height: 20, borderRadius: 10, borderWidth: 3},
  name: {fontSize: 22, lineHeight: 27, fontWeight: '900', textAlign: 'center'},
  typePill: {height: 22, borderRadius: 11, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center'},
  typePillText: {color: '#fff', fontSize: 11, lineHeight: 14, fontWeight: '900'},
  editGroupButton: {height: 34, borderRadius: 17, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', marginTop: 4},
  editGroupText: {fontSize: 13, lineHeight: 17, fontWeight: '900'},
  quickActions: {minHeight: 104, flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingHorizontal: 4},
  quickAction: {flex: 1, alignItems: 'center', justifyContent: 'center', gap: 7},
  quickActionIcon: {width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center'},
  quickActionLabel: {fontSize: 11, lineHeight: 14, fontWeight: '900'},
  infoGlyphBox: {width: 38, height: 38, alignItems: 'center', justifyContent: 'center'},
  infoGlyphBars: {flexDirection: 'row', alignItems: 'flex-end'},
  searchGlyphCircle: {width: 18, height: 18, borderRadius: 9, borderWidth: 2.6, transform: [{translateX: -2}, {translateY: -2}]},
  searchGlyphHandle: {position: 'absolute', width: 12, height: 3, borderRadius: 1.5, right: 4, bottom: 5, transform: [{rotate: '45deg'}]},
  infoPinHead: {width: 18, height: 10, borderRadius: 3, transform: [{rotate: '45deg'}]},
  infoPinStem: {width: 4, height: 16, borderRadius: 2, marginTop: -1, transform: [{rotate: '45deg'}]},
  infoPinNeedle: {width: 2.5, height: 11, borderRadius: 1.25, marginTop: -6, transform: [{rotate: '45deg'}]},
  bellGlyphTop: {width: 19, height: 20, borderTopWidth: 2.4, borderLeftWidth: 2.4, borderRightWidth: 2.4, borderRadius: 10},
  bellGlyphBase: {width: 24, height: 3, borderRadius: 1.5, marginTop: -3},
  bellGlyphDot: {width: 5, height: 5, borderRadius: 2.5, marginTop: 2},
  bellGlyphSlash: {position: 'absolute', width: 30, height: 3, borderRadius: 1.5, transform: [{rotate: '-42deg'}]},
  pollBar: {width: 5, borderRadius: 3, marginHorizontal: 2, alignSelf: 'flex-end'},
  audioGlyphHead: {width: 13, height: 18, borderRadius: 7, borderWidth: 2.4},
  audioGlyphStem: {width: 3, height: 7, borderRadius: 1.5, marginTop: -1},
  audioGlyphBase: {width: 17, height: 3, borderRadius: 1.5, marginTop: 1},
  photoGlyphFrame: {width: 28, height: 24, borderRadius: 7, borderWidth: 2.3},
  photoGlyphSun: {position: 'absolute', right: 5, top: 5, width: 5, height: 5, borderRadius: 2.5},
  photoGlyphMountain: {position: 'absolute', left: 4, right: 4, bottom: 4, height: 9, borderLeftWidth: 2.2, borderBottomWidth: 2.2, transform: [{rotate: '-45deg'}]},
  groupGlyphMain: {width: 16, height: 16, borderRadius: 8, borderWidth: 2.4, marginTop: -8},
  groupGlyphSide: {position: 'absolute', bottom: 7, width: 14, height: 14, borderRadius: 7, borderWidth: 2.2},
  groupGlyphLeft: {left: 5},
  groupGlyphRight: {right: 5},
  fileGlyphPage: {width: 22, height: 28, borderRadius: 4, borderWidth: 2.2},
  fileGlyphFold: {position: 'absolute', right: 6, top: 2, width: 9, height: 9, borderTopWidth: 2.2, borderRightWidth: 2.2},
  infoCard: {borderRadius: 24, padding: 14, gap: 12, overflow: 'hidden'},
  memberSummaryRow: {minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12},
  memberSummaryIcon: {width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center'},
  memberSummaryBody: {flex: 1, minWidth: 0},
  memberSummaryTitle: {fontSize: 16, lineHeight: 21, fontWeight: '900'},
  memberSummarySubtitle: {fontSize: 13, lineHeight: 18, fontWeight: '700', marginTop: 2},
  cardHeader: {height: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  cardTitle: {fontSize: 12, lineHeight: 16, fontWeight: '900'},
  seeAll: {fontSize: 13, lineHeight: 16, fontWeight: '900'},
  softPill: {height: 22, borderRadius: 11, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center'},
  softPillText: {fontSize: 11, lineHeight: 14, fontWeight: '900'},
  linkBox: {borderRadius: 18, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 12},
  qrPlaceholder: {width: 72, height: 72, borderRadius: 14, alignItems: 'center', justifyContent: 'center'},
  qrRow: {flex: 1, flexDirection: 'row', alignSelf: 'stretch'},
  qrCell: {flex: 1},
  qrText: {fontSize: 18, fontWeight: '900'},
  linkBody: {flex: 1, gap: 10},
  linkText: {fontSize: 13, lineHeight: 18, fontWeight: '800'},
  copyButton: {height: 34, borderRadius: 17, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start'},
  copyText: {color: '#fff', fontSize: 13, lineHeight: 17, fontWeight: '900'},
  previewList: {gap: 8},
  previewMediaGrid: {minHeight: 72, flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  previewImage: {width: 72, height: 72, borderRadius: 16, overflow: 'hidden'},
  previewRow: {height: 50, borderRadius: 16, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10},
  previewIconWrap: {width: 30, height: 30, alignItems: 'center', justifyContent: 'center'},
  previewText: {flex: 1, fontSize: 14, lineHeight: 18, fontWeight: '800'},
  previewCount: {fontSize: 11, lineHeight: 14, fontWeight: '800'},
  emptyPreview: {height: 68, borderRadius: 16, alignItems: 'center', justifyContent: 'center'},
  emptyPreviewText: {fontSize: 13, lineHeight: 18, fontWeight: '800'},
  section: {fontSize: 12, lineHeight: 16, fontWeight: '900', textTransform: 'uppercase', marginTop: 6, marginLeft: 4},
  memberRow: {height: 62, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4},
  memberBody: {flex: 1, height: '100%', justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth},
  memberName: {fontSize: 16, lineHeight: 20, fontWeight: '800'},
  memberId: {fontSize: 13, lineHeight: 17, fontWeight: '700', marginTop: 2},
  memberPageHeader: {gap: 10, paddingBottom: 2},
  memberHeaderRow: {minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12},
  memberPageTitle: {fontSize: 26, lineHeight: 32, fontWeight: '900', marginLeft: 4},
  memberAddButton: {height: 40, minWidth: 88, borderRadius: 20, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center'},
  memberAddText: {color: '#fff', fontSize: 14, lineHeight: 18, fontWeight: '900'},
  memberSearchInput: {height: 50, borderRadius: 18, paddingHorizontal: 14, fontSize: 16, fontWeight: '800'},
  inviteRow: {height: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4},
  inviteButton: {height: 34, minWidth: 58, borderRadius: 17, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center'},
  inviteButtonText: {color: '#fff', fontSize: 13, lineHeight: 17, fontWeight: '900'},
  memberRemoveButton: {width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center'},
  memberRemoveText: {fontSize: 24, lineHeight: 28, fontWeight: '700'},
  dangerRow: {borderRadius: 20, paddingHorizontal: 16, paddingVertical: 14},
  dangerTitleRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12},
  dangerTitle: {fontSize: 15, lineHeight: 20, fontWeight: '900'},
  dangerSubtitle: {fontSize: 13, lineHeight: 18, fontWeight: '700', marginTop: 3},
  mediaTileButton: {borderRadius: 20, margin: 4, overflow: 'hidden'},
  mediaTile: {width: '100%', height: '100%', borderRadius: 20, overflow: 'hidden'},
  mediaTileEmpty: {alignItems: 'center', justifyContent: 'center'},
  viewerScreen: {flex: 1},
  viewerHeader: {
    position: 'absolute',
    left: 14,
    right: 14,
    top: 0,
    minHeight: 58,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  viewerCircleButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(15,20,30,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.20)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerButtonText: {color: '#fff', fontSize: 36, lineHeight: 38, fontWeight: '500'},
  viewerTitlePill: {flex: 1, height: 38, borderRadius: 19, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(15,20,30,0.88)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)'},
  viewerTitle: {color: '#fff', textAlign: 'center', fontSize: 15, lineHeight: 19, fontWeight: '900'},
  viewerSaveButton: {
    minWidth: 76,
    height: 48,
    borderRadius: 24,
    paddingHorizontal: 13,
    backgroundColor: 'rgba(15,20,30,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.20)',
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerSaveText: {color: '#fff', fontSize: 14, lineHeight: 18, fontWeight: '900'},
  viewerPage: {flex: 1, backgroundColor: '#000'},
  viewerTapArea: {flex: 1, width: '100%', height: '100%'},
  viewerImage: {width: '100%', height: '100%'},
  viewerPlaceholder: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 10},
  viewerPlaceholderTitle: {color: '#fff', fontSize: 20, lineHeight: 25, fontWeight: '900'},
  viewerPlaceholderText: {color: 'rgba(255,255,255,0.72)', fontSize: 14, lineHeight: 20, fontWeight: '700', textAlign: 'center'},
  viewerError: {position: 'absolute', left: 18, right: 18, color: '#fff', backgroundColor: 'rgba(255,59,48,0.72)', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, overflow: 'hidden', textAlign: 'center', fontWeight: '800'},
  viewerNavButton: {
    position: 'absolute',
    top: '45%',
    width: 48,
    height: 58,
    borderRadius: 24,
    backgroundColor: 'rgba(15,20,30,0.90)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.20)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerNavLeft: {left: 12},
  viewerNavRight: {right: 12},
  detailRow: {borderRadius: 20, minHeight: 66, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12},
  detailIcon: {width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center'},
  detailBody: {flex: 1, minWidth: 0},
  detailTitle: {fontSize: 15, lineHeight: 20, fontWeight: '900'},
  detailSubtitle: {fontSize: 12, lineHeight: 16, fontWeight: '700', marginTop: 2},
  chevron: {fontSize: 24, fontWeight: '300'},
  pollDetailsContent: {paddingHorizontal: 12, gap: 12},
  pollDetailsHero: {borderRadius: 24, padding: 16, gap: 10, alignItems: 'center'},
  pollDetailsIcon: {width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center'},
  pollDetailsQuestion: {fontSize: 20, lineHeight: 26, fontWeight: '900', textAlign: 'center'},
  pollDetailsMeta: {fontSize: 12, lineHeight: 16, fontWeight: '700'},
  pollDetailsOption: {borderRadius: 22, padding: 14, gap: 10, overflow: 'hidden'},
  pollDetailsOptionHeader: {flexDirection: 'row', alignItems: 'center', gap: 9},
  pollDetailsNumber: {width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center'},
  pollDetailsNumberText: {fontSize: 12, fontWeight: '900'},
  pollDetailsAnswer: {flex: 1, fontSize: 15, lineHeight: 20, fontWeight: '900'},
  pollDetailsPercentage: {fontSize: 15, lineHeight: 20, fontWeight: '900'},
  pollProgressTrack: {height: 9, borderRadius: 5, overflow: 'hidden'},
  pollProgressFill: {height: '100%', borderRadius: 5},
  pollDetailsCount: {fontSize: 12, lineHeight: 16, fontWeight: '800'},
  pollVotersList: {gap: 0},
  pollVoterRow: {minHeight: 48, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8},
  pollVoterBody: {flex: 1},
  pollVoterName: {fontSize: 14, lineHeight: 18, fontWeight: '800'},
  pollVoterId: {fontSize: 11, lineHeight: 15, fontWeight: '600', marginTop: 1},
  pollNoVoters: {fontSize: 12, lineHeight: 17, fontWeight: '700', paddingVertical: 8},
  emptyDetail: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20},
  emptyTitle: {fontSize: 18, lineHeight: 23, fontWeight: '900'},
  emptySubtitle: {fontSize: 14, lineHeight: 21, fontWeight: '700', textAlign: 'center', marginTop: 6},
  editContent: {paddingHorizontal: 12, gap: 12},
  editHero: {borderRadius: 26, padding: 18, alignItems: 'center', gap: 12},
  editAvatarButton: {width: 108, height: 108, borderRadius: 54, alignItems: 'center', justifyContent: 'center'},
  editCameraDot: {position: 'absolute', right: 4, bottom: 8, width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center'},
  editCameraText: {color: '#fff', fontSize: 16, lineHeight: 20, fontWeight: '900'},
  editAvatarHint: {fontSize: 13, lineHeight: 18, fontWeight: '700', textAlign: 'center'},
  editCard: {borderRadius: 22, padding: 14, gap: 12},
  editLabel: {fontSize: 12, lineHeight: 16, fontWeight: '900'},
  editInput: {height: 52, borderRadius: 17, paddingHorizontal: 14, fontSize: 16, fontWeight: '800'},
  saveButton: {height: 50, borderRadius: 18, alignItems: 'center', justifyContent: 'center'},
  saveText: {color: '#fff', fontSize: 15, lineHeight: 20, fontWeight: '900'},
  error: {borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, overflow: 'hidden', fontWeight: '800', marginBottom: 10},
  disabled: {opacity: 0.52},
  pressed: {opacity: 0.72},
});
