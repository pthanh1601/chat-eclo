import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {FlatList, Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {useSafeAreaInsets} from '../../platform/safeArea';
import type {NativeBottomTabScreenProps} from '@bottom-tabs/react-navigation';
import {useIsFocused, type CompositeScreenProps} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {Room} from 'matrix-js-sdk';
import {matrixClientService} from '../../core/matrix/MatrixClientService';
import {RoomService, type GroupRequest} from '../../core/matrix/RoomService';
import {matrixErrorMessage} from '../../core/matrix/errors';
import {nativeMatrixService, type NativeGroupRequest, type NativeRoomSummary} from '../../core/matrix/NativeMatrixService';
import type {MainTabParamList, RootStackParamList} from '../../navigation/RootNavigator';
import {useSession} from '../../context/SessionContext';
import {demoStore, type DemoRoom} from '../../core/demo/demoStore';
import {useAppTheme} from '../../theme/useAppTheme';
import {MatrixAvatar} from '../../components/MatrixAvatar';
import {GlassSurface} from '../../components/GlassSurface';
import {normalizeRoomListPreview, roomListPreviewFromContent} from '../../core/matrix/MessageService';

type Props = CompositeScreenProps<
  NativeBottomTabScreenProps<MainTabParamList, 'Groups'>,
  NativeStackScreenProps<RootStackParamList>
>;

type GroupRow = Room | DemoRoom | NativeRoomSummary;
type GroupInvite = GroupRequest | NativeGroupRequest;
type GroupListItem = {kind: 'requests'} | {kind: 'section'} | {kind: 'room'; room: GroupRow};

export function GroupsScreen({navigation}: Props) {
  const colors = useAppTheme();
  const insets = useSafeAreaInsets();
  const {state} = useSession();
  const isFocused = useIsFocused();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [nativeRooms, setNativeRooms] = useState<NativeRoomSummary[]>([]);
  const [demoRooms, setDemoRooms] = useState<DemoRoom[]>(demoStore.listRooms().filter(room => room.kind === 'group'));
  const [requests, setRequests] = useState<GroupInvite[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const usingNative = state.status === 'signed_in' && nativeMatrixService.isActive();

  const refresh = useCallback(async () => {
    if (state.status === 'demo') {
      setDemoRooms(demoStore.listRooms().filter(room => room.kind === 'group'));
      setRequests([]);
      return;
    }
    try {
      if (usingNative) {
        const [groupRooms, groupRequests] = await Promise.all([
          nativeMatrixService.listGroupRooms(),
          nativeMatrixService.listGroupInvites(),
        ]);
        setNativeRooms(groupRooms);
        setRequests(groupRequests);
        return;
      }

      const service = new RoomService(matrixClientService.currentClient);
      setRooms(service.listGroupRooms());
      setRequests(service.listGroupInvites());
    } catch (err) {
      setError(matrixErrorMessage(err));
    }
  }, [state.status, usingNative]);

  useEffect(() => {
    if (!isFocused) {
      return;
    }
    refresh();
    if (state.status === 'demo') {
      return demoStore.subscribe(refresh);
    }
    if (usingNative) {
      return nativeMatrixService.subscribeRooms(refresh);
    }
    const client = matrixClientService.currentClient;
    (client as any).on('Room', refresh);
    (client as any).on('Room.myMembership', refresh);
    (client as any).on('Room.timeline', refresh);
    return () => {
      (client as any).removeListener('Room', refresh);
      (client as any).removeListener('Room.myMembership', refresh);
      (client as any).removeListener('Room.timeline', refresh);
    };
  }, [isFocused, refresh, state.status, usingNative]);

  const data: GroupRow[] = state.status === 'demo' ? demoRooms : usingNative ? nativeRooms : rooms;
  const sortedData = useMemo(() => [...data].sort((a, b) => lastTimestampForRoom(b) - lastTimestampForRoom(a)), [data, state.status, usingNative]);
  const filteredData = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return sortedData;
    }
    return sortedData.filter(room => groupTitle(room).toLowerCase().includes(needle) || room.roomId.toLowerCase().includes(needle));
  }, [query, sortedData]);
  const listData = useMemo<GroupListItem[]>(
    () => [
      {kind: 'requests'},
      {kind: 'section'},
      ...filteredData.map(room => ({kind: 'room' as const, room})),
    ],
    [filteredData],
  );
  const topControlsOffset = insets.top + 54;

  function openSheet() {
    navigation.navigate('NewGroup');
  }

  function groupTitle(room: GroupRow) {
    return room.name || 'Nhóm';
  }

  function groupAvatar(room: GroupRow): string | undefined {
    if (state.status === 'demo') {
      return undefined;
    }
    if (usingNative) {
      return (room as NativeRoomSummary).avatarUrl;
    }
    const matrixRoom = room as Room;
    const mxc = matrixRoom.getMxcAvatarUrl?.();
    if (!mxc) {
      return undefined;
    }
    return (matrixClientService.currentClient as any).mxcUrlToHttp?.(mxc, 160, 160, 'crop', false, true)
      ?? (matrixClientService.currentClient as any).mxcUrlToHttp?.(mxc, 160, 160, 'crop')
      ?? undefined;
  }

  function lastTimestampForRoom(room: GroupRow) {
    if (state.status === 'demo') {
      return demoStore.getMessages(room.roomId).at(-1)?.timestamp ?? 0;
    }
    if (usingNative) {
      return (room as NativeRoomSummary).lastTimestamp ?? 0;
    }
    const matrixRoom = room as Room;
    return matrixRoom.getLastActiveTimestamp?.() ?? matrixRoom.timeline.at(-1)?.getTs() ?? 0;
  }

  function previewForRoom(room: GroupRow) {
    if (state.status === 'demo') {
      return demoStore.getMessages(room.roomId).at(-1)?.body ?? memberLabel(room);
    }
    if (usingNative) {
      const nativeRoom = room as NativeRoomSummary;
      return normalizeRoomListPreview(nativeRoom.lastMessage) || (nativeRoom.encrypted ? 'Tin nhắn chưa hiển thị' : memberLabel(room));
    }
    const event = (room as Room).timeline.at(-1);
    const clear = event?.getClearContent?.() ?? event?.getContent?.();
    const contentPreview = roomListPreviewFromContent(event?.getType(), clear as Record<string, unknown> | undefined);
    if (contentPreview) return contentPreview;
    if (event?.getType() === 'm.room.encrypted') {
      return 'Tin nhắn chưa hiển thị';
    }
    return memberLabel(room);
  }

  function memberLabel(room: GroupRow) {
    if (state.status === 'demo') {
      return 'Nhóm';
    }
    if (usingNative) {
      const count = (room as NativeRoomSummary).joinedMembersCount ?? 0;
      return count ? `${count} thành viên` : 'Nhóm';
    }
    const count = (room as Room).getJoinedMembers().length;
    return count ? `${count} thành viên` : 'Nhóm';
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

  return (
    <View style={[styles.screen, {backgroundColor: colors.background}]}>
      <FlatList
        data={listData}
        keyExtractor={(item, index) => item.kind === 'room' ? item.room.roomId : `${item.kind}-${index}`}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        contentContainerStyle={[styles.listContent, {paddingTop: topControlsOffset + 74}]}
        ListFooterComponent={filteredData.length === 0 ? (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, {color: colors.text}]}>Chưa có nhóm</Text>
            <Text style={[styles.emptyText, {color: colors.secondaryText}]}>Tạo nhóm mới hoặc tham gia bằng mã phòng.</Text>
          </View>
        ) : null}
        renderItem={({item}) => {
          if (item.kind === 'requests') {
            return (
              <View style={styles.requestBlock}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => navigation.navigate('GroupRequests')}
                  style={({pressed}) => [pressed ? styles.pressed : null]}>
                  <GlassSurface style={[styles.requestMenu, {shadowColor: colors.shadow}]}>
                    <View style={[styles.menuIcon, {backgroundColor: colors.dark ? 'rgba(255,255,255,0.10)' : 'rgba(7,113,246,0.10)'}]}>
                      <Text style={[styles.menuIconText, {color: colors.primary}]}>#</Text>
                    </View>
                    <View style={styles.requestBody}>
                      <Text style={[styles.menuTitle, {color: colors.text}]}>Yêu cầu vào nhóm</Text>
                      <Text style={[styles.menuSubtitle, {color: colors.secondaryText}]}>
                        {requests.length ? `${requests.length} lời mời đang chờ` : 'Không có lời mời mới'}
                      </Text>
                    </View>
                    {requests.length ? (
                      <View style={[styles.menuBadge, {backgroundColor: colors.primary}]}>
                        <Text style={styles.menuBadgeText}>{requests.length > 99 ? '99+' : requests.length}</Text>
                      </View>
                    ) : null}
                    <Text style={[styles.chevron, {color: colors.tertiaryText}]}>›</Text>
                  </GlassSurface>
                </Pressable>
              </View>
            );
          }

          if (item.kind === 'section') {
            return <Text style={[styles.sectionTitle, {color: colors.tertiaryText}]}>Nhóm đã tham gia</Text>;
          }

          const room = item.room;
          return (
            <Pressable
              accessibilityRole="button"
              onPress={() => navigation.navigate('Chat', {roomId: room.roomId, title: groupTitle(room)})}
              style={({pressed}) => [styles.row, pressed ? styles.pressed : null]}>
              <MatrixAvatar label={groupTitle(room)} uri={groupAvatar(room)} size={50} backgroundColor={colors.primary} />
              <View style={[styles.rowBody, {borderBottomColor: colors.separator}]}>
                <View style={styles.rowTop}>
                  <Text numberOfLines={1} style={[styles.title, {color: colors.text}]}>{groupTitle(room)}</Text>
                  <Text style={[styles.time, {color: colors.tertiaryText}]}>{formatRoomTime(lastTimestampForRoom(room))}</Text>
                </View>
                <View style={styles.previewRow}>
                  <Text numberOfLines={1} style={[styles.preview, {color: colors.secondaryText}]}>{previewForRoom(room)}</Text>
                  <Text numberOfLines={1} style={[styles.memberText, {color: colors.tertiaryText}]}>{memberLabel(room)}</Text>
                </View>
              </View>
            </Pressable>
          );
        }}
      />
      <View pointerEvents="box-none" style={[styles.floatingSearch, {top: topControlsOffset}]}>
        <GlassSurface style={[styles.searchRow, {shadowColor: colors.shadow}]}>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Tìm nhóm"
            placeholderTextColor={colors.tertiaryText}
            style={[styles.searchInput, {color: colors.text}]}
            value={query}
            onChangeText={setQuery}
          />
          <Pressable accessibilityRole="button" accessibilityLabel="Tạo hoặc tham gia nhóm" onPress={openSheet} style={({pressed}) => [styles.addButton, {backgroundColor: colors.primary}, pressed ? styles.pressed : null]}>
            <Text style={styles.addButtonText}>+</Text>
          </Pressable>
        </GlassSurface>
        {error ? <Text style={[styles.error, {backgroundColor: colors.dangerSoft, color: colors.danger}]}>{error}</Text> : null}
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1},
  listContent: {paddingHorizontal: 18, paddingBottom: 108},
  floatingSearch: {
    position: 'absolute',
    left: 18,
    right: 18,
    zIndex: 50,
    elevation: 50,
  },
  requestBlock: {paddingBottom: 18},
  searchRow: {
    minHeight: 58,
    borderRadius: 29,
    borderWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 8,
    paddingVertical: 5,
    shadowOffset: {width: 0, height: 12},
    shadowOpacity: 0.09,
    shadowRadius: 24,
    elevation: 12,
  },
  searchInput: {flex: 1, height: 48, borderRadius: 20, paddingHorizontal: 14, fontSize: 17, fontWeight: '700'},
  addButton: {width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center'},
  addButtonText: {color: '#fff', fontSize: 34, lineHeight: 38, fontWeight: '500'},
  requestMenu: {
    minHeight: 68,
    borderWidth: 0,
    borderRadius: 20,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowOffset: {width: 0, height: 8},
    shadowOpacity: 0.07,
    shadowRadius: 18,
    elevation: 8,
  },
  menuIcon: {width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center'},
  menuIconText: {fontSize: 20, fontWeight: '900'},
  menuTitle: {fontSize: 16, fontWeight: '800'},
  menuSubtitle: {fontSize: 13, marginTop: 2, fontWeight: '600'},
  menuBadge: {minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center'},
  menuBadgeText: {color: '#fff', fontSize: 12, lineHeight: 15, fontWeight: '800'},
  sectionTitle: {fontSize: 12, fontWeight: '900', textTransform: 'uppercase', marginTop: 0, marginBottom: 2},
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
  memberText: {maxWidth: 92, fontSize: 12, fontWeight: '600'},
  empty: {padding: 24, alignItems: 'center'},
  emptySheet: {paddingVertical: 24, alignItems: 'center'},
  emptyTitle: {fontSize: 17, fontWeight: '900'},
  emptyText: {fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 6},
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 28,
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: {width: 0, height: -10},
    elevation: 12,
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
  formBox: {borderRadius: 18, padding: 12, marginTop: 10},
  fieldLabel: {fontSize: 12, fontWeight: '900', textTransform: 'uppercase', marginBottom: 8},
  fieldInput: {height: 42, fontSize: 15, fontWeight: '700'},
  multiInput: {height: 78, paddingTop: 0, textAlignVertical: 'top'},
  primaryButton: {height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginTop: 14},
  primaryButtonText: {color: '#fff', fontSize: 15, fontWeight: '900'},
  joinHelp: {fontSize: 14, lineHeight: 20, fontWeight: '600', marginBottom: 4},
  joinRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  joinInput: {flex: 1, height: 42, fontSize: 14, fontWeight: '700'},
  joinButton: {height: 38, borderRadius: 19, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center'},
  joinButtonText: {color: '#fff', fontWeight: '900'},
  requestRow: {minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 10},
  avatarSmall: {width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center'},
  avatarSmallText: {color: '#fff', fontSize: 16, fontWeight: '900'},
  requestBody: {flex: 1},
  requestName: {fontSize: 15, fontWeight: '800'},
  requestSub: {fontSize: 12, marginTop: 2, fontWeight: '600'},
  requestButton: {height: 34, borderRadius: 17, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center'},
  requestButtonText: {color: '#fff', fontSize: 13, fontWeight: '900'},
  declineButton: {height: 34, borderRadius: 17, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center'},
  declineText: {fontSize: 13, fontWeight: '900'},
  chevron: {fontSize: 24},
  pressed: {opacity: 0.74},
});
