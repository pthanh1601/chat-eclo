import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {SafeAreaView, useSafeAreaInsets} from '../../platform/safeArea';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {useFocusEffect} from '@react-navigation/native';
import RNFS from 'react-native-fs';
import {matrixClientService} from '../../core/matrix/MatrixClientService';
import {MessageService, type TimelineItem} from '../../core/matrix/MessageService';
import {RoomService, type ContactRequest, type GroupRequest} from '../../core/matrix/RoomService';
import {nativeMatrixService, type NativeContactRequest, type NativeGroupRequest, type NativeMediaUpload, type NativeRoomSummary} from '../../core/matrix/NativeMatrixService';
import {resolveMatrixMediaUri} from '../../core/matrix/MediaDecryptor';
import {matrixErrorMessage} from '../../core/matrix/errors';
import {demoStore} from '../../core/demo/demoStore';
import {useSession} from '../../context/SessionContext';
import type {RootStackParamList} from '../../navigation/RootNavigator';
import {useAppTheme} from '../../theme/useAppTheme';
import {
  displayNameForContact,
  loadLocalContacts,
  mergeContacts,
  normalizeContactId,
  removeLocalContact,
  saveLocalContact,
  shortContactId,
  type ContactRecord,
} from '../../core/matrix/ContactService';
import {MatrixAvatar} from '../../components/MatrixAvatar';
import {MatrixQrCode} from '../../components/MatrixQrCode';
import {QrScanner} from '../../components/QrScanner';
import {matrixEntityQrValue, parseMatrixQrValue} from '../../core/matrix/QrPayload';

type StackProps<RouteName extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, RouteName>;
type RequestTab = 'incoming' | 'outgoing';
type AddFriendTab = 'id' | 'scan' | 'mine';
type JoinRoomTab = 'id' | 'scan';
type GroupInvite = GroupRequest | NativeGroupRequest;
type ForwardTarget = {roomId: string; title: string; avatarUrl?: string; subtitle: string};

