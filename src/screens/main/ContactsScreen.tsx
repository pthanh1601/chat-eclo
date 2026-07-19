import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {FlatList, Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {useSafeAreaInsets} from '../../platform/safeArea';
import type {NativeBottomTabScreenProps} from '@bottom-tabs/react-navigation';
import {useIsFocused, type CompositeScreenProps} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {matrixClientService} from '../../core/matrix/MatrixClientService';
import {RoomService, type ContactRequest} from '../../core/matrix/RoomService';
import {matrixErrorMessage} from '../../core/matrix/errors';
import {nativeMatrixService, type NativeContactRequest} from '../../core/matrix/NativeMatrixService';
import {
  contactSection,
  displayNameForContact,
  loadLocalContacts,
  mergeContacts,
  shortContactId,
  type ContactRecord,
} from '../../core/matrix/ContactService';
import type {MainTabParamList, RootStackParamList} from '../../navigation/RootNavigator';
import {useSession} from '../../context/SessionContext';
import {demoStore} from '../../core/demo/demoStore';
import {useAppTheme} from '../../theme/useAppTheme';
import {MatrixAvatar} from '../../components/MatrixAvatar';
import {GlassSurface} from '../../components/GlassSurface';

type Props = CompositeScreenProps<
  NativeBottomTabScreenProps<MainTabParamList, 'Contacts'>,
  NativeStackScreenProps<RootStackParamList>
>;

type Section = {title: string; data: ContactRecord[]};
type ContactListItem =
  | {kind: 'requests'}
  | {kind: 'section'; title: string}
  | {kind: 'contact'; contact: ContactRecord};

export function ContactsScreen({navigation, route}: Props) {
  const colors = useAppTheme();
  const insets = useSafeAreaInsets();
  const {state} = useSession();
  const isFocused = useIsFocused();
  const [query, setQuery] = useState('');
  const [localContacts, setLocalContacts] = useState<ContactRecord[]>([]);
  const [matrixContacts, setMatrixContacts] = useState<ContactRecord[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<Array<ContactRequest | NativeContactRequest>>([]);
  const [sentRequests, setSentRequests] = useState<Array<ContactRequest | NativeContactRequest>>([]);
  const [error, setError] = useState<string | null>(null);
  const ownerId = state.status === 'signed_in' ? state.auth.userId : '@demo:local';
  const usingNative = state.status === 'signed_in' && nativeMatrixService.isActive();

  useEffect(() => {
    if (route.params?.openAdd) {
      navigation.navigate('AddFriend');
      navigation.setParams({openAdd: false});
    }
  }, [navigation, route.params?.openAdd]);

  const refresh = useCallback(async () => {
    const stored = await loadLocalContacts(ownerId);
    setLocalContacts(stored);

    if (state.status === 'demo') {
      setMatrixContacts(
        demoStore.listRooms()
          .filter(room => room.kind === 'dm')
          .map(room => ({userId: room.name, displayName: room.name, roomId: room.roomId, source: 'dm' as const})),
      );
      setIncomingRequests([]);
      setSentRequests([]);
      return;
    }

    try {
      if (usingNative) {
        const [contacts, incoming, outgoing] = await Promise.all([
          nativeMatrixService.listDirectContacts(),
          nativeMatrixService.listContactRequests(),
          nativeMatrixService.listSentContactRequests(),
        ]);
        setMatrixContacts(contacts);
        setIncomingRequests(incoming);
        setSentRequests(outgoing);
        return;
      }

      const service = new RoomService(matrixClientService.currentClient);
      setMatrixContacts(service.listDirectContacts());
      setIncomingRequests(service.listContactRequests());
      setSentRequests(service.listSentContactRequests());
    } catch (err) {
      setError(matrixErrorMessage(err));
    }
  }, [ownerId, state.status, usingNative]);

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
    return () => {
      (client as any).removeListener('Room', refresh);
      (client as any).removeListener('Room.myMembership', refresh);
    };
  }, [isFocused, refresh, state.status, usingNative]);

  const contacts = useMemo(
    () => {
      const pendingUserIds = new Set([...incomingRequests, ...sentRequests].map(request => request.userId));
      return mergeContacts(
        localContacts.filter(contact => !pendingUserIds.has(contact.userId)),
        matrixContacts,
      );
    },
    [incomingRequests, localContacts, matrixContacts, sentRequests],
  );
  const filteredContacts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return contacts;
    }
    return contacts.filter(contact => {
      const title = displayNameForContact(contact).toLowerCase();
      return title.includes(needle) || contact.userId.toLowerCase().includes(needle);
    });
  }, [contacts, query]);

  const sections = useMemo<Section[]>(() => {
    const buckets = new Map<string, ContactRecord[]>();
    for (const contact of filteredContacts) {
      const letter = contactSection(contact);
      buckets.set(letter, [...(buckets.get(letter) ?? []), contact]);
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([title, data]) => ({title, data}));
  }, [filteredContacts]);
  const listData = useMemo<ContactListItem[]>(
    () => [
      {kind: 'requests'},
      {kind: 'section', title: 'Danh bạ'},
      ...sections.flatMap(section => [
        {kind: 'section' as const, title: section.title},
        ...section.data.map(contact => ({kind: 'contact' as const, contact})),
      ]),
    ],
    [sections],
  );
  const topControlsOffset = insets.top + 54;

  async function openContact(contact: ContactRecord) {
    const title = displayNameForContact(contact);
    if (state.status !== 'demo') {
      const roomId = usingNative
        ? await nativeMatrixService.getOpenDirectRoomId(contact.userId)
        : new RoomService(matrixClientService.currentClient).getOpenDirectRoomId(contact.userId);
      if (roomId) {
        navigation.navigate('Chat', {roomId, title});
        return;
      }
    } else if (contact.source === 'dm' && contact.roomId) {
      navigation.navigate('Chat', {roomId: contact.roomId, title});
      return;
    }
    navigation.navigate('Chat', {pendingDirectUserId: contact.userId, title});
  }

  function renderContact(contact: ContactRecord) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${displayNameForContact(contact)}, ${shortContactId(contact.userId)}`}
        onPress={() => openContact(contact)}
        style={({pressed}) => [styles.contactRow, pressed ? styles.pressed : null]}>
        <MatrixAvatar label={displayNameForContact(contact)} uri={contact.avatarUrl} size={50} backgroundColor={colors.primary} />
        <View style={styles.contactBody}>
          <Text numberOfLines={1} style={[styles.contactName, {color: colors.text}]}>{displayNameForContact(contact)}</Text>
          <Text numberOfLines={1} style={[styles.contactId, {color: colors.secondaryText}]}>{shortContactId(contact.userId)}</Text>
        </View>
        <Text style={[styles.chevron, {color: colors.tertiaryText}]}>›</Text>
      </Pressable>
    );
  }

  return (
    <View style={[styles.screen, {backgroundColor: colors.background}]}>
      <FlatList
        data={listData}
        keyExtractor={(item, index) => {
          if (item.kind === 'contact') {
            return item.contact.userId;
          }
          if (item.kind === 'section') {
            return `section-${item.title}-${index}`;
          }
          return item.kind;
        }}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        contentContainerStyle={[styles.content, {paddingTop: topControlsOffset + 74}]}
        renderItem={({item}) => {
          if (item.kind === 'requests') {
            return (
              <View style={styles.requestBlock}>
                {error ? <Text style={[styles.error, {backgroundColor: colors.dangerSoft, color: colors.danger}]}>{error}</Text> : null}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => navigation.navigate('ContactRequests', {initialTab: incomingRequests.length ? 'incoming' : 'outgoing'})}
                  style={({pressed}) => [pressed ? styles.pressed : null]}>
                  <GlassSurface style={[styles.requestMenu, {shadowColor: colors.shadow}]}>
                    <View style={[styles.menuIcon, {backgroundColor: colors.dark ? 'rgba(255,255,255,0.10)' : 'rgba(7,113,246,0.10)'}]}>
                      <Text style={[styles.menuIconText, {color: colors.primary}]}>@</Text>
                    </View>
                    <View style={styles.contactBody}>
                      <Text style={[styles.menuTitle, {color: colors.text}]}>Yêu cầu kết bạn</Text>
                      <Text style={[styles.menuSubtitle, {color: colors.secondaryText}]}>
                        {incomingRequests.length ? `${incomingRequests.length} yêu cầu mới` : sentRequests.length ? `${sentRequests.length} đã gửi` : 'Không có yêu cầu mới'}
                      </Text>
                    </View>
                    {incomingRequests.length ? (
                      <View style={[styles.menuBadge, {backgroundColor: colors.primary}]}>
                        <Text style={styles.menuBadgeText}>{incomingRequests.length > 99 ? '99+' : incomingRequests.length}</Text>
                      </View>
                    ) : null}
                    <Text style={[styles.chevron, {color: colors.tertiaryText}]}>›</Text>
                  </GlassSurface>
                </Pressable>
              </View>
            );
          }

          if (item.kind === 'section') {
            return item.title === 'Danh bạ' ? (
              <Text style={[styles.sectionTitle, {color: colors.tertiaryText}]}>{item.title}</Text>
            ) : (
              <Text style={[styles.letterHeader, {color: colors.primary}]}>{item.title}</Text>
            );
          }

          return renderContact(item.contact);
        }}
        ListEmptyComponent={
          <View style={styles.emptyContacts}>
            <Text style={[styles.emptyTitle, {color: colors.text}]}>Chưa có liên hệ</Text>
            <Text style={[styles.emptyText, {color: colors.secondaryText}]}>Bấm + để thêm bạn vào danh bạ trước, phòng chat sẽ chỉ tạo khi bạn gửi tin nhắn đầu tiên.</Text>
          </View>
        }
      />
      <View pointerEvents="box-none" style={[styles.floatingSearch, {top: topControlsOffset}]}>
        <GlassSurface style={[styles.searchRow, {shadowColor: colors.shadow}]}>
          <TextInput
            autoCapitalize="none"
            placeholder="Tìm kiếm"
            placeholderTextColor={colors.tertiaryText}
            style={[styles.searchInput, {color: colors.text}]}
            value={query}
            onChangeText={setQuery}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Thêm bạn"
            onPress={() => navigation.navigate('AddFriend')}
            style={({pressed}) => [styles.addButton, {backgroundColor: colors.primary}, pressed ? styles.pressed : null]}>
            <Text style={styles.addButtonText}>+</Text>
          </Pressable>
        </GlassSurface>
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1},
  content: {paddingHorizontal: 18, paddingBottom: 108},
  floatingSearch: {
    position: 'absolute',
    left: 18,
    right: 18,
    zIndex: 50,
    elevation: 50,
  },
  requestBlock: {gap: 18, paddingBottom: 18},
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
  error: {borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, overflow: 'hidden', fontWeight: '700'},
  requestMenu: {
    minHeight: 62,
    borderWidth: 0,
    borderRadius: 20,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    shadowOffset: {width: 0, height: 8},
    shadowOpacity: 0.07,
    shadowRadius: 18,
    elevation: 8,
  },
  menuIcon: {width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center'},
  menuIconText: {fontSize: 18, fontWeight: '900'},
  menuTitle: {fontSize: 16, lineHeight: 20, fontWeight: '800'},
  menuSubtitle: {fontSize: 13, lineHeight: 18, fontWeight: '600', marginTop: 2},
  menuBadge: {minWidth: 23, height: 23, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6},
  menuBadgeText: {color: '#fff', fontSize: 12, lineHeight: 15, fontWeight: '900'},
  segment: {height: 38, borderRadius: 19, flexDirection: 'row', padding: 3},
  segmentItem: {flex: 1, borderRadius: 16, alignItems: 'center', justifyContent: 'center'},
  segmentText: {fontSize: 13, fontWeight: '900'},
  sectionTitle: {fontSize: 13, fontWeight: '800', textTransform: 'uppercase'},
  requestRow: {minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 10},
  avatarSmall: {width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center'},
  avatarSmallText: {color: '#fff', fontSize: 17, fontWeight: '900'},
  contactBody: {flex: 1, minWidth: 0},
  requestName: {fontSize: 16, lineHeight: 20, fontWeight: '800'},
  contactId: {fontSize: 13, lineHeight: 18, fontWeight: '600', marginTop: 2},
  requestButton: {height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14},
  requestButtonText: {color: '#fff', fontSize: 13, fontWeight: '900'},
  declineButton: {height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12},
  declineText: {fontSize: 13, fontWeight: '800'},
  emptyLine: {fontSize: 14, lineHeight: 20, fontWeight: '600'},
  letterHeader: {fontSize: 15, fontWeight: '900', marginTop: 12, marginBottom: 4},
  contactRow: {minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12},
  avatar: {width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center'},
  avatarText: {color: '#fff', fontSize: 20, fontWeight: '900'},
  contactName: {fontSize: 17, lineHeight: 22, fontWeight: '700'},
  chevron: {fontSize: 26, fontWeight: '300'},
  emptyContacts: {paddingTop: 36, alignItems: 'center', paddingHorizontal: 20},
  emptyTitle: {fontSize: 18, fontWeight: '900'},
  emptyText: {fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 6, fontWeight: '600'},
  disabled: {opacity: 0.44},
  pressed: {opacity: 0.72},
});
