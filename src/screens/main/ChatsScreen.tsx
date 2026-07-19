import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {FlatList, Platform, Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {Image as ImageIcon, MessageCircle, Search, ShieldCheck, UserPlus, Users} from 'lucide-react-native';
import {useSafeAreaInsets} from '../../platform/safeArea';
import type {NativeBottomTabScreenProps} from '@bottom-tabs/react-navigation';
import type {CompositeScreenProps} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {Room} from 'matrix-js-sdk';
import {matrixClientService} from '../../core/matrix/MatrixClientService';
import {RoomService} from '../../core/matrix/RoomService';
import {matrixErrorMessage} from '../../core/matrix/errors';
import {nativeMatrixService, type NativeRoomSummary} from '../../core/matrix/NativeMatrixService';
import type {MainTabParamList, RootStackParamList} from '../../navigation/RootNavigator';
import {useSession} from '../../context/SessionContext';
import {demoStore, type DemoRoom} from '../../core/demo/demoStore';
import {useAppTheme} from '../../theme/useAppTheme';
import {MatrixAvatar} from '../../components/MatrixAvatar';
import {GlassSurface} from '../../components/GlassSurface';
import {normalizeRoomListPreview, roomListPreviewFromContent} from '../../core/matrix/MessageService';
import {shortContactId} from '../../core/matrix/ContactService';

type Props = CompositeScreenProps<
  NativeBottomTabScreenProps<MainTabParamList, 'Chats'>,
  NativeStackScreenProps<RootStackParamList>
>;
type RoomRow = Room | DemoRoom | NativeRoomSummary;
type ChatListItem = {kind: 'room'; room: RoomRow};
type ProfilePreview = {displayName?: string; avatarUrl?: string};

export function ChatsScreen({navigation}: Props) {
  const colors = useAppTheme();
  const insets = useSafeAreaInsets();
  const {state} = useSession();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [demoRooms, setDemoRooms] = useState<DemoRoom[]>(demoStore.listRooms());
  const [nativeRooms, setNativeRooms] = useState<NativeRoomSummary[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [hydrating, setHydrating] = useState(false);
  const [profile, setProfile] = useState<ProfilePreview>({});
  const refreshInFlight = useRef(false);
  const hasHydratedRef = useRef(false);
  const usingNative = state.status === 'signed_in' && nativeMatrixService.isActive();

  const refresh = useCallback(() => {
    if (usingNative) {
      if (refreshInFlight.current) {
        return;
      }
      refreshInFlight.current = true;
      if (!hasHydratedRef.current) {
        setHydrating(true);
      }
      nativeMatrixService.listRooms()
        .then(nextRooms => {
          setNativeRooms(current => sameNativeRoomList(current, nextRooms) ? current : nextRooms);
          hasHydratedRef.current = true;
        })
        .catch(err => setError(matrixErrorMessage(err)))
        .finally(() => {
          refreshInFlight.current = false;
          setHydrating(false);
        });
      return;
    }
    setRooms(matrixClientService.getJoinedRooms());
    setHydrating(false);
  }, [usingNative]);

  useEffect(() => {
    if (state.status === 'demo') {
      const unsubscribe = demoStore.subscribe(() => setDemoRooms(demoStore.listRooms()));
      setDemoRooms(demoStore.listRooms());
      return unsubscribe;
    }
    if (usingNative) {
      const cached = nativeMatrixService.getCachedRooms();
      if (cached.length) {
        setNativeRooms(cached);
        hasHydratedRef.current = true;
        setHydrating(false);
      } else if (!hasHydratedRef.current) {
        setHydrating(true);
      }
      nativeMatrixService.getOwnProfile().then(setProfile).catch(() => undefined);
      refresh();
      return nativeMatrixService.subscribeRooms(() => {
        const nextRooms = nativeMatrixService.getCachedRooms();
        setNativeRooms(current => sameNativeRoomList(current, nextRooms) ? current : nextRooms);
        hasHydratedRef.current = true;
        setHydrating(false);
      });
    }
    refresh();
    const client = matrixClientService.currentClient;
    (client as any).on('Room.timeline', refresh);
    (client as any).on('Room.name', refresh);
    return () => {
      (client as any).removeListener('Room.timeline', refresh);
      (client as any).removeListener('Room.name', refresh);
    };
  }, [refresh, state.status]);

  function openSheet() {
    navigation.navigate('NewChat');
  }

  function lastTimestampForRoom(item: RoomRow) {
    if (state.status === 'demo') {
      return demoStore.getMessages(item.roomId).at(-1)?.timestamp ?? 0;
    }
    if (usingNative) {
      return (item as NativeRoomSummary).lastTimestamp ?? 0;
    }
    const room = item as Room;
    return room.getLastActiveTimestamp?.() ?? room.timeline.at(-1)?.getTs() ?? 0;
  }

  function latestEventForRoom(item: RoomRow) {
    if (state.status === 'demo' || usingNative) {
      return undefined;
    }
    return (item as Room).timeline.at(-1);
  }

  function previewForRoom(item: RoomRow) {
    if (state.status === 'demo') {
      return demoStore.getMessages(item.roomId).at(-1)?.body ?? 'Chưa có tin nhắn';
    }
    if (usingNative) {
      const nativeRoom = item as NativeRoomSummary;
      return normalizeRoomListPreview(nativeRoom.lastMessage) || (nativeRoom.encrypted ? 'Tin nhắn chưa hiển thị' : 'Chưa có tin nhắn');
    }
    const event = latestEventForRoom(item);
    const clear = event?.getClearContent?.() ?? event?.getContent?.();
    const contentPreview = roomListPreviewFromContent(event?.getType(), clear as Record<string, unknown> | undefined);
    if (contentPreview) return contentPreview;
    if (event?.getType() === 'm.room.encrypted') {
      return 'Tin nhắn chưa hiển thị';
    }
    return 'Chưa có tin nhắn';
  }

  function unreadCountForRoom(item: RoomRow) {
    if (state.status === 'demo') {
      return 0;
    }
    if (usingNative) {
      return (item as NativeRoomSummary).unreadCount ?? 0;
    }
    const room = item as Room & {getUnreadNotificationCount?: () => number};
    return room.getUnreadNotificationCount?.() ?? 0;
  }

  function pinnedForRoom(item: RoomRow) {
    if (state.status === 'demo') {
      return false;
    }
    if (usingNative) {
      return Boolean((item as NativeRoomSummary).pinned);
    }
    const room = item as any;
    const tags = room.tags ?? room.getAccountData?.('m.tag')?.getContent?.()?.tags;
    return Boolean(tags?.['m.favourite']);
  }

  function formatRoomTime(timestamp: number) {
    if (!timestamp) {
      return '';
    }
    const date = new Date(timestamp);
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    if (startDate === startToday) {
      return date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
    }
    if (startDate === startToday - 24 * 60 * 60 * 1000) {
      return 'Hôm qua';
    }
    if (date.getFullYear() === now.getFullYear()) {
      return `${date.getDate()}/${date.getMonth() + 1}`;
    }
    return `${date.getDate()}/${date.getMonth() + 1}/${String(date.getFullYear()).slice(-2)}`;
  }

  function timeForRoom(item: RoomRow) {
    return formatRoomTime(lastTimestampForRoom(item));
  }

  const data: RoomRow[] = state.status === 'demo' ? demoRooms : usingNative ? nativeRooms : rooms;
  const userLabel = profile.displayName || (state.status === 'signed_in' ? shortContactId(state.auth.userId) : 'ECLO');
  const visibleData = useMemo(() => data.filter(room => shouldShowRoom(room)), [data, state.status, usingNative]);
  const sortedData = useMemo(() => [...visibleData].sort((a, b) => {
    const pinDiff = Number(pinnedForRoom(b)) - Number(pinnedForRoom(a));
    return pinDiff || lastTimestampForRoom(b) - lastTimestampForRoom(a);
  }), [visibleData]);
  const filteredData = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) {
      return sortedData;
    }
    return sortedData.filter(room => (room.name || room.roomId).toLowerCase().includes(keyword));
  }, [search, sortedData]);
  const listData = useMemo<ChatListItem[]>(
    () => filteredData.map(room => ({kind: 'room' as const, room})),
    [filteredData],
  );
  const topControlsOffset = insets.top + 54;

  function shouldShowRoom(item: RoomRow) {
    if (state.status === 'demo') {
      return true;
    }
    if (usingNative) {
      return !(item as NativeRoomSummary).isPendingDirectRequest;
    }
    return !new RoomService(matrixClientService.currentClient).isPendingDirectRequest(item as Room);
  }

  function avatarForRoom(item: RoomRow): string | undefined {
    return usingNative ? (item as NativeRoomSummary).avatarUrl : undefined;
  }

  return (
    <View style={[styles.screen, {backgroundColor: colors.background}]}>
      <FlatList
        data={listData}
        keyExtractor={(item, index) => item.kind === 'room' ? item.room.roomId : item.kind}
        alwaysBounceVertical
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.listContent, {paddingTop: topControlsOffset + 74}]}
        ListEmptyComponent={hydrating ? (
          <LoadingRows colors={colors} />
        ) : (
          <EmptyChats
            colors={colors}
            searching={Boolean(search.trim())}
            onAddFriend={() => navigation.navigate('AddFriend')}
            onCreateGroup={() => navigation.navigate('NewGroup')}
            onNewChat={openSheet}
          />
        )}
        renderItem={({item}) => {
          const room = item.room;
          const unreadCount = unreadCountForRoom(room);
          return (
            <Pressable
              style={({pressed}) => [styles.row, pressed ? styles.pressed : null]}
              onPress={() => navigation.navigate('Chat', {roomId: room.roomId, title: room.name})}>
              <MatrixAvatar label={room.name || room.roomId} uri={avatarForRoom(room)} size={50} backgroundColor={colors.primary} />
              <View style={[styles.rowBody, {borderBottomColor: colors.separator}]}>
                <View style={styles.rowTop}>
                  <Text numberOfLines={1} style={[styles.title, {color: colors.text}]}>{room.name || 'Cuộc trò chuyện'}</Text>
                  <Text style={[styles.time, {color: colors.tertiaryText}]}>{timeForRoom(room)}</Text>
                </View>
                <View style={styles.previewRow}>
                  <Text numberOfLines={1} style={[styles.preview, {color: colors.secondaryText}]}>{previewForRoom(room)}</Text>
                  {pinnedForRoom(room) ? <Text style={[styles.pinBadge, {color: colors.primary}]}>⌖</Text> : null}
                  {unreadCount > 0 ? (
                    <View style={[styles.unreadBadge, {backgroundColor: colors.primary}]}>
                      <Text style={styles.unreadText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </Pressable>
          );
        }}
      />
      <View pointerEvents="box-none" style={[styles.floatingSearch, {top: topControlsOffset}]}>
        <GlassSurface style={[styles.homeHeader, {shadowColor: colors.shadow}]}>
          <MatrixAvatar label={userLabel} uri={profile.avatarUrl} size={42} backgroundColor={colors.primary} />
          <Search color={colors.tertiaryText} size={18} strokeWidth={2.2} />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Tìm cuộc trò chuyện"
            placeholderTextColor={colors.tertiaryText}
            selectionColor={colors.primary}
            style={[styles.search, {color: colors.text, fontFamily: Platform.OS === 'ios' ? 'System' : colors.fontFamily}]}
            value={search}
            onChangeText={setSearch}
          />
          <Pressable accessibilityRole="button" onPress={openSheet} style={({pressed}) => [styles.addButton, {backgroundColor: colors.primary}, pressed ? styles.pressed : null]}>
            <Text style={styles.addButtonText}>+</Text>
          </Pressable>
        </GlassSurface>
        {error ? <Text style={[styles.error, {backgroundColor: colors.dangerSoft, color: colors.danger}]}>{error}</Text> : null}
      </View>
    </View>
  );
}

function EmptyChats({
  colors,
  onAddFriend,
  onCreateGroup,
  onNewChat,
  searching,
}: {
  colors: ReturnType<typeof useAppTheme>;
  onAddFriend: () => void;
  onCreateGroup: () => void;
  onNewChat: () => void;
  searching: boolean;
}) {
  if (searching) {
    return (
      <View style={styles.searchEmpty}>
        <Search color={colors.tertiaryText} size={34} strokeWidth={1.8} />
        <Text style={[styles.emptyTitle, {color: colors.text}]}>Không tìm thấy hội thoại</Text>
        <Text style={[styles.emptyText, {color: colors.secondaryText}]}>Thử một tên hoặc từ khóa khác.</Text>
      </View>
    );
  }

  return (
    <View style={styles.emptyPage}>
      <View style={[styles.emptyHeroIcon, {backgroundColor: colors.primary}]}>
        <MessageCircle color="#fff" fill="rgba(255,255,255,0.16)" size={38} strokeWidth={2.2} />
      </View>
      <Text style={[styles.emptyHeroTitle, {color: colors.text}]}>Bắt đầu trò chuyện</Text>
      <Text style={[styles.emptyHeroText, {color: colors.secondaryText}]}>Tin nhắn, hình ảnh và cuộc trò chuyện của bạn sẽ xuất hiện tại đây.</Text>

      <Text style={[styles.emptySectionTitle, {color: colors.tertiaryText}]}>BẮT ĐẦU NHANH</Text>
      <View style={styles.emptyActions}>
        <EmptyAction colors={colors} icon={<MessageCircle color={colors.primary} size={22} />} title="Tin nhắn mới" subtitle="Tìm người và bắt đầu nhắn tin" onPress={onNewChat} />
        <EmptyAction colors={colors} icon={<UserPlus color="#20a4d8" size={22} />} title="Thêm bạn bè" subtitle="Tìm người và gửi lời mời kết bạn" onPress={onAddFriend} />
        <EmptyAction colors={colors} icon={<Users color="#05a98b" size={22} />} title="Tạo nhóm" subtitle="Trò chuyện cùng nhiều người" onPress={onCreateGroup} />
      </View>

      <Text style={[styles.emptySectionTitle, {color: colors.tertiaryText}]}>ECLO CHAT</Text>
      <View style={[styles.emptyInfoCard, {backgroundColor: colors.surface, borderColor: colors.separator}]}>
        <EmptyInfo colors={colors} icon={<ShieldCheck color={colors.success} size={21} />} title="Tin nhắn được bảo vệ" text="Nội dung riêng tư chỉ dành cho những người trong cuộc trò chuyện." />
        <View style={[styles.emptyInfoDivider, {backgroundColor: colors.separator}]} />
        <EmptyInfo colors={colors} icon={<ImageIcon color={colors.primary} size={21} />} title="Chia sẻ mọi khoảnh khắc" text="Gửi nhiều ảnh, video, tin nhắn thoại, tệp và bình chọn." />
      </View>
      <Text style={[styles.emptyFootnote, {color: colors.tertiaryText}]}>Danh sách sẽ tự cập nhật khi có tin nhắn mới.</Text>
    </View>
  );
}

function EmptyAction({colors, icon, onPress, subtitle, title}: {colors: ReturnType<typeof useAppTheme>; icon: React.ReactNode; onPress: () => void; subtitle: string; title: string}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({pressed}) => [styles.emptyAction, {backgroundColor: colors.surface, borderColor: colors.separator}, pressed ? styles.pressed : null]}>
      <View style={[styles.emptyActionIcon, {backgroundColor: colors.input}]}>{icon}</View>
      <View style={styles.emptyActionText}>
        <Text style={[styles.emptyActionTitle, {color: colors.text}]}>{title}</Text>
        <Text style={[styles.emptyActionSubtitle, {color: colors.secondaryText}]}>{subtitle}</Text>
      </View>
      <Text style={[styles.emptyChevron, {color: colors.tertiaryText}]}>›</Text>
    </Pressable>
  );
}