export function NewChatScreen({navigation}: StackProps<'NewChat'>) {
  const colors = useAppTheme();
  const topPadding = usePageTopPadding();
  return (
    <SafeAreaView edges={['bottom']} style={[styles.screen, {backgroundColor: colors.background}]}>
      <ScrollView contentContainerStyle={[styles.menuContent, {paddingTop: topPadding}]}>
        <ActionRow
          icon="@"
          title="Thêm bạn"
          subtitle="Tìm và lưu bạn vào danh bạ"
          onPress={() => navigation.navigate('AddFriend')}
        />
        <ActionRow
          icon="#"
          title="Tạo nhóm"
          subtitle="Trò chuyện riêng tư cùng nhiều người"
          onPress={() => navigation.navigate('CreateGroup')}
        />
        <ActionRow
          icon="↗"
          title="Tham gia phòng"
          subtitle="Vào bằng mã phòng hoặc quét QR"
          onPress={() => navigation.navigate('JoinRoom', {kind: 'room'})}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

export function NewGroupScreen({navigation}: StackProps<'NewGroup'>) {
  const colors = useAppTheme();
  const topPadding = usePageTopPadding();
  return (
    <SafeAreaView edges={['bottom']} style={[styles.screen, {backgroundColor: colors.background}]}>
      <ScrollView contentContainerStyle={[styles.menuContent, {paddingTop: topPadding}]}>
        <ActionRow
          icon="#"
          title="Tạo nhóm"
          subtitle="Trò chuyện riêng tư cùng nhiều người"
          onPress={() => navigation.navigate('CreateGroup')}
        />
        <ActionRow
          icon="↗"
          title="Tham gia nhóm"
          subtitle="Vào nhóm bằng mã phòng hoặc quét QR"
          onPress={() => navigation.navigate('JoinRoom', {kind: 'group'})}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

export function AddFriendScreen({navigation}: StackProps<'AddFriend'>) {
  const colors = useAppTheme();
  const topPadding = usePageTopPadding();
  const {state} = useSession();
  const [activeTab, setActiveTab] = useState<AddFriendTab>('id');
  const [newUser, setNewUser] = useState('');
  const [searchResults, setSearchResults] = useState<ContactRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const ownerId = state.status === 'signed_in' ? state.auth.userId : '@demo:local';
  const fallbackServer = state.status === 'signed_in' ? serverNameFromBaseUrl(state.auth.baseUrl) : 'local';
  const usingNative = state.status === 'signed_in' && nativeMatrixService.isActive();
  const ownUserId = state.status === 'signed_in' ? state.auth.userId : ownerId;
  const ownQrValue = matrixEntityQrValue(ownUserId);

  async function searchUsers(input?: string) {
    const term = (input ?? newUser).trim();
    if (!term) {
      setSearchResults([]);
      return;
    }
    setNewUser(term);
    setBusy(true);
    setError(null);
    try {
      if (state.status === 'demo') {
        setSearchResults([{userId: normalizeContactId(term, fallbackServer), displayName: term, source: 'search'}]);
        return;
      }
      const results = usingNative
        ? await nativeMatrixService.searchUsers(term)
        : await new RoomService(matrixClientService.currentClient).searchUsers(term);
      setSearchResults(results);
    } catch (err) {
      setError(matrixErrorMessage(err));
      setSearchResults([]);
    } finally {
      setBusy(false);
    }
  }

  function scanFriendQr(value: string): boolean {
    const entity = parseMatrixQrValue(value);
    if (!entity || entity.kind !== 'user') {
      setError('Mã QR này không phải mã người dùng ECLO hợp lệ.');
      return false;
    }
    if (entity.id === ownUserId) {
      setError('Đây là mã QR của chính bạn.');
      return false;
    }
    setError(null);
    setActiveTab('id');
    void searchUsers(entity.id);
    return true;
  }

  function copyOwnId() {
    Clipboard.setString(ownUserId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  async function addContact(contact?: ContactRecord) {
    const rawId = contact?.userId ?? newUser;
    const userId = normalizeContactId(rawId, fallbackServer);
    if (!userId) {
      return;
    }
    if (state.status === 'signed_in' && userId === state.auth.userId) {
      setError('Không thể tự thêm chính mình vào danh bạ.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (state.status === 'signed_in') {
        const existingRoomId = usingNative
          ? await nativeMatrixService.getOpenDirectRoomId(userId)
          : new RoomService(matrixClientService.currentClient).getOpenDirectRoomId(userId);
        if (existingRoomId) {
          setError('Người này đã nằm trong danh bạ.');
          return;
        }
        if (usingNative) {
          await nativeMatrixService.createOrOpenDirectChat(userId);
        } else {
          await new RoomService(matrixClientService.currentClient).createOrOpenDirectChat(userId);
        }
        await removeLocalContact(ownerId, userId);
        navigation.replace('ContactRequests', {initialTab: 'outgoing'});
        return;
      }
      await saveLocalContact(ownerId, {
        userId,
        displayName: contact?.displayName,
        avatarUrl: contact?.avatarUrl,
      });
      navigation.goBack();
    } catch (err) {
      setError(matrixErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.screen, {backgroundColor: colors.background}]}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.formContent, {paddingTop: topPadding}]}>
        <Text style={[styles.pageTitle, {color: colors.text}]}>Thêm bạn</Text>
        <Text style={[styles.pageSubtitle, {color: colors.secondaryText}]}>Tìm bằng tên người dùng, quét mã hoặc chia sẻ mã của bạn.</Text>
        <View style={[styles.threeSegment, {backgroundColor: colors.input}]}>
          <SegmentButton active={activeTab === 'id'} label="Tên người dùng" onPress={() => setActiveTab('id')} />
          <SegmentButton active={activeTab === 'scan'} label="Quét QR" onPress={() => { setError(null); setActiveTab('scan'); }} />
          <SegmentButton active={activeTab === 'mine'} label="QR của tôi" onPress={() => { setError(null); setActiveTab('mine'); }} />
        </View>
        {error ? <Text style={[styles.error, {backgroundColor: colors.dangerSoft, color: colors.danger}]}>{error}</Text> : null}
        {activeTab === 'id' ? (
          <>
            <View style={styles.inlineRow}>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Tên người dùng"
                placeholderTextColor={colors.tertiaryText}
                returnKeyType="search"
                style={[styles.input, styles.inlineInput, {backgroundColor: colors.input, color: colors.text}]}
                value={newUser}
                onChangeText={setNewUser}
                onSubmitEditing={() => searchUsers()}
              />
              <Pressable accessibilityRole="button" onPress={() => searchUsers()} disabled={busy || !newUser.trim()} style={({pressed}) => [styles.smallButton, {backgroundColor: colors.primary}, (busy || !newUser.trim()) ? styles.disabled : null, pressed ? styles.pressed : null]}>
                <Text style={styles.buttonText}>Tìm</Text>
              </Pressable>
            </View>
            <Pressable accessibilityRole="button" onPress={() => addContact()} disabled={busy || !newUser.trim()} style={({pressed}) => [styles.primaryButton, {backgroundColor: colors.primary}, (busy || !newUser.trim()) ? styles.disabled : null, pressed ? styles.pressed : null]}>
              <Text style={styles.buttonText}>{state.status === 'signed_in' ? 'Gửi yêu cầu' : 'Lưu vào danh bạ'}</Text>
            </Pressable>
            {searchResults.map(result => (
              <Pressable key={result.userId} accessibilityRole="button" onPress={() => addContact(result)} style={({pressed}) => [styles.resultRow, {borderBottomColor: colors.separator}, pressed ? styles.pressed : null]}>
                <MatrixAvatar label={displayNameForContact(result)} uri={result.avatarUrl} size={44} backgroundColor={colors.primary} />
                <View style={styles.rowText}>
                  <Text numberOfLines={1} style={[styles.rowTitle, {color: colors.text}]}>{displayNameForContact(result)}</Text>
                  <Text numberOfLines={1} style={[styles.rowSubtitle, {color: colors.secondaryText}]}>{shortContactId(result.userId)}</Text>
                </View>
                <Text style={[styles.rowAction, {color: colors.primary}]}>{state.status === 'signed_in' ? 'Gửi' : 'Lưu'}</Text>
              </Pressable>
            ))}
          </>
        ) : activeTab === 'scan' ? (
          <QrScanner onScanned={scanFriendQr} />
        ) : (
          <View style={[styles.myQrCard, {backgroundColor: colors.input}]}>
            <MatrixAvatar label={ownUserId} size={62} backgroundColor={colors.primary} />
            <Text style={[styles.myQrTitle, {color: colors.text}]}>Mã QR của tôi</Text>
            <Text selectable style={[styles.myQrId, {color: colors.secondaryText}]}>{shortContactId(ownUserId)}</Text>
            <MatrixQrCode value={ownQrValue} />
            <Text style={[styles.myQrHint, {color: colors.secondaryText}]}>Người khác quét mã này để tìm và gửi yêu cầu kết bạn cho bạn.</Text>
            <Pressable accessibilityRole="button" onPress={copyOwnId} style={({pressed}) => [styles.copyIdButton, {backgroundColor: colors.primary}, pressed ? styles.pressed : null]}>
              <Text style={styles.buttonText}>{copied ? 'Đã sao chép' : 'Sao chép tên người dùng'}</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function CreateGroupScreen({navigation}: StackProps<'CreateGroup'>) {
  const colors = useAppTheme();
  const topPadding = usePageTopPadding();
  const {state} = useSession();
  const [groupName, setGroupName] = useState('');
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const usingNative = state.status === 'signed_in' && nativeMatrixService.isActive();

  const loadContacts = useCallback(async () => {
    setError(null);
    try {
      const next = state.status === 'demo'
        ? await loadLocalContacts('@demo:local')
        : usingNative
          ? await nativeMatrixService.listDirectContacts()
          : new RoomService(matrixClientService.currentClient).listDirectContacts();
      setContacts(mergeContacts(next));
    } catch (err) {
      setError(matrixErrorMessage(err));
    }
  }, [state.status, usingNative]);

  useFocusEffect(useCallback(() => {
    void loadContacts();
  }, [loadContacts]));

  const filteredContacts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return contacts;
    }
    return contacts.filter(contact => (
      `${displayNameForContact(contact)} ${contact.userId}`.toLowerCase().includes(needle)
    ));
  }, [contacts, query]);

  function toggleContact(userId: string) {
    setSelectedIds(current => {
      const next = new Set(current);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }

  async function createGroup() {
    const title = groupName.trim() || 'Nhóm mới';
    const invites = [...selectedIds];
    setBusy(true);
    setError(null);
    try {
      if (state.status === 'demo') {
        const roomId = demoStore.createRoom(title, 'group', true);
        navigation.replace('Chat', {roomId, title});
        return;
      }
      const roomId = usingNative
        ? await nativeMatrixService.createEncryptedRoom(title, invites)
        : await new RoomService(matrixClientService.currentClient).createGroupChat(title, invites);
      navigation.replace('Chat', {roomId, title});
    } catch (err) {
      setError(matrixErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.screen, {backgroundColor: colors.background}]}>
      <FlatList
        data={filteredContacts}
        keyExtractor={item => item.userId}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.listPageContent, {paddingTop: topPadding, paddingBottom: 120}]}
        ListHeaderComponent={(
          <View style={styles.groupHeader}>
            <Text style={[styles.pageTitle, {color: colors.text}]}>Tạo nhóm</Text>
            <Text style={[styles.pageSubtitle, {color: colors.secondaryText}]}>Chọn thành viên từ danh bạ đã kết bạn.</Text>
            {error ? <Text style={[styles.error, {backgroundColor: colors.dangerSoft, color: colors.danger}]}>{error}</Text> : null}
            <TextInput
              placeholder="Tên nhóm"
              placeholderTextColor={colors.tertiaryText}
              style={[styles.input, {backgroundColor: colors.input, color: colors.text}]}
              value={groupName}
              onChangeText={setGroupName}
            />
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Tìm trong danh bạ"
              placeholderTextColor={colors.tertiaryText}
              style={[styles.input, {backgroundColor: colors.input, color: colors.text}]}
              value={query}
              onChangeText={setQuery}
            />
            <Text style={[styles.selectionSummary, {color: colors.secondaryText}]}>{selectedIds.size} người đã chọn</Text>
          </View>
        )}
        renderItem={({item}) => {
          const selected = selectedIds.has(item.userId);
          return (
            <Pressable accessibilityRole="checkbox" accessibilityState={{checked: selected}} onPress={() => toggleContact(item.userId)} style={({pressed}) => [styles.resultRow, {borderBottomColor: colors.separator}, pressed ? styles.pressed : null]}>
              <MatrixAvatar label={displayNameForContact(item)} uri={item.avatarUrl} size={46} backgroundColor={colors.primary} />
              <View style={styles.rowText}>
                <Text numberOfLines={1} style={[styles.rowTitle, {color: colors.text}]}>{displayNameForContact(item)}</Text>
                <Text numberOfLines={1} style={[styles.rowSubtitle, {color: colors.secondaryText}]}>{shortContactId(item.userId)}</Text>
              </View>
              <View style={[styles.checkCircle, {borderColor: selected ? colors.primary : colors.tertiaryText, backgroundColor: selected ? colors.primary : 'transparent'}]}>
                <Text style={styles.checkMark}>{selected ? '✓' : ''}</Text>
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={<EmptyState title={query.trim() ? 'Không tìm thấy liên hệ' : 'Danh bạ đang trống'} subtitle={query.trim() ? 'Thử tìm bằng tên người dùng khác.' : 'Hãy kết bạn trước, sau đó liên hệ sẽ xuất hiện ở đây.'} />}
      />
      <View style={[styles.bottomAction, {backgroundColor: colors.background, borderTopColor: colors.separator}]}>
        <Pressable accessibilityRole="button" onPress={createGroup} disabled={busy} style={({pressed}) => [styles.primaryButton, {backgroundColor: colors.primary}, busy ? styles.disabled : null, pressed ? styles.pressed : null]}>
          <Text style={styles.buttonText}>{busy ? 'Đang tạo...' : selectedIds.size ? `Tạo nhóm với ${selectedIds.size} người` : 'Tạo nhóm'}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

export function JoinRoomScreen({navigation, route}: StackProps<'JoinRoom'>) {
  const colors = useAppTheme();
  const topPadding = usePageTopPadding();
  const {state} = useSession();
  const [activeTab, setActiveTab] = useState<JoinRoomTab>('id');
  const [joinTarget, setJoinTarget] = useState('');
  const [joinDisplay, setJoinDisplay] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const usingNative = state.status === 'signed_in' && nativeMatrixService.isActive();
  const label = route.params?.kind === 'group' ? 'Tham gia nhóm' : 'Tham gia phòng';

  function scanRoomQr(value: string): boolean {
    const entity = parseMatrixQrValue(value);
    if (!entity || entity.kind !== 'room') {
      setError('Mã QR này không phải mã phòng ECLO hợp lệ.');
      return false;
    }
    setJoinTarget(entity.id);
    setJoinDisplay(entity.id.replace(/:.+$/, ''));
    setError(null);
    setActiveTab('id');
    return true;
  }

  async function joinRoom() {
    const target = joinTarget.trim();
    if (!target) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (state.status === 'demo') {
        const roomId = demoStore.createRoom(target, route.params?.kind === 'group' ? 'group' : 'room', false);
        navigation.replace('Chat', {roomId, title: target});
        return;
      }
      const roomId = usingNative
        ? await nativeMatrixService.joinRoom(target)
        : await new RoomService(matrixClientService.currentClient).joinRoom(target);
      navigation.replace('Chat', {roomId, title: target});
    } catch (err) {
      setError(matrixErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.screen, {backgroundColor: colors.background}]}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.formContent, {paddingTop: topPadding}]}>
        <Text style={[styles.pageTitle, {color: colors.text}]}>{label}</Text>
        <Text style={[styles.pageSubtitle, {color: colors.secondaryText}]}>Nhập mã phòng hoặc quét mã QR được chia sẻ từ thông tin phòng.</Text>
        <View style={[styles.segment, {backgroundColor: colors.input}]}>
          <SegmentButton active={activeTab === 'id'} label="Nhập mã" onPress={() => { setError(null); setActiveTab('id'); }} />
          <SegmentButton active={activeTab === 'scan'} label="Quét QR" onPress={() => { setError(null); setActiveTab('scan'); }} />
        </View>
        {error ? <Text style={[styles.error, {backgroundColor: colors.dangerSoft, color: colors.danger}]}>{error}</Text> : null}
        {activeTab === 'id' ? (
          <>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Mã phòng hoặc liên kết được chia sẻ"
              placeholderTextColor={colors.tertiaryText}
              returnKeyType="go"
              style={[styles.input, {backgroundColor: colors.input, color: colors.text}]}
              value={joinDisplay}
              onChangeText={value => {
                setJoinDisplay(value);
                setJoinTarget(value);
              }}
              onSubmitEditing={joinRoom}
            />
            <Pressable accessibilityRole="button" onPress={joinRoom} disabled={busy || !joinTarget.trim()} style={({pressed}) => [styles.primaryButton, {backgroundColor: colors.primary}, (busy || !joinTarget.trim()) ? styles.disabled : null, pressed ? styles.pressed : null]}>
              <Text style={styles.buttonText}>{busy ? 'Đang vào...' : label}</Text>
            </Pressable>
          </>
        ) : (
          <QrScanner onScanned={scanRoomQr} />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function ForwardMessageScreen({navigation, route}: StackProps<'ForwardMessage'>) {
  const colors = useAppTheme();
  const topPadding = usePageTopPadding();
  const {state} = useSession();
  const [targets, setTargets] = useState<ForwardTarget[]>([]);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<TimelineItem | null>(null);
  const [busyRoomId, setBusyRoomId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const usingNative = state.status === 'signed_in' && nativeMatrixService.isActive();

  const refresh = useCallback(async () => {
    setError(null);
    try {
      if (usingNative) {
        const rooms = await nativeMatrixService.listRooms();
        const timelineMessage = nativeMatrixService.getTimeline(route.params.sourceRoomId).find(item => item.id === route.params.eventId) ?? null;
        setMessage(timelineMessage);
        setTargets(rooms
          .filter(room => room.roomId !== route.params.sourceRoomId && !room.isPendingDirectRequest)
          .map(nativeRoomToForwardTarget));
        return;
      }
      const client = matrixClientService.currentClient;
      const service = new MessageService(client);
      const sourceRoom = client.getRoom(route.params.sourceRoomId);
      const timelineMessage = sourceRoom?.timeline
        .map(event => service.mapTimelineEvent(event))
        .find(item => item?.id === route.params.eventId) ?? null;
      setMessage(timelineMessage);
      setTargets(client.getRooms()
        .filter(room => room.roomId !== route.params.sourceRoomId && (room as any).getMyMembership?.() === 'join')
        .map(room => ({
          roomId: room.roomId,
          title: room.name || room.roomId,
          avatarUrl: (client as any).mxcUrlToHttp?.(room.getMxcAvatarUrl?.(), 96, 96, 'crop') ?? undefined,
          subtitle: new RoomService(client).isEncrypted(room) ? 'Được bảo vệ' : 'Cuộc trò chuyện',
        })));
    } catch (err) {
      setError(matrixErrorMessage(err));
    }
  }, [route.params.eventId, route.params.sourceRoomId, usingNative]);

  useFocusEffect(useCallback(() => {
    refresh();
  }, [refresh]));

  const filteredTargets = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return targets;
    }
    return targets.filter(target => `${target.title} ${target.subtitle} ${target.roomId}`.toLowerCase().includes(needle));
  }, [query, targets]);

  async function forwardTo(target: ForwardTarget) {
    if (!message) {
      setError('Không tìm thấy tin nhắn cần chuyển tiếp.');
      return;
    }
    if (usingNative) {
      setBusyRoomId(target.roomId);
      setError(null);
      try {
        if (message.messageKind === 'poll' && message.poll) {
          await nativeMatrixService.sendPoll(target.roomId, message.poll.question, message.poll.answers.map(answer => answer.text));
        } else if (['image', 'sticker', 'video', 'audio', 'file'].includes(message.messageKind ?? '') && message.mediaUrl) {
          const uri = await localForwardMediaUri(message);
          const stat = await RNFS.stat(localPathFromForwardUri(uri)).catch(() => undefined);
          const kind: NativeMediaUpload['kind'] = message.messageKind === 'video'
            ? 'video'
            : message.messageKind === 'audio'
              ? 'audio'
              : message.messageKind === 'file'
                ? 'file'
                : message.messageKind === 'sticker'
                  ? 'sticker'
                  : 'image';
          const upload: NativeMediaUpload = {
            uri,
            kind,
            fileName: message.mediaFileName ?? message.body,
            mimeType: message.mediaMimeType,
            fileSize: stat ? Number(stat.size) : undefined,
          };
          if (kind === 'sticker') {
            await nativeMatrixService.sendStickerUpload(target.roomId, upload);
          } else {
            await nativeMatrixService.sendMediaUploads(target.roomId, [upload]);
          }
        } else {
          await nativeMatrixService.sendText(target.roomId, message.body || '[Forwarded message]');
        }
        navigation.goBack();
      } catch (err) {
        setError(matrixErrorMessage(err));
      } finally {
        setBusyRoomId(null);
      }
      return;
    }
    setBusyRoomId(target.roomId);
    setError(null);
    try {
      await new MessageService(matrixClientService.currentClient).forwardMessage(target.roomId, message.raw);
      navigation.goBack();
    } catch (err) {
      setError(matrixErrorMessage(err));
    } finally {
      setBusyRoomId(null);
    }
  }

  return (
    <SafeAreaView edges={['bottom']} style={[styles.screen, {backgroundColor: colors.background}]}>
      <FlatList
        data={filteredTargets}
        keyExtractor={item => item.roomId}
        contentContainerStyle={[filteredTargets.length ? styles.listPageContent : styles.emptyPageContent, {paddingTop: topPadding}]}
        ListHeaderComponent={
          <View style={styles.requestHeader}>
            <Text style={[styles.pageSubtitle, {color: colors.secondaryText}]}>
              {message ? `Chuyển tiếp: ${message.body || message.type}` : 'Đang tìm tin nhắn cần chuyển tiếp...'}
            </Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Tìm người hoặc nhóm"
              placeholderTextColor={colors.tertiaryText}
              style={[styles.input, {backgroundColor: colors.input, color: colors.text}]}
              value={query}
              onChangeText={setQuery}
            />
            {error ? <Text style={[styles.error, {backgroundColor: colors.dangerSoft, color: colors.danger}]}>{error}</Text> : null}
          </View>
        }
        renderItem={({item}) => (
          <Pressable accessibilityRole="button" onPress={() => forwardTo(item)} disabled={busyRoomId === item.roomId} style={({pressed}) => [styles.requestRow, {borderBottomColor: colors.separator}, pressed ? styles.pressed : null]}>
            <MatrixAvatar label={item.title} uri={item.avatarUrl} size={44} backgroundColor={colors.primary} />
            <View style={styles.rowText}>
              <Text numberOfLines={1} style={[styles.rowTitle, {color: colors.text}]}>{item.title}</Text>
              <Text numberOfLines={1} style={[styles.rowSubtitle, {color: colors.secondaryText}]}>{item.subtitle}</Text>
            </View>
            <Text style={[styles.rowAction, {color: colors.primary}]}>{busyRoomId === item.roomId ? 'Đang gửi' : 'Gửi'}</Text>
          </Pressable>
        )}
        ListEmptyComponent={<EmptyState title={query.trim() ? 'Không tìm thấy kết quả' : 'Không có phòng để chuyển tiếp'} subtitle={query.trim() ? 'Thử nhập một tên khác.' : 'Các cuộc trò chuyện đã tham gia sẽ hiện ở đây.'} />}
      />
    </SafeAreaView>
  );
}

export function ContactRequestsScreen({navigation, route}: StackProps<'ContactRequests'>) {
  const colors = useAppTheme();
  const topPadding = usePageTopPadding();
  const {state} = useSession();
  const [requestTab, setRequestTab] = useState<RequestTab>(route.params?.initialTab ?? 'incoming');
  const [incomingRequests, setIncomingRequests] = useState<Array<ContactRequest | NativeContactRequest>>([]);
  const [sentRequests, setSentRequests] = useState<Array<ContactRequest | NativeContactRequest>>([]);
  const [error, setError] = useState<string | null>(null);
  const usingNative = state.status === 'signed_in' && nativeMatrixService.isActive();
  const ownerId = state.status === 'signed_in' ? state.auth.userId : '@demo:local';

  const refresh = useCallback(async () => {
    if (state.status === 'demo') {
      setIncomingRequests([]);
      setSentRequests([]);
      return;
    }
    try {
      if (usingNative) {
        const [incoming, outgoing] = await Promise.all([
          nativeMatrixService.listContactRequests(),
          nativeMatrixService.listSentContactRequests(),
        ]);
        setIncomingRequests(incoming);
        setSentRequests(outgoing);
        return;
      }
      const service = new RoomService(matrixClientService.currentClient);
      setIncomingRequests(service.listContactRequests());
      setSentRequests(service.listSentContactRequests());
    } catch (err) {
      setError(matrixErrorMessage(err));
    }
  }, [state.status, usingNative]);

  useFocusEffect(useCallback(() => {
    refresh();
  }, [refresh]));

  const activeRequests = requestTab === 'incoming' ? incomingRequests : sentRequests;

  async function acceptRequest(request: ContactRequest | NativeContactRequest) {
    setError(null);
    try {
      if (usingNative) {
        await nativeMatrixService.acceptInvite(request.roomId);
      } else {
        await new RoomService(matrixClientService.currentClient).acceptInvite(request.roomId, request.userId);
      }
      await removeLocalContact(ownerId, request.userId);
      await refresh();
    } catch (err) {
      setError(matrixErrorMessage(err));
    }
  }

  async function declineRequest(request: ContactRequest | NativeContactRequest) {
    setError(null);
    try {
      if (usingNative) {
        await nativeMatrixService.leaveRoom(request.roomId);
      } else {
        await new RoomService(matrixClientService.currentClient).leaveRoom(request.roomId);
      }
      await removeLocalContact(ownerId, request.userId);
      await refresh();
    } catch (err) {
      setError(matrixErrorMessage(err));
    }
  }

  const data = useMemo(() => activeRequests, [activeRequests]);

  return (
    <SafeAreaView edges={['bottom']} style={[styles.screen, {backgroundColor: colors.background}]}>
      <FlatList
        data={data}
        keyExtractor={item => item.roomId}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[data.length ? styles.listPageContent : styles.emptyPageContent, {paddingTop: topPadding}]}
        ListHeaderComponent={
          <View style={styles.requestHeader}>
            {error ? <Text style={[styles.error, {backgroundColor: colors.dangerSoft, color: colors.danger}]}>{error}</Text> : null}
            <View style={[styles.segment, {backgroundColor: colors.input}]}>
              <Pressable onPress={() => setRequestTab('incoming')} style={[styles.segmentItem, requestTab === 'incoming' ? {backgroundColor: colors.primary} : null]}>
                <Text style={[styles.segmentText, {color: requestTab === 'incoming' ? '#fff' : colors.secondaryText}]}>Nhận {incomingRequests.length || ''}</Text>
              </Pressable>
              <Pressable onPress={() => setRequestTab('outgoing')} style={[styles.segmentItem, requestTab === 'outgoing' ? {backgroundColor: colors.primary} : null]}>
                <Text style={[styles.segmentText, {color: requestTab === 'outgoing' ? '#fff' : colors.secondaryText}]}>Đã gửi {sentRequests.length || ''}</Text>
              </Pressable>
            </View>
          </View>
        }
        renderItem={({item}) => (
          <View style={[styles.requestRow, {borderBottomColor: colors.separator}]}>
            <MatrixAvatar label={item.title || item.userId} uri={item.avatarUrl} size={44} backgroundColor={colors.primary} />
            <View style={styles.rowText}>
              <Text numberOfLines={1} style={[styles.rowTitle, {color: colors.text}]}>{item.title}</Text>
              <Text numberOfLines={1} style={[styles.rowSubtitle, {color: colors.secondaryText}]}>{shortContactId(item.userId)}</Text>
            </View>
            {requestTab === 'incoming' ? (
              <>
                <Pressable accessibilityRole="button" onPress={() => acceptRequest(item)} style={({pressed}) => [styles.acceptButton, {backgroundColor: colors.primary}, pressed ? styles.pressed : null]}>
                  <Text style={styles.smallButtonText}>Nhận</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => declineRequest(item)} style={({pressed}) => [styles.softButton, {backgroundColor: colors.input}, pressed ? styles.pressed : null]}>
                  <Text style={[styles.softButtonText, {color: colors.secondaryText}]}>Bỏ</Text>
                </Pressable>
              </>
            ) : (
              <Pressable accessibilityRole="button" onPress={() => declineRequest(item)} style={({pressed}) => [styles.softButton, {backgroundColor: colors.input}, pressed ? styles.pressed : null]}>
                <Text style={[styles.softButtonText, {color: colors.secondaryText}]}>Thu hồi</Text>
              </Pressable>
            )}
          </View>
        )}
        ListEmptyComponent={
          <EmptyState
            title={requestTab === 'incoming' ? 'Chưa có yêu cầu mới' : 'Chưa gửi yêu cầu nào'}
            subtitle={requestTab === 'incoming' ? 'Khi có người thêm bạn, yêu cầu sẽ hiện ở đây.' : 'Các yêu cầu bạn đã gửi sẽ hiện ở đây để có thể thu hồi.'}
          />
        }
      />
    </SafeAreaView>
  );
}

export function GroupRequestsScreen({navigation}: StackProps<'GroupRequests'>) {
  const colors = useAppTheme();
  const topPadding = usePageTopPadding();
  const {state} = useSession();
  const [requests, setRequests] = useState<GroupInvite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const usingNative = state.status === 'signed_in' && nativeMatrixService.isActive();

  const refresh = useCallback(async () => {
    if (state.status === 'demo') {
      setRequests([]);
      return;
    }
    try {
      const next = usingNative
        ? await nativeMatrixService.listGroupInvites()
        : new RoomService(matrixClientService.currentClient).listGroupInvites();
      setRequests(next);
    } catch (err) {
      setError(matrixErrorMessage(err));
    }
  }, [state.status, usingNative]);

  useFocusEffect(useCallback(() => {
    refresh();
  }, [refresh]));

  async function acceptRequest(request: GroupInvite) {
    setError(null);
    try {
      const roomId = usingNative
        ? await nativeMatrixService.acceptInvite(request.roomId)
        : await new RoomService(matrixClientService.currentClient).acceptInvite(request.roomId);
      await refresh();
      navigation.navigate('Chat', {roomId, title: request.title});
    } catch (err) {
      setError(matrixErrorMessage(err));
    }
  }

  async function declineRequest(request: GroupInvite) {
    setError(null);
    try {
      if (usingNative) {
        await nativeMatrixService.leaveRoom(request.roomId);
      } else {
        await new RoomService(matrixClientService.currentClient).leaveRoom(request.roomId);
      }
      await refresh();
    } catch (err) {
      setError(matrixErrorMessage(err));
    }
  }

  return (
    <SafeAreaView edges={['bottom']} style={[styles.screen, {backgroundColor: colors.background}]}>
      <FlatList
        data={requests}
        keyExtractor={item => item.roomId}
        contentContainerStyle={[requests.length ? styles.listPageContent : styles.emptyPageContent, {paddingTop: topPadding}]}
        ListHeaderComponent={error ? <Text style={[styles.error, {backgroundColor: colors.dangerSoft, color: colors.danger}]}>{error}</Text> : null}
        renderItem={({item}) => (
          <View style={[styles.requestRow, {borderBottomColor: colors.separator}]}>
            <MatrixAvatar label={item.title} uri={item.avatarUrl} size={44} backgroundColor={colors.primary} />
            <View style={styles.rowText}>
              <Text numberOfLines={1} style={[styles.rowTitle, {color: colors.text}]}>{item.title}</Text>
              <Text numberOfLines={1} style={[styles.rowSubtitle, {color: colors.secondaryText}]}>
                {item.inviter ? `Mời bởi ${shortContactId(item.inviter)}` : item.memberCount ? `${item.memberCount} thành viên` : 'Phòng'}
              </Text>
            </View>
            <Pressable accessibilityRole="button" onPress={() => acceptRequest(item)} style={({pressed}) => [styles.acceptButton, {backgroundColor: colors.primary}, pressed ? styles.pressed : null]}>
              <Text style={styles.smallButtonText}>Vào</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => declineRequest(item)} style={({pressed}) => [styles.softButton, {backgroundColor: colors.input}, pressed ? styles.pressed : null]}>
              <Text style={[styles.softButtonText, {color: colors.secondaryText}]}>Bỏ</Text>
            </Pressable>
          </View>
        )}
        ListEmptyComponent={<EmptyState title="Không có lời mời" subtitle="Khi có người mời vào nhóm, lời mời sẽ nằm ở đây." />}
      />
    </SafeAreaView>
  );
}

function ActionRow({icon, onPress, subtitle, title}: {icon: string; onPress: () => void; subtitle: string; title: string}) {
  const colors = useAppTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({pressed}) => [styles.actionRow, {backgroundColor: colors.surface, shadowColor: colors.shadow}, pressed ? styles.pressed : null]}>
      <View style={[styles.actionIcon, {backgroundColor: colors.input}]}>
        <Text style={[styles.actionIconText, {color: colors.primary}]}>{icon}</Text>
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.actionTitle, {color: colors.text}]}>{title}</Text>
        <Text style={[styles.actionSubtitle, {color: colors.secondaryText}]}>{subtitle}</Text>
      </View>
      <Text style={[styles.chevron, {color: colors.tertiaryText}]}>›</Text>
    </Pressable>
  );
}

function SegmentButton({active, label, onPress}: {active: boolean; label: string; onPress: () => void}) {
  const colors = useAppTheme();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{selected: active}}
      onPress={onPress}
      style={({pressed}) => [
        styles.segmentItem,
        active ? {backgroundColor: colors.primary} : null,
        pressed ? styles.pressed : null,
      ]}>
      <Text style={[styles.segmentText, {color: active ? '#fff' : colors.secondaryText}]}>{label}</Text>
    </Pressable>
  );
}

function EmptyState({subtitle, title}: {subtitle: string; title: string}) {
  const colors = useAppTheme();
  return (
    <View style={styles.emptyState}>
      <Text style={[styles.emptyTitle, {color: colors.text}]}>{title}</Text>
      <Text style={[styles.emptyText, {color: colors.secondaryText}]}>{subtitle}</Text>
    </View>
  );
}

function usePageTopPadding() {
  const insets = useSafeAreaInsets();
  return insets.top + 64;
}

function serverNameFromBaseUrl(baseUrl: string): string | undefined {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return undefined;
  }
}

function nativeRoomToForwardTarget(room: NativeRoomSummary): ForwardTarget {
  return {
    roomId: room.roomId,
    title: room.name,
    avatarUrl: room.avatarUrl,
    subtitle: room.isDirect ? 'Trò chuyện trực tiếp' : `${room.joinedMembersCount ?? 0} thành viên`,
  };
}

async function localForwardMediaUri(message: TimelineItem): Promise<string> {
  const resolved = await resolveMatrixMediaUri(message);
  if (!/^https?:\/\//i.test(resolved)) {
    return resolved;
  }
  const safeName = (message.mediaFileName ?? `forward-${Date.now()}.bin`).replace(/[^a-z0-9._-]+/gi, '-').slice(-120);
  const target = `${RNFS.CachesDirectoryPath}/forward-${Date.now()}-${safeName}`;
  const result = await RNFS.downloadFile({
    fromUrl: resolved,
    toFile: target,
    headers: message.mediaHeaders,
  }).promise;
  if (result.statusCode >= 400) {
    await RNFS.unlink(target).catch(() => undefined);
    throw new Error('Không tải được nội dung cần chuyển tiếp.');
  }
  return `file://${target}`;
}