function EmptyInfo({colors, icon, text, title}: {colors: ReturnType<typeof useAppTheme>; icon: React.ReactNode; text: string; title: string}) {
  return (
    <View style={styles.emptyInfoRow}>
      <View style={styles.emptyInfoIcon}>{icon}</View>
      <View style={styles.emptyActionText}>
        <Text style={[styles.emptyInfoTitle, {color: colors.text}]}>{title}</Text>
        <Text style={[styles.emptyInfoText, {color: colors.secondaryText}]}>{text}</Text>
      </View>
    </View>
  );
}

function sameNativeRoomList(current: NativeRoomSummary[], next: NativeRoomSummary[]): boolean {
  return current.length === next.length && current.every((room, index) => {
    const candidate = next[index];
    return candidate?.roomId === room.roomId
      && candidate.name === room.name
      && candidate.lastMessage === room.lastMessage
      && candidate.lastTimestamp === room.lastTimestamp
      && candidate.unreadCount === room.unreadCount
      && candidate.avatarUrl === room.avatarUrl
      && candidate.pinned === room.pinned;
  });
}

function LoadingRows({colors}: {colors: ReturnType<typeof useAppTheme>}) {
  return (
    <View style={styles.loadingList}>
      {[0, 1, 2, 3].map(index => (
        <View key={index} style={styles.loadingRow}>
          <View style={[styles.loadingAvatar, {backgroundColor: index === 0 ? colors.primary : colors.input}]} />
          <View style={[styles.loadingBody, {borderBottomColor: colors.separator}]}>
            <View style={[styles.loadingTitle, {backgroundColor: colors.input, width: index % 2 ? '48%' : '62%'}]} />
            <View style={[styles.loadingLine, {backgroundColor: colors.input, width: index % 2 ? '70%' : '54%'}]} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1},
  listContent: {paddingHorizontal: 16, paddingBottom: 108},
  floatingSearch: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 50,
    elevation: 50,
  },
  homeHeader: {
    minHeight: 58,
    borderRadius: 29,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 8,
    paddingVertical: 8,
    shadowOffset: {width: 0, height: 12},
    shadowOpacity: 0.09,
    shadowRadius: 24,
    elevation: 12,
  },
  userAvatar: {width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center'},
  userAvatarText: {color: '#fff', fontSize: 17, fontWeight: '900'},
  search: {
    flex: 1,
    height: 42,
    borderRadius: 21,
    borderWidth: 0,
    paddingHorizontal: 2,
    fontSize: 16,
    fontWeight: '500',
    letterSpacing: 0,
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  addButton: {width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center'},
  addButtonText: {color: '#fff', fontSize: 30, lineHeight: 34, fontWeight: '400'},
  statusArea: {gap: 8, paddingBottom: 10},
  error: {borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, overflow: 'hidden', fontWeight: '700'},
  row: {minHeight: 74, flexDirection: 'row', alignItems: 'center', gap: 12},
  avatar: {width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center'},
  avatarText: {color: '#fff', fontSize: 20, fontWeight: '900'},
  rowBody: {flex: 1, minHeight: 74, justifyContent: 'center', gap: 4, borderBottomWidth: StyleSheet.hairlineWidth},
  rowTop: {flexDirection: 'row', alignItems: 'center', gap: 8},
  title: {flex: 1, fontSize: 16, fontWeight: '500'},
  time: {fontSize: 12, fontWeight: '600'},
  previewRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  preview: {flex: 1, fontSize: 14, fontWeight: '400'},
  pinBadge: {fontSize: 13, lineHeight: 16, fontWeight: '900'},
  unreadBadge: {minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center'},
  unreadText: {color: '#fff', fontSize: 12, lineHeight: 15, fontWeight: '800'},
  loadingList: {paddingTop: 8},
  loadingRow: {height: 74, flexDirection: 'row', alignItems: 'center', gap: 12},
  loadingAvatar: {width: 50, height: 50, borderRadius: 25, opacity: 0.64},
  loadingBody: {flex: 1, height: 74, justifyContent: 'center', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth},
  loadingTitle: {height: 15, borderRadius: 8, opacity: 0.84},
  loadingLine: {height: 12, borderRadius: 7, opacity: 0.62},
  emptyPage: {paddingHorizontal: 4, paddingTop: 20, paddingBottom: 56, alignItems: 'stretch'},
  emptyHeroIcon: {width: 72, height: 72, borderRadius: 24, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', marginBottom: 15},
  emptyHeroTitle: {fontSize: 24, lineHeight: 30, fontWeight: '900', textAlign: 'center'},
  emptyHeroText: {maxWidth: 340, alignSelf: 'center', fontSize: 14, lineHeight: 21, fontWeight: '600', textAlign: 'center', marginTop: 7},
  emptySectionTitle: {fontSize: 12, lineHeight: 16, fontWeight: '900', marginTop: 28, marginBottom: 9, marginLeft: 4},
  emptyActions: {gap: 9},
  emptyAction: {minHeight: 72, borderWidth: StyleSheet.hairlineWidth, borderRadius: 20, paddingHorizontal: 13, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12},
  emptyActionIcon: {width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center'},
  emptyActionText: {flex: 1, minWidth: 0},
  emptyActionTitle: {fontSize: 16, lineHeight: 21, fontWeight: '800'},
  emptyActionSubtitle: {fontSize: 12, lineHeight: 17, fontWeight: '600', marginTop: 2},
  emptyChevron: {fontSize: 27, lineHeight: 30, fontWeight: '300'},
  emptyInfoCard: {borderWidth: StyleSheet.hairlineWidth, borderRadius: 20, overflow: 'hidden'},
  emptyInfoRow: {minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 15, paddingVertical: 11},
  emptyInfoIcon: {width: 30, alignItems: 'center'},
  emptyInfoTitle: {fontSize: 14, lineHeight: 19, fontWeight: '800'},
  emptyInfoText: {fontSize: 12, lineHeight: 17, fontWeight: '600', marginTop: 2},
  emptyInfoDivider: {height: StyleSheet.hairlineWidth, marginLeft: 57},
  emptyFootnote: {fontSize: 11, lineHeight: 17, fontWeight: '600', textAlign: 'center', marginTop: 18, paddingHorizontal: 16},
  searchEmpty: {paddingTop: 82, paddingHorizontal: 24, alignItems: 'center'},
  emptyTitle: {fontSize: 18, fontWeight: '900', marginTop: 12},
  emptyText: {fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 6},
  sheet: {
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 34,
    shadowOffset: {width: 0, height: -8},
    shadowOpacity: 0.12,
    shadowRadius: 22,
    elevation: 18,
  },
  sheetHandle: {width: 42, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 14},
  sheetTopRow: {height: 28, justifyContent: 'center', marginBottom: 2},
  sheetBack: {fontSize: 15, fontWeight: '800'},
  sheetTitle: {fontSize: 22, fontWeight: '900', marginBottom: 8},
  sheetRow: {height: 68, flexDirection: 'row', alignItems: 'center', gap: 12},
  sheetIcon: {width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center'},
  sheetIconText: {fontSize: 20, fontWeight: '900'},
  sheetText: {flex: 1},
  sheetRowTitle: {fontSize: 16, fontWeight: '900'},
  sheetRowSub: {fontSize: 13, marginTop: 2, fontWeight: '600'},
  sheetChevron: {fontSize: 24},
  joinHelp: {fontSize: 14, lineHeight: 20, fontWeight: '600', marginBottom: 12},
  formBox: {borderRadius: 18, padding: 12, marginTop: 10},
  fieldLabel: {fontSize: 12, fontWeight: '900', textTransform: 'uppercase', marginBottom: 8},
  fieldInput: {height: 42, fontSize: 15, fontWeight: '700'},
  multiInput: {height: 78, paddingTop: 0, textAlignVertical: 'top'},
  primaryButton: {height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginTop: 14},
  primaryButtonText: {color: '#fff', fontSize: 15, fontWeight: '900'},
  joinBox: {borderRadius: 18, padding: 12, marginTop: 8},
  joinLabel: {fontSize: 12, fontWeight: '900', textTransform: 'uppercase', marginBottom: 8},
  joinRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  joinInput: {flex: 1, height: 42, fontSize: 14, fontWeight: '700'},
  joinButton: {height: 38, borderRadius: 19, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center'},
  joinButtonText: {color: '#fff', fontWeight: '900'},
  pressed: {opacity: 0.74},
});