function localPathFromForwardUri(uri: string): string {
  if (!uri.startsWith('file://')) {
    return uri;
  }
  try {
    return decodeURIComponent(uri.slice('file://'.length));
  } catch {
    return uri.slice('file://'.length);
  }
}

const styles = StyleSheet.create({
  screen: {flex: 1},
  menuContent: {padding: 16, gap: 12},
  formContent: {padding: 18, paddingBottom: 36, gap: 12},
  listPageContent: {paddingHorizontal: 16, paddingBottom: 32},
  emptyPageContent: {flexGrow: 1, paddingHorizontal: 16, paddingBottom: 32},
  pageTitle: {fontSize: 30, lineHeight: 36, fontWeight: '900', marginTop: 4},
  pageSubtitle: {fontSize: 15, lineHeight: 21, fontWeight: '600', marginBottom: 4},
  actionRow: {
    minHeight: 76,
    borderRadius: 20,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowOffset: {width: 0, height: 6},
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 1,
  },
  actionIcon: {width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center'},
  actionIconText: {fontSize: 20, fontWeight: '900'},
  actionTitle: {fontSize: 17, lineHeight: 21, fontWeight: '800'},
  actionSubtitle: {fontSize: 13, lineHeight: 18, fontWeight: '600', marginTop: 2},
  rowText: {flex: 1, minWidth: 0},
  chevron: {fontSize: 26, fontWeight: '300'},
  input: {height: 52, borderRadius: 18, paddingHorizontal: 16, fontSize: 16, fontWeight: '700'},
  inlineRow: {height: 52, flexDirection: 'row', alignItems: 'center', gap: 8},
  inlineInput: {flex: 1},
  multiInput: {height: 96, paddingTop: 14, textAlignVertical: 'top'},
  primaryButton: {height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center'},
  smallButton: {height: 52, borderRadius: 18, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center'},
  buttonText: {color: '#fff', fontSize: 15, fontWeight: '900'},
  smallButtonText: {color: '#fff', fontSize: 13, fontWeight: '900'},
  softButtonText: {fontSize: 13, fontWeight: '900'},
  resultRow: {minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: StyleSheet.hairlineWidth},
  requestHeader: {paddingTop: 8, paddingBottom: 12, gap: 12},
  requestRow: {minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth},
  rowTitle: {fontSize: 16, lineHeight: 20, fontWeight: '800'},
  rowSubtitle: {fontSize: 13, lineHeight: 18, fontWeight: '600', marginTop: 2},
  rowAction: {fontSize: 14, fontWeight: '900'},
  acceptButton: {height: 34, borderRadius: 17, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center'},
  softButton: {height: 34, borderRadius: 17, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center'},
  segment: {height: 38, borderRadius: 19, flexDirection: 'row', padding: 3},
  threeSegment: {height: 42, borderRadius: 21, flexDirection: 'row', padding: 3},
  segmentItem: {flex: 1, borderRadius: 16, alignItems: 'center', justifyContent: 'center'},
  segmentText: {fontSize: 13, fontWeight: '900'},
  myQrCard: {borderRadius: 26, padding: 22, alignItems: 'center', gap: 10},
  myQrTitle: {fontSize: 20, fontWeight: '900', marginTop: 2},
  myQrId: {fontSize: 14, fontWeight: '700', marginBottom: 8},
  myQrHint: {fontSize: 13, lineHeight: 19, fontWeight: '600', textAlign: 'center', maxWidth: 280},
  copyIdButton: {height: 46, borderRadius: 23, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center', marginTop: 2},
  groupHeader: {gap: 12, paddingBottom: 6},
  selectionSummary: {fontSize: 13, fontWeight: '800'},
  checkCircle: {width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: 'center', justifyContent: 'center'},
  checkMark: {color: '#fff', fontSize: 16, fontWeight: '900'},
  bottomAction: {position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 24, borderTopWidth: StyleSheet.hairlineWidth},
  emptyState: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20},
  emptyTitle: {fontSize: 18, fontWeight: '900'},
  emptyText: {fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 6, fontWeight: '600'},
  error: {borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, overflow: 'hidden', fontWeight: '700'},
  disabled: {opacity: 0.42},
  pressed: {opacity: 0.72},
});
