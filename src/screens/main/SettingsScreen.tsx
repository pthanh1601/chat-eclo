import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, Alert, AppState, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {createNativeStackNavigator, type NativeStackScreenProps} from '@react-navigation/native-stack';
import {useFocusEffect} from '@react-navigation/native';
import {useSafeAreaInsets} from '../../platform/safeArea';
import {launchImageLibrary, type Asset} from 'react-native-image-picker';
import {matrixClientService} from '../../core/matrix/MatrixClientService';
import {RoomService} from '../../core/matrix/RoomService';
import {nativeMatrixService} from '../../core/matrix/NativeMatrixService';
import {matrixErrorMessage} from '../../core/matrix/errors';
import type {SecurityStatus, SecurityVerification} from '../../core/models/session';
import {
  deleteAccountDevice,
  listAccountDevices,
  loadBlockedUsers,
  loadLocalBlockedUsers,
  saveBlockedUsers,
  saveLocalBlockedUsers,
  type AccountDevice,
} from '../../core/matrix/AccountManagementService';
import {
  loadMatrixProfile,
  loadStoredProfile,
  mergeEcloProfile,
  saveStoredProfile,
  clearStoredProfile,
  shortMatrixId,
  updateMatrixAvatar,
  updateMatrixDisplayName,
  type StoredProfile,
} from '../../core/matrix/ProfileSettingsService';
import {
  changeAccountPassword,
  EcloApiError,
  getEcloProfile,
  normalizeEmail,
  normalizeOtp,
  patchEcloProfile,
  requestAccountDeletionCode,
  requestProfileEmailCode,
  verifyAccountDeletion,
  verifyProfileEmail,
} from '../../core/api/EcloAuthProfileService';
import {
  displayNameForContact,
  loadLocalContacts,
  mergeContacts,
  shortContactId,
  type ContactRecord,
} from '../../core/matrix/ContactService';
import {useSession} from '../../context/SessionContext';
import {
  APP_ACCENT_COLORS,
  APP_FONT_OPTIONS,
  CHAT_BACKGROUND_OPTIONS,
  type ThemeMode,
  useAppSettings,
} from '../../context/AppSettingsContext';
import {useAppTheme} from '../../theme/useAppTheme';
import {MatrixAvatar} from '../../components/MatrixAvatar';
import {GlassButton} from '../../components/GlassButton';
import {AUTH_PASSWORD_MIN_LENGTH, OTP_MAX_DIGITS, OTP_MIN_DIGITS} from '../../config/appConfig';

type Device = AccountDevice;

type SettingsPage = 'profile' | 'general' | 'privacy' | 'security' | 'devices' | 'about';

type SettingsStackParamList = {
  SettingsHome: undefined;
  SettingsDetail: {page: SettingsPage};
  SettingsPassword: undefined;
  SettingsEmail: undefined;
  SettingsDeactivate: undefined;
  SettingsBlockUser: undefined;
  SettingsRemoveDevice: {deviceId: string; displayName?: string};
};

type SettingItem = {
  id: SettingsPage;
  title: string;
  subtitle: string;
  icon: string;
  color: string;
};

const SettingsStack = createNativeStackNavigator<SettingsStackParamList>();

const settingItems: SettingItem[] = [
  {id: 'profile', title: 'Hồ sơ cá nhân', subtitle: 'Tên hiển thị và ảnh đại diện', icon: '◎', color: '#0b7cff'},
  {id: 'general', title: 'Cài đặt chung', subtitle: 'Giao diện và thông báo', icon: '⚙', color: '#8e8e93'},
  {id: 'privacy', title: 'Quyền riêng tư', subtitle: 'Tài khoản và chia sẻ dữ liệu', icon: '◐', color: '#ff3b30'},
  {id: 'security', title: 'Bảo mật', subtitle: 'Bảo vệ và sao lưu tin nhắn', icon: '♢', color: '#34c759'},
  {id: 'devices', title: 'Quản lý thiết bị', subtitle: 'Thiết bị đang đăng nhập', icon: '▭', color: '#ff9500'},
  {id: 'about', title: 'Thông tin ứng dụng', subtitle: 'Phiên bản và thông tin', icon: 'i', color: '#5e5ce6'},
];

const settingGroups: SettingItem[][] = [
  settingItems.slice(0, 1),
  settingItems.slice(1, 4),
  settingItems.slice(4),
];

export function SettingsScreen() {
  const colors = useAppTheme();

  return (
    <SettingsStack.Navigator
      screenOptions={{
        headerShown: true,
        animation: 'slide_from_right',
        headerTransparent: true,
        headerStyle: {backgroundColor: 'transparent'},
        headerBackground: () => null,
        headerTitleAlign: 'center',
        headerTitleStyle: {color: colors.text, fontSize: 18, fontWeight: '800'},
        headerTintColor: colors.primary,
        headerShadowVisible: false,
        contentStyle: {backgroundColor: colors.background},
      }}>
      <SettingsStack.Screen name="SettingsHome" component={SettingsHomeScreen} options={{title: 'Cài đặt'}} />
      <SettingsStack.Screen
        name="SettingsDetail"
        component={SettingsDetailScreen}
        options={({navigation, route}) => ({
          title: titleForSettingsPage(route.params.page),
          headerBackVisible: false,
          headerLeft: () => <SettingsBackButton onPress={navigation.goBack} />,
        })}
      />
      <SettingsStack.Screen
        name="SettingsPassword"
        component={PasswordScreen}
        options={({navigation}) => ({
          title: 'Đổi mật khẩu',
          headerBackVisible: false,
          headerLeft: () => <SettingsBackButton onPress={navigation.goBack} />,
        })}
      />
      <SettingsStack.Screen
        name="SettingsEmail"
        component={EmailSettingsScreen}
        options={({navigation}) => ({
          title: 'Đổi email',
          headerBackVisible: false,
          headerLeft: () => <SettingsBackButton onPress={navigation.goBack} />,
        })}
      />
      <SettingsStack.Screen
        name="SettingsDeactivate"
        component={DeactivateAccountScreen}
        options={({navigation}) => ({
          title: 'Xóa tài khoản',
          headerBackVisible: false,
          headerLeft: () => <SettingsBackButton onPress={navigation.goBack} />,
        })}
      />
      <SettingsStack.Screen
        name="SettingsBlockUser"
        component={BlockUserScreen}
        options={({navigation}) => ({
          title: 'Chặn tài khoản',
          headerBackVisible: false,
          headerLeft: () => <SettingsBackButton onPress={navigation.goBack} />,
        })}
      />
      <SettingsStack.Screen
        name="SettingsRemoveDevice"
        component={RemoveDeviceScreen}
        options={({navigation}) => ({
          title: 'Xóa thiết bị',
          headerBackVisible: false,
          headerLeft: () => <SettingsBackButton onPress={navigation.goBack} />,
        })}
      />
    </SettingsStack.Navigator>
  );
}

function SettingsHomeScreen({navigation}: NativeStackScreenProps<SettingsStackParamList, 'SettingsHome'>) {
  const colors = useAppTheme();
  const insets = useSafeAreaInsets();
  const {signOut, state} = useSession();
  const profile = useProfileInfo();

  useFocusEffect(useCallback(() => {
    profile.refresh();
  }, [profile.refresh]));

  return (
    <View style={[styles.screen, {backgroundColor: colors.background}]}>
      <ScrollView contentContainerStyle={[styles.content, {paddingTop: insets.top + 58}]} showsVerticalScrollIndicator={false}>
        <View style={styles.profileTop}>
          <MatrixAvatar label={profile.displayName} uri={profile.avatarUrl} size={96} backgroundColor={colors.primary} style={{shadowColor: colors.shadow}} />
          <Text numberOfLines={1} style={[styles.name, {color: colors.text}]}>{profile.displayName}</Text>
          <Text numberOfLines={1} style={[styles.account, {color: colors.secondaryText}]}>{profile.shortUserId}</Text>
        </View>

        {settingGroups.map((group, groupIndex) => (
          <View key={group.map(item => item.id).join('-')} style={[styles.menuGroup, groupIndex > 0 ? styles.menuGroupGap : null, {backgroundColor: colors.surface, shadowColor: colors.shadow}]}>
            {group.map((item, index) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                onPress={() => navigation.navigate('SettingsDetail', {page: item.id})}
                style={({pressed}) => [styles.menuRow, pressed ? styles.rowPressed : null]}>
                <View style={[styles.menuIcon, {backgroundColor: item.color}]}>
                  <Text style={styles.menuIconText}>{item.icon}</Text>
                </View>
                <View style={[styles.menuText, index < group.length - 1 ? {borderBottomColor: colors.separator, borderBottomWidth: StyleSheet.hairlineWidth} : null]}>
                  <View style={styles.menuTitleBlock}>
                    <Text numberOfLines={1} style={[styles.menuTitle, {color: colors.text}]}>{item.title}</Text>
                    <Text numberOfLines={1} style={[styles.menuSubtitle, {color: colors.tertiaryText}]}>{item.subtitle}</Text>
                  </View>
                  <Text style={[styles.chevron, {color: colors.tertiaryText}]}>›</Text>
                </View>
              </Pressable>
            ))}
          </View>
        ))}

        <View style={[styles.menuGroup, styles.menuGroupGap, {backgroundColor: colors.surface, shadowColor: colors.shadow}]}>
          <Pressable accessibilityRole="button" onPress={signOut} style={({pressed}) => [styles.logoutRow, pressed ? styles.rowPressed : null]}>
            <Text style={[styles.logoutText, {color: colors.danger}]}>Đăng xuất</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

function PasswordScreen() {
  const colors = useAppTheme();
  const insets = useSafeAreaInsets();
  const {state} = useSession();
  const profile = useProfileInfo();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function submit() {
    setStatus(null);
    if (state.status !== 'signed_in') {
      setStatus('Đổi mật khẩu cần đăng nhập bằng tài khoản thật.');
      return;
    }
    if (!profile.email || !profile.emailVerified) {
      setStatus('Tài khoản cần có email đã xác thực. Hãy cập nhật email trước.');
      return;
    }
    if (!currentPassword.trim()) {
      setStatus('Nhập mật khẩu hiện tại.');
      return;
    }
    if (newPassword.length < AUTH_PASSWORD_MIN_LENGTH) {
      setStatus(`Mật khẩu mới cần ít nhất ${AUTH_PASSWORD_MIN_LENGTH} ký tự.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setStatus('Mật khẩu nhập lại chưa khớp.');
      return;
    }
    setBusy(true);
    try {
      await changeAccountPassword(state.auth, profile.email, currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setStatus('Đã đổi mật khẩu.');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Không thể đổi mật khẩu.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.screen, {backgroundColor: colors.background}]}>
      <ScrollView contentContainerStyle={[styles.pageContent, {paddingTop: insets.top + 76}]} showsVerticalScrollIndicator={false}>
        <View style={[styles.mobileSettingCard, {backgroundColor: colors.surface, shadowColor: colors.shadow}]}>
          <ProfileField icon="•" color="#8e8e93" label="Mật khẩu hiện tại" value={currentPassword} onChangeText={setCurrentPassword} placeholder="Nhập mật khẩu hiện tại" secureTextEntry />
          <ProfileField icon="•" color={colors.primary} label="Mật khẩu mới" value={newPassword} onChangeText={setNewPassword} placeholder={`Ít nhất ${AUTH_PASSWORD_MIN_LENGTH} ký tự`} secureTextEntry />
          <ProfileField icon="•" color={colors.primary} label="Nhập lại" value={confirmPassword} onChangeText={setConfirmPassword} placeholder="Nhập lại mật khẩu mới" secureTextEntry />
        </View>
        {status ? <Text style={[styles.profileStatus, {backgroundColor: colors.input, color: status.startsWith('Đã') ? colors.success : colors.danger}]}>{status}</Text> : null}
        <Pressable accessibilityRole="button" disabled={busy} onPress={submit} style={({pressed}) => [styles.profileSaveButton, {backgroundColor: colors.primary}, pressed ? styles.pressed : null]}>
          <Text style={styles.passwordButtonText}>{busy ? 'Đang đổi...' : 'Đổi mật khẩu'}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function EmailSettingsScreen({navigation}: NativeStackScreenProps<SettingsStackParamList, 'SettingsEmail'>) {
  const colors = useAppTheme();
  const insets = useSafeAreaInsets();
  const {state} = useSession();
  const profile = useProfileInfo();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function submit() {
    setStatus(null);
    if (state.status !== 'signed_in') {
      setStatus('Đổi email cần đăng nhập bằng tài khoản thật.');
      return;
    }
    const nextEmail = normalizeEmail(email);
    if (!/^\S+@\S+\.\S+$/.test(nextEmail)) {
      setStatus('Email không hợp lệ.');
      return;
    }
    if (step === 'otp' && normalizeOtp(code).length < OTP_MIN_DIGITS) {
      setStatus(`Nhập mã xác thực gồm ${OTP_MIN_DIGITS}-${OTP_MAX_DIGITS} chữ số.`);
      return;
    }
    setBusy(true);
    try {
      if (step === 'email') {
        await requestProfileEmailCode(state.auth, nextEmail);
        setEmail(nextEmail);
        setStep('otp');
        setStatus('Đã gửi mã xác thực tới email mới.');
      } else {
        await verifyProfileEmail(state.auth, nextEmail, code);
        setStatus('Đã xác thực và cập nhật email.');
        navigation.goBack();
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Không thể cập nhật email.');
    } finally {
      setBusy(false);
    }
  }

  async function resendCode() {
    if (state.status !== 'signed_in') return;
    setBusy(true);
    setStatus(null);
    try {
      await requestProfileEmailCode(state.auth, email);
      setStatus('Đã gửi lại mã xác thực.');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Không thể gửi lại mã.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.screen, {backgroundColor: colors.background}]}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.pageContent, {paddingTop: insets.top + 76}]} showsVerticalScrollIndicator={false}>
        <View style={[styles.deactivateWarning, {backgroundColor: colors.input}]}>
          <Text style={[styles.deactivateTitle, {color: colors.text}]}>Email hiện tại</Text>
          <Text style={[styles.deactivateText, {color: colors.secondaryText}]}>{profile.email || 'Chưa thiết lập'} · {profile.emailVerified ? 'Đã xác thực' : 'Chưa xác thực'}</Text>
        </View>
        <View style={[styles.mobileSettingCard, {backgroundColor: colors.surface, shadowColor: colors.shadow}]}>
          <ProfileField autoCapitalize="none" icon="✉" color={colors.primary} keyboardType="email-address" label="Email mới" value={email} onChangeText={setEmail} placeholder="email@domain.com" />
          {step === 'otp' ? <ProfileField autoCapitalize="none" icon="#" color="#34c759" keyboardType="phone-pad" label="Mã xác thực" value={code} onChangeText={value => setCode(normalizeOtp(value))} placeholder={`${OTP_MIN_DIGITS}-${OTP_MAX_DIGITS} chữ số`} /> : null}
        </View>
        {status ? <Text style={[styles.profileStatus, {backgroundColor: colors.input, color: status.startsWith('Đã') ? colors.success : colors.danger}]}>{status}</Text> : null}
        <Pressable accessibilityRole="button" disabled={busy} onPress={submit} style={({pressed}) => [styles.profileSaveButton, {backgroundColor: colors.primary}, pressed ? styles.pressed : null]}>
          <Text style={styles.passwordButtonText}>{busy ? 'Đang xử lý...' : step === 'email' ? 'Gửi mã xác thực' : 'Xác thực email'}</Text>
        </Pressable>
        {step === 'otp' ? <Pressable accessibilityRole="button" disabled={busy} onPress={resendCode} style={styles.inlineLinkButton}><Text style={[styles.inlineLinkText, {color: colors.primary}]}>Gửi lại mã</Text></Pressable> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function DeactivateAccountScreen() {
  const colors = useAppTheme();
  const insets = useSafeAreaInsets();
  const {state, signOut} = useSession();
  const profile = useProfileInfo();
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'confirm' | 'otp'>('confirm');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function submit() {
    setStatus(null);
    if (state.status !== 'signed_in') {
      setStatus('Tính năng này cần đăng nhập bằng tài khoản thật.');
      return;
    }
    if (!profile.email || !profile.emailVerified) {
      setStatus('Tài khoản chưa có email đã xác thực để nhận mã xóa tài khoản.');
      return;
    }
    if (step === 'otp' && normalizeOtp(code).length < OTP_MIN_DIGITS) {
      setStatus(`Nhập mã xác thực gồm ${OTP_MIN_DIGITS}-${OTP_MAX_DIGITS} chữ số.`);
      return;
    }
    setBusy(true);
    try {
      if (step === 'confirm') {
        await requestAccountDeletionCode(state.auth, profile.email);
        setStep('otp');
        setStatus('Mã xác nhận đã được gửi tới email tài khoản.');
      } else {
        await verifyAccountDeletion(state.auth, profile.email, code);
        await nativeMatrixService.purgeSessionData(state.auth);
        await clearStoredProfile(state.auth.userId).catch(() => undefined);
        await signOut();
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Không thể xóa tài khoản.');
    } finally {
      setBusy(false);
    }
  }

  async function resendCode() {
    if (state.status !== 'signed_in' || !profile.email) return;
    setBusy(true);
    setStatus(null);
    try {
      await requestAccountDeletionCode(state.auth, profile.email);
      setStatus('Mã xác nhận mới đã được gửi tới email tài khoản.');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Không thể gửi lại mã.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.screen, {backgroundColor: colors.background}]}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.pageContent, {paddingTop: insets.top + 76}]} showsVerticalScrollIndicator={false}>
        <View style={[styles.deactivateWarning, {backgroundColor: colors.dangerSoft}]}>
          <Text style={[styles.deactivateTitle, {color: colors.danger}]}>Thao tác này không thể hoàn tác</Text>
          <Text style={[styles.deactivateText, {color: colors.text}]}>ECLO sẽ gửi mã tới {profile.email || 'email tài khoản'}. Sau khi xác thực, tài khoản và toàn bộ hồ sơ ECLO sẽ bị xóa.</Text>
        </View>
        {step === 'otp' ? (
          <View style={[styles.mobileSettingCard, {backgroundColor: colors.surface, shadowColor: colors.shadow}]}>
            <ProfileField autoCapitalize="none" icon="#" color="#ff3b30" keyboardType="phone-pad" label="Mã xác nhận" value={code} onChangeText={value => setCode(normalizeOtp(value))} placeholder={`${OTP_MIN_DIGITS}-${OTP_MAX_DIGITS} chữ số`} />
          </View>
        ) : null}
        {status ? <Text style={[styles.profileStatus, {backgroundColor: colors.input, color: status.startsWith('Mã') ? colors.success : colors.danger}]}>{status}</Text> : null}
        <Pressable accessibilityRole="button" disabled={busy} onPress={submit} style={({pressed}) => [styles.profileSaveButton, {backgroundColor: colors.danger}, pressed ? styles.pressed : null]}>
          <Text style={styles.passwordButtonText}>{busy ? 'Đang xử lý...' : step === 'confirm' ? 'Gửi mã xóa tài khoản' : 'Xác nhận xóa vĩnh viễn'}</Text>
        </Pressable>
        {step === 'otp' ? <Pressable accessibilityRole="button" disabled={busy} onPress={resendCode} style={styles.inlineLinkButton}><Text style={[styles.inlineLinkText, {color: colors.primary}]}>Gửi lại mã</Text></Pressable> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function BlockUserScreen({navigation}: NativeStackScreenProps<SettingsStackParamList, 'SettingsBlockUser'>) {
  const colors = useAppTheme();
  const insets = useSafeAreaInsets();
  const {state} = useSession();
  const ownerId = state.status === 'signed_in' ? state.auth.userId : state.status === 'demo' ? state.userId : '@guest:local';
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [query, setQuery] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setStatus(null);
    Promise.all([
      loadLocalContacts(ownerId),
      state.status === 'signed_in'
        ? (nativeMatrixService.isActive()
            ? nativeMatrixService.listDirectContacts()
            : Promise.resolve().then(() => new RoomService(matrixClientService.currentClient).listDirectContacts()))
        : Promise.resolve([] as ContactRecord[]),
      state.status === 'signed_in'
        ? loadBlockedUsers(state.auth)
        : loadLocalBlockedUsers(ownerId),
    ])
      .then(([localContacts, directContacts, blockedUsers]) => {
        if (cancelled) return;
        const blocked = new Set(blockedUsers);
        setContacts(mergeContacts(localContacts, directContacts)
          .filter(contact => contact.userId !== ownerId && !blocked.has(contact.userId)));
      })
      .catch(err => {
        if (!cancelled) setStatus(matrixErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ownerId, state]);

  const visibleContacts = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase('vi');
    if (!keyword) return contacts;
    return contacts.filter(contact => (
      displayNameForContact(contact).toLocaleLowerCase('vi').includes(keyword)
      || shortContactId(contact.userId).toLocaleLowerCase('vi').includes(keyword)
    ));
  }, [contacts, query]);

  async function submit() {
    setStatus(null);
    if (!selectedUserId) {
      setStatus('Chọn một người trong danh bạ.');
      return;
    }
    setBusy(true);
    try {
      if (state.status === 'signed_in') {
        if (nativeMatrixService.isActive()) {
          await nativeMatrixService.ignoreUser(selectedUserId);
        } else {
          const users = await loadBlockedUsers(state.auth);
          await saveBlockedUsers(state.auth, [...new Set([...users, selectedUserId])].sort());
        }
      } else {
        const users = await loadLocalBlockedUsers(ownerId);
        await saveLocalBlockedUsers(ownerId, [...new Set([...users, selectedUserId])].sort());
      }
      navigation.goBack();
    } catch (err) {
      setStatus(matrixErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.screen, {backgroundColor: colors.background}]}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.pageContent, {paddingTop: insets.top + 76}]} showsVerticalScrollIndicator={false}>
        <View style={[styles.actionIntroCard, {backgroundColor: colors.surface, shadowColor: colors.shadow}]}>
          <View style={[styles.actionHeroIcon, {backgroundColor: colors.dangerSoft}]}>
            <Text style={[styles.actionHeroIconText, {color: colors.danger}]}>⊘</Text>
          </View>
          <Text style={[styles.actionTitle, {color: colors.text}]}>Chặn tài khoản</Text>
          <Text style={[styles.actionText, {color: colors.secondaryText}]}>Bạn sẽ không nhận tin nhắn trực tiếp từ người này.</Text>
        </View>

        <View style={[styles.mobileSettingCard, {backgroundColor: colors.surface, shadowColor: colors.shadow}]}> 
          <View style={[styles.contactSearchBox, {backgroundColor: colors.input}]}> 
            <Text style={[styles.contactSearchIcon, {color: colors.tertiaryText}]}>⌕</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setQuery}
              placeholder="Tìm trong danh bạ"
              placeholderTextColor={colors.tertiaryText}
              style={[styles.contactSearchInput, {color: colors.text}]}
              value={query}
            />
          </View>
          {loading ? (
            <View style={styles.contactPickerEmpty}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : visibleContacts.length ? visibleContacts.map((contact, index) => {
            const selected = selectedUserId === contact.userId;
            return (
              <Pressable
                key={contact.userId}
                accessibilityRole="button"
                accessibilityState={{selected}}
                onPress={() => setSelectedUserId(contact.userId)}
                style={({pressed}) => [
                  styles.contactPickerRow,
                  index > 0 ? {borderTopColor: colors.separator, borderTopWidth: StyleSheet.hairlineWidth} : null,
                  selected ? {backgroundColor: colors.dangerSoft} : null,
                  pressed ? styles.pressed : null,
                ]}>
                <MatrixAvatar label={displayNameForContact(contact)} uri={contact.avatarUrl} size={46} backgroundColor={colors.primary} />
                <View style={styles.flex1}>
                  <Text numberOfLines={1} style={[styles.contactPickerName, {color: colors.text}]}>{displayNameForContact(contact)}</Text>
                  <Text numberOfLines={1} style={[styles.contactPickerUsername, {color: colors.secondaryText}]}>{shortContactId(contact.userId)}</Text>
                </View>
                <View style={[styles.contactPickerCheck, {borderColor: selected ? colors.danger : colors.separator, backgroundColor: selected ? colors.danger : colors.surface}]}>
                  {selected ? <Text style={styles.contactPickerCheckText}>✓</Text> : null}
                </View>
              </Pressable>
            );
          }) : (
            <View style={styles.contactPickerEmpty}>
              <Text style={[styles.emptyText, {color: colors.secondaryText}]}>{query.trim() ? 'Không tìm thấy người phù hợp' : 'Danh bạ chưa có người để chặn'}</Text>
            </View>
          )}
        </View>
        {status ? <Text style={[styles.profileStatus, {backgroundColor: colors.input, color: colors.danger}]}>{status}</Text> : null}
        <Pressable
          accessibilityRole="button"
          disabled={busy || !selectedUserId}
          onPress={submit}
          style={({pressed}) => [styles.profileSaveButton, {backgroundColor: selectedUserId ? colors.danger : colors.input}, pressed && selectedUserId ? styles.pressed : null]}>
          <Text style={[styles.profileSaveText, {color: selectedUserId ? '#fff' : colors.tertiaryText}]}>{busy ? 'Đang chặn...' : 'Chặn người đã chọn'}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function RemoveDeviceScreen({route, navigation}: NativeStackScreenProps<SettingsStackParamList, 'SettingsRemoveDevice'>) {
  const colors = useAppTheme();
  const insets = useSafeAreaInsets();
  const {removeDevice} = useSettingsRuntime();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const deviceName = route.params.displayName?.trim() || 'Thiết bị không tên';

  async function submit() {
    setStatus(null);
    if (!password.trim()) {
      setStatus('Nhập mật khẩu để xác nhận.');
      return;
    }
    setBusy(true);
    try {
      await removeDevice(route.params.deviceId, password);
      navigation.goBack();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Không thể xóa thiết bị.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.screen, {backgroundColor: colors.background}]}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.pageContent, {paddingTop: insets.top + 76}]} showsVerticalScrollIndicator={false}>
        <View style={[styles.actionIntroCard, {backgroundColor: colors.surface, shadowColor: colors.shadow}]}>
          <View style={[styles.actionHeroIcon, {backgroundColor: colors.dangerSoft}]}>
            <Text style={[styles.actionHeroIconText, {color: colors.danger}]}>⏻</Text>
          </View>
          <Text style={[styles.actionTitle, {color: colors.text}]}>Xóa {deviceName}</Text>
          <Text style={[styles.actionText, {color: colors.secondaryText}]}>Thiết bị này sẽ bị đăng xuất khỏi tài khoản. Nếu đó là thiết bị lạ, hãy xóa ngay và đổi mật khẩu sau đó.</Text>
        </View>

        <View style={[styles.mobileSettingCard, {backgroundColor: colors.surface, shadowColor: colors.shadow}]}>
          <ProfileField
            autoCapitalize="none"
            color={colors.danger}
            icon="•"
            label="Mật khẩu xác nhận"
            value={password}
            onChangeText={setPassword}
            placeholder="Nhập mật khẩu"
            secureTextEntry
          />
        </View>
        {status ? <Text style={[styles.profileStatus, {backgroundColor: colors.input, color: colors.danger}]}>{status}</Text> : null}
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={submit}
          style={({pressed}) => [styles.profileSaveButton, {backgroundColor: colors.danger}, pressed ? styles.pressed : null]}>
          <Text style={styles.passwordButtonText}>{busy ? 'Đang xóa...' : 'Xóa thiết bị'}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function SettingsDetailScreen({route, navigation}: NativeStackScreenProps<SettingsStackParamList, 'SettingsDetail'>) {
  const page = route.params.page;
  const colors = useAppTheme();
  const insets = useSafeAreaInsets();
  const {state: sessionState} = useSession();
  const {settings, updateSettings} = useAppSettings();
  const profile = useProfileInfo();
  const {
    acceptVerification,
    approveVerification,
    cancelVerification,
    crypto,
    declineVerification,
    devices,
    error,
    refreshDevices,
    refreshSecurity,
    replaceSecureBackup,
    requestVerification,
    resetIdentity,
    restoreRecoveryKey,
    rotateRecoveryKey,
    security,
    securityBusy,
    securityFeedback,
    setupSecureBackup,
    startSasVerification,
    verification,
  } = useSettingsRuntime();
  const [screenNotifications, setScreenNotifications] = useState(true);
  const [localIndex, setLocalIndex] = useState(true);
  const [recoveryInput, setRecoveryInput] = useState('');
  const [showRecoveryInput, setShowRecoveryInput] = useState(false);
  const [showBackupSetup, setShowBackupSetup] = useState(false);
  const [backupPassphrase, setBackupPassphrase] = useState('');
  const [generatedRecoveryKey, setGeneratedRecoveryKey] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [showResetIdentity, setShowResetIdentity] = useState(false);
  const [profileName, setProfileName] = useState(profile.displayName);
  const [profilePhone, setProfilePhone] = useState(profile.phone ?? '');
  const [profileBusy, setProfileBusy] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [profileStatus, setProfileStatus] = useState<string | null>(null);
  const [blockedUsers, setBlockedUsers] = useState<string[]>([]);
  const [privacyBusy, setPrivacyBusy] = useState(false);
  const [privacyStatus, setPrivacyStatus] = useState<string | null>(null);
  const currentDevice = devices.find(item => item.device_id === profile.deviceId) ?? devices.at(0);
  const otherDevices = devices.filter(item => item.device_id !== currentDevice?.device_id);
  const cryptoLabel = security?.deviceTrusted ? 'Thiết bị đã xác thực' : 'Thiết bị chưa được xác thực';
  const themeChoices: Array<{key: ThemeMode; label: string}> = [
    {key: 'light', label: 'Sáng'},
    {key: 'dark', label: 'Tối'},
    {key: 'system', label: 'System'},
  ];
  const profileChanged = profileName.trim() !== profile.displayName
    || profilePhone.trim() !== (profile.phone ?? '');
  const SettingsGroup = useCallback(({children}: {children: React.ReactNode}) => (
    <View style={[styles.settingsGroup, {backgroundColor: colors.surface, shadowColor: colors.shadow}]}>{children}</View>
  ), [colors.shadow, colors.surface]);

  useFocusEffect(useCallback(() => {
    profile.refresh();
  }, [profile.refresh]));

  useFocusEffect(useCallback(() => {
    if (page !== 'security') {
      return;
    }
    refreshSecurity().catch(() => undefined);
    nativeMatrixService.isLocalSearchIndexEnabled().then(setLocalIndex).catch(() => setLocalIndex(false));
  }, [page, refreshSecurity]));

  useEffect(() => {
    if (page !== 'profile') {
      return;
    }
    setProfileName(profile.displayName);
    setProfilePhone(profile.phone ?? '');
  }, [page, profile.displayName, profile.email, profile.phone]);

  const refreshBlockedUsers = useCallback(async () => {
    if (sessionState.status === 'signed_in') {
      setBlockedUsers(await loadBlockedUsers(sessionState.auth));
      return;
    }
    const ownerId = sessionState.status === 'demo' ? sessionState.userId : '@guest:local';
    setBlockedUsers(await loadLocalBlockedUsers(ownerId));
  }, [sessionState]);

  useFocusEffect(useCallback(() => {
    if (page === 'privacy') {
      refreshBlockedUsers().catch(err => setPrivacyStatus(err instanceof Error ? err.message : 'Không thể tải danh sách chặn.'));
    }
    if (page === 'devices') {
      refreshDevices().catch(() => undefined);
    }
  }, [page, refreshBlockedUsers, refreshDevices]));

  async function savePrivacyUsers(nextUsers: string[]) {
    if (sessionState.status === 'signed_in') {
      await saveBlockedUsers(sessionState.auth, nextUsers);
      setBlockedUsers(nextUsers);
      return;
    }
    const ownerId = sessionState.status === 'demo' ? sessionState.userId : '@guest:local';
    setBlockedUsers(await saveLocalBlockedUsers(ownerId, nextUsers));
  }

  async function unblockUser(userId: string) {
    setPrivacyBusy(true);
    setPrivacyStatus(null);
    try {
      await savePrivacyUsers(blockedUsers.filter(item => item !== userId));
      setPrivacyStatus('Đã bỏ chặn.');
    } catch (err) {
      setPrivacyStatus(err instanceof Error ? err.message : 'Không thể bỏ chặn.');
    } finally {
      setPrivacyBusy(false);
    }
  }

  async function saveProfileChanges() {
    setProfileBusy(true);
    setProfileStatus(null);
    try {
      const nextName = profileName.trim() || profile.displayName;
      if (nextName !== profile.displayName) {
        await profile.updateDisplayName(nextName);
      }
      if (profilePhone.trim() !== (profile.phone ?? '')) {
        await profile.updatePhone(profilePhone.trim());
      }
      await profile.refresh();
      setProfileStatus('Đã cập nhật hồ sơ.');
    } catch (err) {
      setProfileStatus(err instanceof Error ? err.message : 'Không thể cập nhật hồ sơ.');
    } finally {
      setProfileBusy(false);
    }
  }

  async function pickProfileAvatar() {
    setAvatarBusy(true);
    setProfileStatus(null);
    try {
      const result = await launchImageLibrary({
        mediaType: 'photo',
        quality: 0.8,
        maxWidth: 1200,
        maxHeight: 1200,
        selectionLimit: 1,
      });
      if (result.didCancel) {
        return;
      }
      if (result.errorMessage) {
        throw new Error(result.errorMessage);
      }
      const asset = result.assets?.[0];
      if (!asset?.uri) {
        throw new Error('Không tìm thấy ảnh đã chọn.');
      }
      await profile.updateAvatar(asset);
      await profile.refresh();
      setProfileStatus('Đã cập nhật ảnh đại diện.');
    } catch (err) {
      setProfileStatus(err instanceof Error ? err.message : 'Không thể cập nhật ảnh đại diện.');
    } finally {
      setAvatarBusy(false);
    }
  }

  async function shareGeneratedRecoveryKey() {
    if (!generatedRecoveryKey) {
      return;
    }
    try {
      await Share.share({
        title: 'Mã khôi phục ECLO',
        message: formatRecoveryKey(generatedRecoveryKey),
      });
    } catch (err) {
      Alert.alert('Không thể chia sẻ', err instanceof Error ? err.message : 'Vui lòng thử lại.');
    }
  }

  function PageTitle({title, subtitle}: {title: string; subtitle?: string}) {
    return (
      <View style={styles.pageTitleBlock}>
        <Text style={[styles.pageTitle, {color: colors.text}]}>{title}</Text>
        {subtitle ? <Text style={[styles.pageSubtitle, {color: colors.secondaryText}]}>{subtitle}</Text> : null}
      </View>
    );
  }

  function SectionLabel({title}: {title: string}) {
    return <Text style={[styles.sectionLabel, {color: colors.tertiaryText}]}>{title}</Text>;
  }

  function DetailRow({icon, iconColor, title, subtitle, value, danger}: {icon?: string; iconColor?: string; title: string; subtitle?: string; value?: string; danger?: boolean}) {
    return (
      <Pressable style={({pressed}) => [styles.detailRow, pressed ? styles.pressed : null]}>
        {icon ? (
          <View style={[styles.detailIcon, {backgroundColor: iconColor ?? colors.primary}]}>
            <Text style={styles.detailIconText}>{icon}</Text>
          </View>
        ) : null}
        <View style={styles.flex1}>
          <Text style={[styles.detailTitle, {color: danger ? colors.danger : colors.text}]}>{title}</Text>
          {subtitle ? <Text style={[styles.detailSubtitle, {color: colors.secondaryText}]}>{subtitle}</Text> : null}
        </View>
        {value ? <Text numberOfLines={1} style={[styles.detailValue, {color: colors.secondaryText}]}>{value}</Text> : null}
        <Text style={[styles.chevron, {color: colors.tertiaryText}]}>›</Text>
      </Pressable>
    );
  }

  function ToggleRow({icon, iconColor, title, subtitle, value, onValueChange}: {icon?: string; iconColor?: string; title: string; subtitle?: string; value: boolean; onValueChange: (value: boolean) => void}) {
    return (
      <View style={styles.detailRow}>
        {icon ? (
          <View style={[styles.detailIcon, {backgroundColor: iconColor ?? colors.primary}]}>
            <Text style={styles.detailIconText}>{icon}</Text>
          </View>
        ) : null}
        <View style={styles.flex1}>
          <Text style={[styles.detailTitle, {color: colors.text}]}>{title}</Text>
          {subtitle ? <Text style={[styles.detailSubtitle, {color: colors.secondaryText}]}>{subtitle}</Text> : null}
        </View>
        <Switch value={value} onValueChange={onValueChange} trackColor={{false: colors.separator, true: colors.primary}} thumbColor="#fff" />
      </View>
    );
  }

  function DeviceCard({item, current, onRemove}: {item: Device; current?: boolean; onRemove?: () => void}) {
    const lastSeen = item.last_seen_ts ? new Date(item.last_seen_ts).toLocaleString() : current ? 'Đang hoạt động' : 'Chưa có thời gian hoạt động';
    return (
      <View style={[styles.deviceCard, {backgroundColor: current ? (colors.dark ? 'rgba(11,124,255,0.22)' : '#d9eaff') : colors.surface, shadowColor: colors.shadow, borderColor: current ? (colors.dark ? 'rgba(11,124,255,0.28)' : '#b9d7ff') : colors.separator}]}>
        <View style={[styles.deviceIcon, {backgroundColor: current ? colors.primary : colors.input}]}>
          <Text style={[styles.deviceIconText, {color: current ? '#fff' : colors.secondaryText}]}>▭</Text>
        </View>
        <View style={styles.flex1}>
          <View style={styles.deviceTitleRow}>
            <Text style={[styles.deviceName, {color: colors.text}]}>{current ? 'Thiết bị này' : item.display_name || 'Thiết bị không tên'}</Text>
            {current ? <Text style={[styles.onlinePill, {backgroundColor: colors.primary, color: '#fff'}]}>Đang hoạt động</Text> : null}
          </View>
          <Text style={[styles.detailSubtitle, {color: colors.secondaryText}]}>Hoạt động cuối: {lastSeen}</Text>
        </View>
        {!current ? (
          <Pressable accessibilityRole="button" onPress={onRemove} style={({pressed}) => [styles.deviceLogout, {borderColor: colors.danger}, pressed ? styles.pressed : null]}>
            <Text style={[styles.deviceLogoutText, {color: colors.danger}]}>⏻</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  function renderPage() {
    if (page === 'profile') {
      return (
        <>
          <View style={styles.profileEditHeader}>
            <Pressable accessibilityRole="button" accessibilityLabel="Đổi ảnh đại diện" disabled={avatarBusy} onPress={pickProfileAvatar} style={({pressed}) => [pressed ? styles.pressed : null]}>
              <MatrixAvatar label={profile.displayName} uri={profile.avatarUrl} size={112} backgroundColor={colors.primary} style={[styles.profilePhoto, {borderColor: colors.surface}]} />
              {avatarBusy ? (
                <View style={styles.avatarBusyOverlay}>
                  <ActivityIndicator color="#fff" />
                  <Text style={styles.avatarBusyText}>Đang cập nhật</Text>
                </View>
              ) : null}
              <View style={[styles.cameraButton, {backgroundColor: colors.primary, borderColor: colors.background}]}>
                <Text style={styles.cameraText}>{avatarBusy ? '…' : '⌾'}</Text>
              </View>
            </Pressable>
            <Text style={[styles.pageProfileName, {color: colors.text}]}>{profile.displayName}</Text>
            <Text numberOfLines={1} style={[styles.pageProfileId, {color: colors.secondaryText}]}>{profile.shortUserId}</Text>
          </View>
          {profileStatus ? <Text style={[styles.profileStatus, {backgroundColor: colors.input, color: profileStatus.startsWith('Đã') ? colors.success : colors.danger}]}>{profileStatus}</Text> : null}
          <SectionLabel title="Hồ sơ" />
          <View style={styles.mobileSettingStack}>
            <View style={[styles.mobileSettingCard, {backgroundColor: colors.surface, shadowColor: colors.shadow}]}>
              <ProfileField
                icon="◎"
                color={colors.primary}
                label="Tên hiển thị"
                value={profileName}
                onChangeText={setProfileName}
                placeholder="Tên của bạn"
              />
            </View>
            <View style={[styles.mobileSettingCard, {backgroundColor: colors.surface, shadowColor: colors.shadow}]}> 
              <Pressable accessibilityRole="button" onPress={() => navigation.navigate('SettingsEmail')} style={({pressed}) => [styles.profileActionRow, pressed ? styles.pressed : null]}>
                <View style={[styles.profileFieldIcon, {backgroundColor: '#8e8e93'}]}>
                  <Text style={styles.profileFieldIconText}>✉</Text>
                </View>
                <View style={styles.flex1}>
                  <Text style={[styles.profileFieldLabel, {color: colors.tertiaryText}]}>Email</Text>
                  <Text numberOfLines={1} style={[styles.detailTitle, {color: colors.text}]}>{profile.email || 'Chưa thiết lập'}</Text>
                  <Text style={[styles.detailSubtitle, {color: profile.emailVerified ? colors.success : colors.warning}]}>{profile.emailVerified ? 'Đã xác thực' : profile.pendingEmail ? 'Đang chờ xác thực' : 'Chưa xác thực'}</Text>
                </View>
                <Text style={[styles.chevron, {color: colors.tertiaryText}]}>›</Text>
              </Pressable>
              <ProfileField
                icon="☎"
                color="#34c759"
                label="Số điện thoại"
                value={profilePhone}
                onChangeText={setProfilePhone}
                placeholder="+84..."
                keyboardType="phone-pad"
              />
            </View>
            <View style={[styles.mobileSettingCard, {backgroundColor: colors.surface, shadowColor: colors.shadow}]}>
              <Pressable accessibilityRole="button" onPress={() => navigation.navigate('SettingsPassword')} style={({pressed}) => [styles.profileActionRow, pressed ? styles.pressed : null]}>
                <View style={[styles.profileFieldIcon, {backgroundColor: '#ff3b30'}]}>
                  <Text style={styles.profileFieldIconText}>●</Text>
                </View>
                <View style={styles.flex1}>
                  <Text style={[styles.detailTitle, {color: colors.text}]}>Đổi mật khẩu</Text>
                  <Text style={[styles.detailSubtitle, {color: colors.secondaryText}]}>Cập nhật mật khẩu đăng nhập</Text>
                </View>
                <Text style={[styles.chevron, {color: colors.tertiaryText}]}>›</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => navigation.navigate('SettingsDeactivate')} style={({pressed}) => [styles.profileActionRow, styles.profileActionBorder, {borderTopColor: colors.separator}, pressed ? styles.pressed : null]}>
                <View style={[styles.profileFieldIcon, {backgroundColor: '#ff3b30'}]}>
                  <Text style={styles.profileFieldIconText}>×</Text>
                </View>
                <View style={styles.flex1}>
                  <Text style={[styles.detailTitle, {color: colors.danger}]}>Xóa tài khoản</Text>
                  <Text style={[styles.detailSubtitle, {color: colors.secondaryText}]}>Xác nhận bằng mã gửi tới email</Text>
                </View>
                <Text style={[styles.chevron, {color: colors.tertiaryText}]}>›</Text>
              </Pressable>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={profileBusy || avatarBusy || !profileChanged}
            onPress={saveProfileChanges}
            style={({pressed}) => [
              styles.profileSaveButton,
              {backgroundColor: profileChanged ? colors.primary : colors.input},
              pressed && profileChanged ? styles.pressed : null,
            ]}>
            <Text style={[styles.profileSaveText, {color: profileChanged ? '#fff' : colors.tertiaryText}]}>{profileBusy ? 'Đang cập nhật...' : 'Lưu thay đổi'}</Text>
          </Pressable>
        </>
      );
    }

    if (page === 'general') {
      return (
        <>
          <PageTitle title="Cài đặt chung" />
          <SectionLabel title="Giao diện" />
          <View style={styles.mobileSettingStack}>
            <View style={[styles.mobileSettingCard, {backgroundColor: colors.surface, shadowColor: colors.shadow}]}>
              <View style={styles.mobileSettingHeader}>
                <View style={[styles.detailIcon, {backgroundColor: '#ffbf00'}]}>
                  <Text style={styles.detailIconText}>☀</Text>
                </View>
                <View style={styles.flex1}>
                  <Text style={[styles.detailTitle, {color: colors.text}]}>Chế độ hiển thị</Text>
                  <Text style={[styles.detailSubtitle, {color: colors.secondaryText}]}>Theo máy hoặc cố định sáng/tối</Text>
                </View>
              </View>
              <View style={styles.mobileSegment}>
                {themeChoices.map(item => (
                  <GlassButton
                    key={item.key}
                    selected={settings.themeMode === item.key}
                    onPress={() => updateSettings({themeMode: item.key})}
                    style={styles.mobileSegmentItem}
                    glassStyle={styles.mobileSegmentGlass}>
                    <Text style={[styles.segmentText, {color: settings.themeMode === item.key ? '#fff' : colors.text}]}>{item.label}</Text>
                  </GlassButton>
                ))}
              </View>
            </View>

            <View style={[styles.mobileSettingCard, {backgroundColor: colors.surface, shadowColor: colors.shadow}]}>
              <View style={styles.mobileSettingHeader}>
                <View style={[styles.detailIcon, {backgroundColor: settings.accentColor}]}>
                  <Text style={styles.detailIconText}>●</Text>
                </View>
                <View style={styles.flex1}>
                  <Text style={[styles.detailTitle, {color: colors.text}]}>Màu chủ đạo</Text>
                  <Text style={[styles.detailSubtitle, {color: colors.secondaryText}]}>Áp dụng cho nút, thanh điều hướng và tin nhắn</Text>
                </View>
              </View>
              <View style={styles.swatches}>
                {APP_ACCENT_COLORS.map(item => (
                  <GlassButton
                    key={item}
                    accessibilityRole="button"
                    accessibilityLabel={`Màu ${item}`}
                    selected={settings.accentColor === item}
                    onPress={() => updateSettings({accentColor: item})}
                    style={styles.swatch}
                    glassStyle={styles.swatchGlass}
                    contentStyle={[styles.swatchContent, {backgroundColor: item}]}>
                    {settings.accentColor === item ? <Text style={styles.swatchCheck}>✓</Text> : null}
                  </GlassButton>
                ))}
              </View>
            </View>

            <View style={[styles.mobileSettingCard, {backgroundColor: colors.surface, shadowColor: colors.shadow}]}>
              <View style={styles.mobileSettingHeader}>
                <View style={[styles.detailIcon, {backgroundColor: colors.primary}]}>
                  <Text style={styles.detailIconText}>Aa</Text>
                </View>
                <View style={styles.flex1}>
                  <Text style={[styles.detailTitle, scaledText(colors, 16), {color: colors.text}]}>Font chữ</Text>
                  <Text style={[styles.detailSubtitle, scaledText(colors, 13), {color: colors.secondaryText}]}>Chọn kiểu chữ dễ đọc trên điện thoại</Text>
                </View>
              </View>
              <View style={styles.fontGrid}>
                {APP_FONT_OPTIONS.map(item => (
                  <GlassButton
                    key={item.key}
                    accessibilityRole="button"
                    selected={settings.fontChoice === item.key}
                    onPress={() => updateSettings({fontChoice: item.key})}
                    style={styles.fontChip}
                    glassStyle={styles.fontChipGlass}>
                    <Text style={[styles.fontChipText, item.family ? {fontFamily: item.family} : null, {color: settings.fontChoice === item.key ? '#fff' : colors.text}]}>{item.label}</Text>
                  </GlassButton>
                ))}
              </View>
            </View>

            <View style={[styles.mobileSettingCard, {backgroundColor: colors.surface, shadowColor: colors.shadow}]}>
              <View style={styles.mobileSettingHeader}>
                <View style={styles.flex1}>
                  <Text style={[styles.detailTitle, {color: colors.text}]}>Cỡ chữ</Text>
                  <Text style={[styles.detailSubtitle, {color: colors.secondaryText}]}>Điều chỉnh theo mắt đọc của bạn</Text>
                </View>
                <Text style={[styles.valuePill, {backgroundColor: colors.input, color: colors.text}]}>{settings.fontSize}px</Text>
              </View>
              <View style={[styles.sliderTrack, {backgroundColor: colors.separator}]}>
                <View style={[styles.sliderFill, {width: `${((settings.fontSize - 12) / 20) * 100}%`, backgroundColor: colors.primary}]} />
              </View>
              <View style={styles.sizeStepperRow}>
                <GlassButton onPress={() => updateSettings({fontSize: Math.max(12, settings.fontSize - 1)})} style={styles.sizeButton} glassStyle={styles.sizeButtonGlass}>
                  <Text style={[styles.stepperText, {color: colors.text}]}>−</Text>
                </GlassButton>
                <Text style={[styles.sizePreview, {color: colors.text, fontFamily: colors.fontFamily, fontSize: settings.fontSize}]}>Nội dung tin nhắn</Text>
                <GlassButton onPress={() => updateSettings({fontSize: Math.min(32, settings.fontSize + 1)})} style={styles.sizeButton} glassStyle={styles.sizeButtonGlass}>
                  <Text style={[styles.stepperText, {color: colors.text}]}>+</Text>
                </GlassButton>
              </View>
            </View>

            <View style={[styles.mobileSettingCard, {backgroundColor: colors.surface, shadowColor: colors.shadow}]}>
              <View style={styles.mobileSettingHeader}>
                <View style={styles.flex1}>
                  <Text style={[styles.detailTitle, {color: colors.text}]}>Nền trò chuyện</Text>
                  <Text style={[styles.detailSubtitle, {color: colors.secondaryText}]}>Chỉ ảnh hưởng màn chat</Text>
                </View>
              </View>
              <View style={styles.backgroundChoices}>
                {CHAT_BACKGROUND_OPTIONS.map(item => (
                  <GlassButton
                    key={item.key}
                    selected={settings.chatBackground === item.key}
                    onPress={() => updateSettings({chatBackground: item.key})}
                    style={styles.backgroundChoice}
                    glassStyle={styles.backgroundChoiceGlass}
                    contentStyle={styles.backgroundChoiceContent}>
                    <Text style={[styles.backgroundChoiceText, {color: colors.text}]}>{item.label}</Text>
                  </GlassButton>
                ))}
              </View>
            </View>
          </View>
          <SectionLabel title="Thông báo" />
          <SettingsGroup>
            <ToggleRow icon="▲" iconColor="#e83f5b" title="Thông báo màn hình" subtitle="Nhận thông báo khi có tin nhắn mới" value={screenNotifications} onValueChange={setScreenNotifications} />
          </SettingsGroup>
          <SectionLabel title="Ngôn ngữ & khu vực" />
          <SettingsGroup>
            <DetailRow icon="A" iconColor="#20c7e8" title="Ngôn ngữ" value="Tiếng Việt" />
          </SettingsGroup>
        </>
      );
    }

    if (page === 'privacy') {
      return (
        <>
          <PageTitle title="Quyền riêng tư" subtitle="Quản lý tài khoản bị chặn và quyền liên hệ." />
          <SectionLabel title="Tác vụ" />
          <SettingsGroup>
            <Pressable accessibilityRole="button" onPress={() => navigation.navigate('SettingsBlockUser')} style={({pressed}) => [styles.detailRow, pressed ? styles.pressed : null]}>
              <View style={[styles.detailIcon, {backgroundColor: colors.danger}]}>
                <Text style={styles.detailIconText}>⊘</Text>
              </View>
              <View style={styles.flex1}>
                <Text style={[styles.detailTitle, {color: colors.text}]}>Chặn tài khoản</Text>
                <Text style={[styles.detailSubtitle, {color: colors.secondaryText}]}>Thêm tài khoản vào danh sách chặn</Text>
              </View>
              <Text style={[styles.chevron, {color: colors.tertiaryText}]}>›</Text>
            </Pressable>
          </SettingsGroup>
          {privacyStatus ? <Text style={[styles.profileStatus, {backgroundColor: colors.input, color: privacyStatus.startsWith('Đã') ? colors.success : colors.danger}]}>{privacyStatus}</Text> : null}
          <SectionLabel title={`Danh sách đã chặn (${blockedUsers.length})`} />
          <View style={[styles.mobileSettingCard, {backgroundColor: colors.surface, shadowColor: colors.shadow}]}>
            {blockedUsers.length ? blockedUsers.map((userId, index) => (
              <View key={userId} style={[styles.blockedRow, index > 0 ? {borderTopColor: colors.separator, borderTopWidth: StyleSheet.hairlineWidth} : null]}>
                <View style={[styles.profileFieldIcon, {backgroundColor: colors.input}]}>
                  <Text style={[styles.profileFieldIconText, {color: colors.secondaryText}]}>@</Text>
                </View>
                <Text numberOfLines={1} style={[styles.blockedUserId, {color: colors.text}]}>{shortContactId(userId)}</Text>
                <Pressable accessibilityRole="button" disabled={privacyBusy} onPress={() => unblockUser(userId)} style={({pressed}) => [styles.unblockButton, {backgroundColor: colors.dangerSoft}, pressed ? styles.pressed : null]}>
                  <Text style={[styles.unblockText, {color: colors.danger}]}>Bỏ chặn</Text>
                </Pressable>
              </View>
            )) : (
              <View style={[styles.emptyBlock, {borderColor: colors.separator, backgroundColor: colors.input}]}>
                <Text style={[styles.emptyIcon, {color: colors.tertiaryText}]}>⊘</Text>
                <Text style={[styles.emptyText, {color: colors.secondaryText}]}>Chưa có tài khoản nào bị chặn</Text>
              </View>
            )}
          </View>
        </>
      );
    }

    if (page === 'security') {
      const backupReady = security?.state === 'ready';
      const needsRecovery = security?.state === 'needs_recovery';
      const canRotateRecoveryKey = backupReady && security?.recoveryState === 'enabled';
      const needsBackupReplacement = backupReady && security?.recoveryState !== 'enabled';
      const canSetupBackup = !backupReady || needsBackupReplacement;
      const trusted = Boolean(security?.deviceTrusted || verification.phase === 'done');
      const verificationActive = !['idle', 'done', 'cancelled', 'failed'].includes(verification.phase);
      const canCompare = Boolean(verification.emojis?.length || verification.decimals?.length);
      return (
        <>
          <PageTitle title="Riêng tư & Bảo mật" />
          <SectionLabel title="Trạng thái thiết bị" />
          {!security ? (
            <View style={[styles.trustCard, {backgroundColor: colors.input}]}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.trustText, {color: colors.secondaryText}]}>Đang kiểm tra trạng thái bảo mật...</Text>
            </View>
          ) : (
            <View style={[styles.trustCard, {backgroundColor: trusted ? colors.successSoft : colors.warningSoft}]}>
              <View style={[styles.trustIcon, {backgroundColor: trusted ? colors.success : colors.warning}]}>
                <Text style={styles.trustIconText}>♢</Text>
              </View>
              <View style={styles.flex1}>
                <Text style={[styles.trustTitle, {color: trusted ? colors.success : colors.warning}]}>{trusted ? 'Đã xác thực' : 'Cần xác thực'}</Text>
                <Text style={[styles.trustText, {color: colors.text}]}>{trusted ? 'Thiết bị này đã được xác nhận.' : 'Xác thực với thiết bị đang đăng nhập.'}</Text>
              </View>
            </View>
          )}

          {!trusted && security ? (
            <SettingsGroup>
              <View style={styles.settingBlock}>
                <Text style={[styles.detailTitle, {color: colors.text}]}>Xác thực thiết bị</Text>
                {verification.phase === 'incoming' ? (
                  <Pressable accessibilityRole="button" disabled={securityBusy} onPress={acceptVerification} style={({pressed}) => [styles.primaryAction, styles.securityRaisedButton, {backgroundColor: colors.primary, borderColor: colors.primary, opacity: securityBusy ? 0.55 : 1}, pressed ? styles.actionPressed : null]}>
                    <Text style={styles.primaryActionText}>Chấp nhận yêu cầu từ {verification.deviceName || 'thiết bị khác'}</Text>
                  </Pressable>
                ) : !verificationActive && security.hasDevicesToVerifyAgainst ? (
                  <Pressable accessibilityRole="button" disabled={securityBusy} onPress={requestVerification} style={({pressed}) => [styles.primaryAction, styles.securityRaisedButton, {backgroundColor: colors.primary, borderColor: colors.primary, opacity: securityBusy ? 0.55 : 1}, pressed ? styles.actionPressed : null]}>
                    <Text style={styles.primaryActionText}>Gửi yêu cầu xác thực</Text>
                  </Pressable>
                ) : null}
                {!security.hasDevicesToVerifyAgainst ? (
                  <View style={[styles.securityNotice, {backgroundColor: colors.warningSoft}]}>
                    <Text style={[styles.detailSubtitle, {color: colors.text}]}>Không có thiết bị nhận yêu cầu.</Text>
                  </View>
                ) : null}
                {verification.phase === 'requested' ? (
                  <View style={[styles.securityNotice, {backgroundColor: colors.input}]}>
                    <ActivityIndicator color={colors.primary} />
                    <Text style={[styles.detailSubtitle, {color: colors.text, textAlign: 'center'}]}>Đang chờ thiết bị khác chấp nhận...</Text>
                    <Pressable accessibilityRole="button" disabled={securityBusy} onPress={cancelVerification} style={({pressed}) => [styles.softDangerButton, styles.securityRaisedButton, {backgroundColor: colors.dangerSoft, borderColor: colors.danger, alignSelf: 'center'}, pressed ? styles.actionPressed : null]}>
                      <Text style={[styles.softDangerText, {color: colors.danger}]}>Hủy yêu cầu</Text>
                    </Pressable>
                  </View>
                ) : null}
                {verification.phase === 'accepted' ? (
                  <Pressable accessibilityRole="button" disabled={securityBusy} onPress={startSasVerification} style={({pressed}) => [styles.primaryAction, styles.securityRaisedButton, {backgroundColor: colors.primary, borderColor: colors.primary}, pressed ? styles.actionPressed : null]}>
                    <Text style={styles.primaryActionText}>Tiếp tục so sánh emoji</Text>
                  </Pressable>
                ) : null}
                {verification.phase === 'sas' && !canCompare ? (
                  <View style={[styles.securityNotice, {backgroundColor: colors.input}]}>
                    <ActivityIndicator color={colors.primary} />
                    <Text style={[styles.detailSubtitle, {color: colors.text}]}>Đang tạo emoji...</Text>
                  </View>
                ) : null}
                {canCompare ? (
                  <View style={[styles.sasCard, {backgroundColor: colors.input, borderColor: colors.separator}]}>
                    <Text style={[styles.sasTitle, {color: colors.text}]}>Hai thiết bị có hiển thị giống nhau?</Text>
                    {verification.emojis?.length ? (
                      <View style={styles.sasEmojiRow}>
                        {verification.emojis.map((item, index) => (
                          <View key={`${item.symbol}-${index}`} style={styles.sasEmojiItem}>
                            <Text style={styles.sasEmoji}>{item.symbol}</Text>
                            <Text numberOfLines={1} style={[styles.sasEmojiLabel, {color: colors.secondaryText}]}>{item.description}</Text>
                          </View>
                        ))}
                      </View>
                    ) : <Text style={[styles.sasDecimals, {color: colors.text}]}>{verification.decimals?.join('  ·  ')}</Text>}
                    <View style={styles.sasActions}>
                      <Pressable accessibilityRole="button" disabled={securityBusy} onPress={declineVerification} style={({pressed}) => [styles.sasButton, styles.securityRaisedButton, {backgroundColor: colors.dangerSoft, borderColor: colors.danger}, pressed ? styles.actionPressed : null]}>
                        <Text style={[styles.softDangerText, {color: colors.danger}]}>Không khớp</Text>
                      </Pressable>
                      <Pressable accessibilityRole="button" disabled={securityBusy} onPress={approveVerification} style={({pressed}) => [styles.sasButton, styles.securityRaisedButton, {backgroundColor: colors.success, borderColor: colors.success}, pressed ? styles.actionPressed : null]}>
                        <Text style={styles.primaryActionText}>Khớp</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}
              </View>
            </SettingsGroup>
          ) : null}

          <SectionLabel title="Sao lưu tin nhắn" />
          <SettingsGroup>
            <View style={styles.settingBlock}>
              <View style={styles.settingBlockTop}>
                <View style={styles.flex1}>
                  <Text style={[styles.detailTitle, {color: colors.text}]}>Sao lưu tin nhắn</Text>
                  <Text style={[styles.detailSubtitle, {color: colors.secondaryText}]}>{needsBackupReplacement ? 'Cần tạo sao lưu mới' : backupReady ? 'Đã bật' : needsRecovery ? 'Cần Mã khôi phục' : security?.backupState === 'working' ? 'Đang xử lý...' : 'Chưa thiết lập'}</Text>
                </View>
                <Text style={[styles.valuePill, {backgroundColor: backupReady ? colors.successSoft : colors.input, color: backupReady ? colors.success : colors.secondaryText}]}>
                  {needsBackupReplacement ? 'Cần tạo lại' : backupReady ? 'Đang bật' : needsRecovery ? 'Cần khôi phục' : 'Chưa bật'}
                </Text>
              </View>
              <View style={styles.securityActionRow}>
                <Pressable accessibilityRole="button" disabled={securityBusy} onPress={() => { setRecoveryInput(''); setShowRecoveryInput(true); }} style={({pressed}) => [styles.securityActionButton, styles.securityRaisedButton, {backgroundColor: needsRecovery ? colors.primary : colors.input, borderColor: needsRecovery ? colors.primary : colors.separator}, pressed ? styles.actionPressed : null]}>
                  <Text style={[styles.securityActionText, {color: needsRecovery ? '#fff' : colors.primary}]}>Nhập Mã khôi phục</Text>
                </Pressable>
                {canRotateRecoveryKey ? (
                  <Pressable disabled={securityBusy} onPress={async () => {
                    const key = await rotateRecoveryKey();
                    if (key) setGeneratedRecoveryKey(key);
                  }} style={({pressed}) => [styles.securityActionButton, styles.securityRaisedButton, {backgroundColor: colors.input, borderColor: colors.separator}, pressed ? styles.actionPressed : null]}>
                    <Text style={[styles.securityActionText, {color: colors.primary}]}>Tạo mã mới</Text>
                  </Pressable>
                ) : null}
              </View>

              {canSetupBackup ? (
                showBackupSetup ? (
                  <View style={[styles.backupSetupBox, {backgroundColor: colors.input}]}>
                    <TextInput autoCapitalize="none" autoCorrect={false} blurOnSubmit={false} keyboardAppearance={colors.dark ? 'dark' : 'light'} placeholder="Mật khẩu bảo vệ" placeholderTextColor={colors.tertiaryText} returnKeyType="done" secureTextEntry style={[styles.backupSetupInput, {backgroundColor: colors.surface, color: colors.text}]} textContentType="newPassword" value={backupPassphrase} onChangeText={setBackupPassphrase} />
                    <View style={styles.securityActionRow}>
                      <Pressable onPress={() => { setShowBackupSetup(false); setBackupPassphrase(''); }} style={[styles.securityActionButton, {backgroundColor: colors.surface}]}>
                        <Text style={[styles.securityActionText, {color: colors.text}]}>Hủy</Text>
                      </Pressable>
                      <Pressable disabled={securityBusy || !trusted || backupPassphrase.length < 6} onPress={async () => {
                        if ((needsRecovery || needsBackupReplacement) && !(await confirmBackupReplacement())) return;
                        const key = needsRecovery || needsBackupReplacement
                          ? await replaceSecureBackup(backupPassphrase)
                          : await setupSecureBackup(backupPassphrase);
                        if (key) { setGeneratedRecoveryKey(key); setBackupPassphrase(''); setShowBackupSetup(false); }
                      }} style={[styles.securityActionButton, {backgroundColor: trusted && backupPassphrase.length >= 6 ? colors.primary : colors.separator}]}>
                        <Text style={[styles.securityActionText, {color: '#fff'}]}>{securityBusy ? 'Đang tạo...' : 'Tạo mã'}</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <Pressable accessibilityRole="button" disabled={securityBusy || !trusted} onPress={() => setShowBackupSetup(true)} style={({pressed}) => [styles.primaryAction, styles.securityRaisedButton, {backgroundColor: trusted ? colors.primary : colors.separator, borderColor: trusted ? colors.primary : colors.separator, opacity: securityBusy || !trusted ? 0.55 : 1}, pressed ? styles.actionPressed : null]}>
                    <Text style={styles.primaryActionText}>{needsRecovery || needsBackupReplacement ? 'Tạo sao lưu mới' : 'Tạo Mã khôi phục'}</Text>
                  </Pressable>
                )
              ) : null}

              {generatedRecoveryKey ? (
                <View style={[styles.recoveryResult, {backgroundColor: colors.warningSoft, borderColor: colors.warning}]}>
                  <Text style={[styles.detailTitle, {color: colors.text}]}>Mã khôi phục mới</Text>
                  <Text style={[styles.detailSubtitle, {color: colors.secondaryText}]}>Lưu mã này ở nơi an toàn.</Text>
                  <Text selectable style={[styles.recoveryCode, {backgroundColor: colors.surface, color: colors.primary}]}>{formatRecoveryKey(generatedRecoveryKey)}</Text>
                  <View style={styles.recoveryResultActions}>
                    <Pressable onPress={() => { Clipboard.setString(generatedRecoveryKey); Alert.alert('Đã sao chép', 'Mã khôi phục đã được sao chép.'); }} style={[styles.copyRecoveryButton, {backgroundColor: colors.primary}]}>
                      <Text style={styles.primaryActionText}>Sao chép</Text>
                    </Pressable>
                    <Pressable onPress={shareGeneratedRecoveryKey} style={[styles.copyRecoveryButton, {backgroundColor: colors.surface, borderColor: colors.primary, borderWidth: StyleSheet.hairlineWidth}]}>
                      <Text style={[styles.securityActionText, {color: colors.primary}]}>Chia sẻ / Lưu</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </View>
          </SettingsGroup>
          {securityFeedback ? <Text style={[styles.error, {backgroundColor: securityFeedback.kind === 'error' ? colors.dangerSoft : securityFeedback.kind === 'success' ? colors.successSoft : colors.input, color: securityFeedback.kind === 'error' ? colors.danger : securityFeedback.kind === 'success' ? colors.success : colors.text}]}>{securityFeedback.text}</Text> : null}

          <Modal animationType="slide" transparent visible={showRecoveryInput} onRequestClose={() => { setRecoveryInput(''); setShowRecoveryInput(false); }}>
            <View style={styles.recoveryModalBackdrop}>
              <Pressable style={StyleSheet.absoluteFill} onPress={() => { setRecoveryInput(''); setShowRecoveryInput(false); }} />
              <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} pointerEvents="box-none" style={styles.recoveryModalKeyboard}>
                <View style={[styles.recoveryModalSheet, {backgroundColor: colors.surface, paddingBottom: Math.max(insets.bottom, 16)}]}>
                  <View style={[styles.recoveryModalHandle, {backgroundColor: colors.separator}]} />
                  <Text style={[styles.recoveryModalTitle, {color: colors.text}]}>Nhập Mã khôi phục</Text>
                  <View style={[styles.recoveryModalInputRow, {backgroundColor: colors.input}]}>
                    <TextInput autoCapitalize="none" autoCorrect={false} autoFocus blurOnSubmit={false} keyboardAppearance={colors.dark ? 'dark' : 'light'} placeholder="Es..." placeholderTextColor={colors.tertiaryText} secureTextEntry style={[styles.recoveryModalInput, {color: colors.text}]} value={recoveryInput} onChangeText={setRecoveryInput} />
                    <Pressable onPress={async () => setRecoveryInput((await Clipboard.getString()).trim())} style={[styles.recoveryPasteButton, {backgroundColor: colors.surface}]}>
                      <Text style={[styles.recoveryPasteText, {color: colors.primary}]}>Dán</Text>
                    </Pressable>
                  </View>
                  {securityFeedback?.kind === 'error' ? <Text style={[styles.recoveryModalError, {color: colors.danger}]}>{securityFeedback.text}</Text> : null}
                  <View style={styles.securityActionRow}>
                    <Pressable disabled={securityBusy} onPress={() => { setRecoveryInput(''); setShowRecoveryInput(false); }} style={[styles.securityActionButton, {backgroundColor: colors.input}]}>
                      <Text style={[styles.securityActionText, {color: colors.text}]}>Hủy</Text>
                    </Pressable>
                    <Pressable disabled={securityBusy || !recoveryInput.trim()} onPress={async () => {
                      const succeeded = await restoreRecoveryKey(recoveryInput);
                      if (succeeded) { setRecoveryInput(''); setShowRecoveryInput(false); }
                    }} style={[styles.securityActionButton, {backgroundColor: recoveryInput.trim() ? colors.primary : colors.separator}]}>
                      <Text style={[styles.securityActionText, {color: '#fff'}]}>{securityBusy ? 'Đang khôi phục...' : 'Khôi phục'}</Text>
                    </Pressable>
                  </View>
                </View>
              </KeyboardAvoidingView>
            </View>
          </Modal>

          <SectionLabel title="Đặt lại danh tính" />
          <SettingsGroup>
            <View style={styles.settingBlock}>
              <Text style={[styles.detailSubtitle, {color: colors.secondaryText}]}>Chỉ dùng khi mất Mã khôi phục. Tin nhắn cũ có thể không khôi phục được.</Text>
              {!showResetIdentity ? (
                <Pressable disabled={securityBusy} onPress={() => setShowResetIdentity(true)} style={({pressed}) => [styles.softDangerButton, {backgroundColor: colors.dangerSoft}, pressed ? styles.pressed : null]}>
                  <Text style={[styles.softDangerText, {color: colors.danger}]}>Đặt lại danh tính bảo mật</Text>
                </Pressable>
              ) : (
                <>
                  <View style={[styles.inputBox, {backgroundColor: colors.input}]}>
                    <Text style={[styles.inputLabel, {color: colors.tertiaryText}]}>Mật khẩu tài khoản để xác nhận</Text>
                    <TextInput placeholder="Nhập mật khẩu tài khoản" placeholderTextColor={colors.tertiaryText} secureTextEntry style={[styles.input, {color: colors.text}]} value={resetPassword} onChangeText={setResetPassword} />
                  </View>
                  <View style={styles.sasActions}>
                    <Pressable onPress={() => { setShowResetIdentity(false); setResetPassword(''); }} style={[styles.sasButton, {backgroundColor: colors.input}]}><Text style={[styles.softDangerText, {color: colors.text}]}>Hủy</Text></Pressable>
                    <Pressable disabled={securityBusy || !resetPassword} onPress={() => Alert.alert('Đặt lại bảo mật?', 'Hành động này không thể hoàn tác và có thể khiến một số tin nhắn cũ không còn xem được.', [
                      {text: 'Hủy', style: 'cancel'},
                      {text: 'Đặt lại', style: 'destructive', onPress: async () => { await resetIdentity(resetPassword); setResetPassword(''); setShowResetIdentity(false); }},
                    ])} style={[styles.sasButton, {backgroundColor: resetPassword ? colors.danger : colors.separator}]}><Text style={styles.primaryActionText}>Xác nhận đặt lại</Text></Pressable>
                  </View>
                </>
              )}
            </View>
          </SettingsGroup>

          <SectionLabel title="Dữ liệu trên thiết bị này" />
          <SettingsGroup>
            <ToggleRow title="Chỉ mục tìm kiếm trên thiết bị" subtitle="Lưu nội dung tin nhắn đã giải mã trên máy để tìm kiếm nhanh. Tắt sẽ xóa toàn bộ chỉ mục hiện có." value={localIndex} onValueChange={async enabled => {
              await nativeMatrixService.setLocalSearchIndexEnabled(enabled);
              setLocalIndex(enabled);
            }} />
            <Pressable onPress={() => Alert.alert('Xóa dữ liệu tìm kiếm?', 'Dữ liệu tìm kiếm trên thiết bị này sẽ bị xóa. Tin nhắn của bạn không bị ảnh hưởng.', [
              {text: 'Hủy', style: 'cancel'},
              {text: 'Xóa', style: 'destructive', onPress: () => nativeMatrixService.clearLocalSearchIndex().catch(() => undefined)},
            ])} style={({pressed}) => [styles.clearIndexButton, {backgroundColor: colors.dangerSoft}, pressed ? styles.pressed : null]}>
              <Text style={[styles.clearIndexText, {color: colors.danger}]}>⌫ Xóa dữ liệu tìm kiếm</Text>
            </Pressable>
          </SettingsGroup>
        </>
      );
    }

    if (page === 'devices') {
      return (
        <>
          <PageTitle title="Thiết bị đã đăng nhập" subtitle="Quản lý các thiết bị đã đăng nhập vào tài khoản của bạn." />
          {error ? <Text style={[styles.error, {backgroundColor: colors.dangerSoft, color: colors.danger}]}>{error}</Text> : null}
          <SectionLabel title="Thiết bị hiện tại" />
          {currentDevice ? <DeviceCard item={currentDevice} current /> : null}
          <SectionLabel title={`Các thiết bị khác (${otherDevices.length})`} />
          <FlatList
            scrollEnabled={false}
            data={otherDevices}
            keyExtractor={item => item.device_id}
            renderItem={({item}) => <DeviceCard item={item} onRemove={() => navigation.navigate('SettingsRemoveDevice', {deviceId: item.device_id, displayName: item.display_name})} />}
            ListEmptyComponent={<Text style={[styles.emptyLine, {color: colors.secondaryText}]}>Không có thiết bị khác.</Text>}
          />
        </>
      );
    }

    return (
      <>
        <View style={[styles.aboutHero, {backgroundColor: colors.surface, shadowColor: colors.shadow}]}>
          <View style={[styles.aboutLogoBubble, {backgroundColor: colors.input}]}>
            <Text style={[styles.aboutLogoText, {color: colors.primary}]}>eclo</Text>
            <Text style={[styles.aboutLogoUrl, {color: colors.text}]}>www.eclo.chat</Text>
          </View>
          <Text style={[styles.aboutHeroTitle, {color: colors.text}]}>ECLO Chat</Text>
          <Text style={[styles.aboutHeroText, {color: colors.secondaryText}]}>Ứng dụng nhắn tin riêng tư, đồng bộ trên các thiết bị và bảo vệ nội dung của bạn.</Text>
          <View style={styles.aboutPills}>
            <Text style={[styles.aboutPill, {backgroundColor: colors.primary, color: '#fff'}]}>Phiên bản 1.1.0</Text>
            <Text style={[styles.aboutPill, {backgroundColor: colors.input, color: colors.secondaryText}]}>{Platform.OS === 'ios' ? 'iPhone' : 'Điện thoại'}</Text>
          </View>
        </View>

        <SectionLabel title="Ứng dụng" />
        <SettingsGroup>
          <View style={styles.aboutInfoRow}>
            <View style={[styles.detailIcon, {backgroundColor: colors.primary}]}>
              <Text style={styles.detailIconText}>i</Text>
            </View>
            <View style={styles.flex1}>
              <Text style={[styles.detailTitle, {color: colors.text}]}>Phiên bản</Text>
              <Text style={[styles.detailSubtitle, {color: colors.secondaryText}]}>ECLO Chat 1.1.0</Text>
            </View>
          </View>
          <View style={[styles.aboutInfoRow, {borderTopColor: colors.separator, borderTopWidth: StyleSheet.hairlineWidth}]}>
            <View style={[styles.detailIcon, {backgroundColor: '#34c759'}]}>
              <Text style={styles.detailIconText}>✓</Text>
            </View>
            <View style={styles.flex1}>
              <Text style={[styles.detailTitle, {color: colors.text}]}>Trạng thái</Text>
              <Text style={[styles.detailSubtitle, {color: colors.secondaryText}]}>Ứng dụng đã sẵn sàng trên thiết bị này</Text>
            </View>
          </View>
        </SettingsGroup>

        <SectionLabel title="Bảo mật" />
        <View style={[styles.aboutSecurityCard, {backgroundColor: crypto.ready ? colors.successSoft : colors.warningSoft}]}>
          <View style={[styles.trustIcon, {backgroundColor: crypto.ready ? colors.success : colors.warning}]}>
            <Text style={styles.trustIconText}>♢</Text>
          </View>
          <View style={styles.flex1}>
            <Text style={[styles.trustTitle, {color: crypto.ready ? colors.success : colors.warning}]}>{crypto.ready ? 'Bảo mật đã sẵn sàng' : 'Đang chuẩn bị bảo mật'}</Text>
            <Text style={[styles.trustText, {color: colors.text}]}>Tin nhắn của bạn được bảo vệ và có thể sao lưu khi đổi thiết bị.</Text>
          </View>
        </View>

        <SectionLabel title="Hỗ trợ" />
        <SettingsGroup>
          {['Giới thiệu về ECLO Chat', 'Chính sách quyền riêng tư', 'Chính sách bảo mật', 'Gửi góp ý'].map((label, index) => (
            <Pressable key={label} accessibilityRole="button" style={({pressed}) => [styles.aboutLinkRow, index > 0 ? {borderTopColor: colors.separator, borderTopWidth: StyleSheet.hairlineWidth} : null, pressed ? styles.pressed : null]}>
              <Text style={[styles.aboutRowText, {color: colors.text}]}>{label}</Text>
              <Text style={[styles.externalIcon, {color: colors.tertiaryText}]}>↗</Text>
            </Pressable>
          ))}
        </SettingsGroup>

        <Text style={[styles.aboutCopyright, {color: colors.tertiaryText}]}>© 2026 ECLO</Text>
      </>
    );
  }

  return (
    <View style={[styles.screen, {backgroundColor: colors.background}]}>
      <ScrollView keyboardDismissMode="none" keyboardShouldPersistTaps="always" contentContainerStyle={[styles.pageContent, {paddingTop: insets.top + 62}]} showsVerticalScrollIndicator={false}>
        {renderPage()}
      </ScrollView>
    </View>
  );
}

function SettingsBackButton({onPress}: {onPress: () => void}) {
  const colors = useAppTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Quay lại"
      onPress={onPress}
      hitSlop={10}
      style={({pressed}) => [styles.headerBackHit, pressed ? styles.pressed : null]}>
      <Text style={[styles.headerBackIcon, {color: colors.text}]}>‹</Text>
    </Pressable>
  );
}

function ProfileField({
  autoCapitalize = 'sentences',
  color,
  editable = true,
  icon,
  keyboardType = 'default',
  label,
  onChangeText,
  placeholder,
  secureTextEntry = false,
  value,
}: {
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  color: string;
  editable?: boolean;
  icon: string;
  keyboardType?: 'default' | 'email-address' | 'phone-pad';
  label: string;
  onChangeText?: (text: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  value: string;
}) {
  const colors = useAppTheme();

  return (
    <View style={styles.profileField}>
      <View style={[styles.profileFieldIcon, {backgroundColor: color}]}>
        <Text style={styles.profileFieldIconText}>{icon}</Text>
      </View>
      <View style={styles.flex1}>
        <Text style={[styles.profileFieldLabel, {color: colors.tertiaryText}]}>{label}</Text>
        <TextInput
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          editable={editable}
          keyboardType={keyboardType}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.tertiaryText}
          secureTextEntry={secureTextEntry}
          style={[styles.profileFieldInput, {color: editable ? colors.text : colors.secondaryText}]}
          value={value}
        />
      </View>
    </View>
  );
}

function scaledText(colors: ReturnType<typeof useAppTheme>, baseSize: number, baseLineHeight?: number) {
  return {
    fontFamily: colors.fontFamily,
    fontSize: Math.round(baseSize * colors.fontScale),
    lineHeight: baseLineHeight ? Math.round(baseLineHeight * colors.fontScale) : undefined,
  };
}

function useProfileInfo() {
  const {state, signOut} = useSession();
  const [remoteProfile, setRemoteProfile] = useState<StoredProfile>({});
  const refreshSequence = useRef(0);
  const userId = state.status === 'signed_in' ? state.auth.userId : state.status === 'demo' ? state.userId : 'ECLO Chat';
  const deviceId = state.status === 'signed_in' ? state.auth.deviceId : 'ECLO';
  const fallbackDisplayName = userId.replace(/^@/, '').split(':')[0] || 'ECLO';

  const refresh = useCallback(async () => {
    const requestId = ++refreshSequence.current;
    if (state.status === 'signed_in') {
      const [stored, matrixProfile, nativeProfile, apiResult] = await Promise.all([
        loadStoredProfile(state.auth.userId).catch(() => ({} as StoredProfile)),
        loadMatrixProfile(state.auth).catch(() => ({} as StoredProfile)),
        nativeMatrixService.isActive()
          ? nativeMatrixService.getOwnProfile().catch(() => ({} as StoredProfile))
          : Promise.resolve({} as StoredProfile),
        getEcloProfile(state.auth)
          .then(profile => ({profile, error: null as unknown}))
          .catch(error => ({profile: undefined, error})),
      ]);
      if (requestId !== refreshSequence.current) {
        return;
      }
      if (apiResult.error instanceof EcloApiError && apiResult.error.status === 401) {
        await signOut();
        return;
      }
      const merged = mergeEcloProfile(matrixProfile, apiResult.profile);
      const next: StoredProfile = {
        ...stored,
        ...merged,
        ...nativeProfile,
        displayName: nativeProfile.displayName || merged.displayName || stored.displayName,
        email: merged.email ?? stored.email ?? null,
        emailVerified: merged.email != null ? Boolean(merged.emailVerified) : Boolean(stored.emailVerified),
        pendingEmail: merged.pendingEmail ?? null,
        phone: merged.phone ?? stored.phone ?? null,
        phoneVerified: merged.phone != null ? Boolean(merged.phoneVerified) : Boolean(stored.phoneVerified),
      };
      await saveStoredProfile(state.auth.userId, next).catch(() => undefined);
      setRemoteProfile(next);
      return;
    }
    if (state.status === 'demo') {
      const stored = await loadStoredProfile(state.userId).catch(() => ({}));
      if (requestId === refreshSequence.current) {
        setRemoteProfile(stored);
      }
      return;
    }
    setRemoteProfile({});
  }, [signOut, state]);

  useEffect(() => {
    refresh().catch(() => undefined);
    return () => {
      refreshSequence.current += 1;
    };
  }, [refresh]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') {
        refresh().catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, [refresh]);

  const updateDisplayName = useCallback(async (displayName: string) => {
    const nextName = displayName.trim() || fallbackDisplayName;
    if (state.status === 'signed_in') {
      const previousName = remoteProfile.displayName || fallbackDisplayName;
      await updateMatrixDisplayName(state.auth, nextName);
      try {
        const apiProfile = await patchEcloProfile(state.auth, {displayName: nextName});
        const patch = mergeEcloProfile(remoteProfile, apiProfile);
        await saveStoredProfile(state.auth.userId, patch);
        setRemoteProfile(previous => ({...previous, ...patch, displayName: nextName}));
      } catch (error) {
        await updateMatrixDisplayName(state.auth, previousName).catch(() => undefined);
        throw error;
      }
      return;
    }
    await saveStoredProfile(userId, {displayName: nextName});
    setRemoteProfile(previous => ({...previous, displayName: nextName}));
  }, [fallbackDisplayName, remoteProfile, state, userId]);

  const updatePhone = useCallback(async (phone: string) => {
    const nextPhone = phone.trim() || null;
    if (state.status === 'signed_in') {
      const apiProfile = await patchEcloProfile(state.auth, {phone: nextPhone});
      const patch = mergeEcloProfile(remoteProfile, apiProfile);
      await saveStoredProfile(state.auth.userId, patch);
      setRemoteProfile(previous => ({...previous, ...patch}));
      return;
    }
    await saveStoredProfile(userId, {phone: nextPhone});
    setRemoteProfile(previous => ({...previous, phone: nextPhone}));
  }, [remoteProfile, state, userId]);

  const updateAvatar = useCallback(async (asset: Asset) => {
    if (state.status === 'signed_in') {
      const avatar = await updateMatrixAvatar(state.auth, asset);
      await saveStoredProfile(state.auth.userId, avatar);
      setRemoteProfile(previous => ({...previous, ...avatar}));
      return;
    }
    if (!asset.uri) {
      throw new Error('Không tìm thấy ảnh đã chọn.');
    }
    await saveStoredProfile(userId, {avatarUrl: asset.uri});
    setRemoteProfile(previous => ({...previous, avatarUrl: asset.uri}));
  }, [state, userId]);

  const displayName = useMemo(() => remoteProfile.displayName || fallbackDisplayName, [fallbackDisplayName, remoteProfile.displayName]);
  const initials = displayName.slice(0, 2).toUpperCase();
  const shortUserId = shortMatrixId(userId);

  return useMemo(() => ({
    avatarUrl: remoteProfile.avatarUrl,
    deviceId,
    displayName,
    email: remoteProfile.email,
    emailVerified: Boolean(remoteProfile.emailVerified),
    initials,
    pendingEmail: remoteProfile.pendingEmail,
    phone: remoteProfile.phone,
    phoneVerified: Boolean(remoteProfile.phoneVerified),
    refresh,
    shortUserId,
    updateAvatar,
    updatePhone,
    updateDisplayName,
    userId,
  }), [deviceId, displayName, initials, refresh, remoteProfile.avatarUrl, remoteProfile.email, remoteProfile.emailVerified, remoteProfile.pendingEmail, remoteProfile.phone, remoteProfile.phoneVerified, shortUserId, updateAvatar, updateDisplayName, updatePhone, userId]);
}

function useSettingsRuntime() {
  const {state} = useSession();
  const [security, setSecurity] = useState<SecurityStatus | null>(null);
  const [verification, setVerification] = useState<SecurityVerification>({phase: 'idle'});
  const [securityBusy, setSecurityBusy] = useState(false);
  const [securityFeedback, setSecurityFeedback] = useState<{kind: 'success' | 'error' | 'info'; text: string} | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refreshDevices = useCallback(async () => {
    if (state.status !== 'signed_in') {
      setDevices([]);
      return;
    }
    setError(null);
    try {
      setDevices(await listAccountDevices(state.auth));
    } catch (err) {
      setDevices([{device_id: state.auth.deviceId, display_name: 'Điện thoại ECLO'}]);
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách thiết bị.');
    }
  }, [state]);

  const refreshSecurity = useCallback(async () => {
    if (state.status !== 'signed_in') {
      setSecurity(null);
      setVerification({phase: 'idle'});
      return;
    }
    if (!nativeMatrixService.isActive()) {
      setSecurity(null);
      setSecurityFeedback({kind: 'error', text: 'Dữ liệu bảo mật trên thiết bị chưa sẵn sàng. Vui lòng mở lại ứng dụng.'});
      return;
    }
    try {
      const next = await nativeMatrixService.getSecurityStatus();
      setSecurity(next);
      setVerification(nativeMatrixService.getSecurityVerification());
    } catch (err) {
      setSecurityFeedback({kind: 'error', text: err instanceof Error ? err.message : 'Không thể đọc trạng thái bảo mật.'});
    }
  }, [state]);

  useEffect(() => {
    if (state.status !== 'signed_in') {
      setSecurity(null);
      setDevices([]);
      return;
    }
    refreshSecurity().catch(() => undefined);
    refreshDevices().catch(() => undefined);
    if (!nativeMatrixService.isActive()) {
      return;
    }
    return nativeMatrixService.subscribeSecurity(() => {
      refreshSecurity().catch(() => undefined);
    });
  }, [refreshDevices, refreshSecurity, state]);

  const crypto = state.status === 'signed_in'
    ? nativeMatrixService.isActive()
      ? nativeMatrixService.getCryptoStatus()
      : matrixClientService.getCryptoStatus()
    : {ready: false, error: null};

  async function runSecurityAction(action: () => Promise<void>, success: string): Promise<boolean> {
    setSecurityBusy(true);
    setSecurityFeedback(null);
    try {
      await action();
      await refreshSecurity();
      setSecurityFeedback({kind: 'success', text: success});
      return true;
    } catch (err) {
      setSecurityFeedback({kind: 'error', text: matrixErrorMessage(err)});
      return false;
    } finally {
      setSecurityBusy(false);
    }
  }

  async function setupSecureBackup(passphrase: string): Promise<string> {
    let result = '';
    const succeeded = await runSecurityAction(async () => {
      result = await nativeMatrixService.setupSecureBackup(passphrase, text => setSecurityFeedback({kind: 'info', text}));
    }, 'Sao lưu an toàn đã được bật. Hãy lưu Mã khôi phục ở nơi an toàn.');
    return succeeded ? result : '';
  }

  async function replaceSecureBackup(passphrase: string): Promise<string> {
    let result = '';
    const succeeded = await runSecurityAction(async () => {
      result = await nativeMatrixService.replaceSecureBackup(passphrase, text => setSecurityFeedback({kind: 'info', text}));
    }, 'Đã tạo sao lưu và Mã khôi phục mới.');
    return succeeded ? result : '';
  }

  async function restoreRecoveryKey(value: string): Promise<boolean> {
    return runSecurityAction(() => nativeMatrixService.recover(value), 'Đã khôi phục dữ liệu bảo mật. Tin nhắn cũ đang được cập nhật.');
  }

  async function rotateRecoveryKey(): Promise<string> {
    let result = '';
    const succeeded = await runSecurityAction(async () => { result = await nativeMatrixService.resetRecoveryKey(); }, 'Đã tạo Mã khôi phục mới. Mã cũ không còn sử dụng được.');
    return succeeded ? result : '';
  }

  async function resetIdentity(password: string) {
    await runSecurityAction(() => nativeMatrixService.resetIdentity(password), 'Đã đặt lại danh tính bảo mật. Hãy thiết lập sao lưu mới ngay.');
  }

  async function requestVerification() {
    await runSecurityAction(() => nativeMatrixService.requestDeviceVerification(), 'Đang chờ một thiết bị khác trong cùng tài khoản chấp nhận yêu cầu.');
  }

  async function acceptVerification() {
    await runSecurityAction(() => nativeMatrixService.acceptDeviceVerification(), 'Đã chấp nhận yêu cầu. Hãy bắt đầu so sánh mã.');
  }

  async function startSasVerification() {
    await runSecurityAction(() => nativeMatrixService.startSasVerification(), 'Đang tạo mã so sánh trên hai thiết bị.');
  }

  async function approveVerification() {
    await runSecurityAction(() => nativeMatrixService.approveSasVerification(), 'Xác thực thiết bị thành công.');
  }

  async function declineVerification() {
    await runSecurityAction(() => nativeMatrixService.declineSasVerification(), 'Đã hủy vì mã trên hai thiết bị không khớp.');
  }

  async function cancelVerification() {
    await runSecurityAction(() => nativeMatrixService.cancelDeviceVerification(), 'Đã hủy yêu cầu xác thực.');
  }

  async function removeDevice(deviceId: string, password: string) {
    if (state.status !== 'signed_in') {
      throw new Error('Cần đăng nhập để xóa thiết bị.');
    }
    await deleteAccountDevice(state.auth, deviceId, password);
    await refreshDevices();
  }

  return {
    acceptVerification,
    approveVerification,
    cancelVerification,
    crypto,
    declineVerification,
    devices,
    error,
    refreshDevices,
    refreshSecurity,
    removeDevice,
    replaceSecureBackup,
    requestVerification,
    resetIdentity,
    restoreRecoveryKey,
    rotateRecoveryKey,
    security,
    securityBusy,
    securityFeedback,
    setupSecureBackup,
    startSasVerification,
    verification,
  };
}

function titleForSettingsPage(page: SettingsPage): string {
  return settingItems.find(item => item.id === page)?.title ?? 'Cài đặt';
}

function confirmBackupReplacement(): Promise<boolean> {
  return new Promise(resolve => {
    Alert.alert('Tạo sao lưu mới?', 'Sao lưu hiện tại sẽ được thay thế.', [
      {text: 'Hủy', style: 'cancel', onPress: () => resolve(false)},
      {text: 'Tạo mới', style: 'destructive', onPress: () => resolve(true)},
    ], {cancelable: true, onDismiss: () => resolve(false)});
  });
}

function formatRecoveryKey(value: string): string {
  const compact = value.replace(/\s+/g, '');
  return compact.match(/.{1,4}/g)?.join(' ') ?? value;
}

const styles = StyleSheet.create({
  screen: {flex: 1},
  content: {paddingHorizontal: 16, paddingBottom: 108},
  pageContent: {paddingHorizontal: 18, paddingBottom: 108},
  headerBackHit: {width: 46, height: 46, alignItems: 'center', justifyContent: 'center'},
  headerBackIcon: {fontSize: 38, lineHeight: 40, fontWeight: '300', marginTop: -2},
  profileTop: {alignItems: 'center', paddingTop: 4, paddingBottom: 22},
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: {width: 0, height: 12},
    shadowOpacity: 0.14,
    shadowRadius: 20,
    elevation: 10,
  },
  avatarText: {color: '#fff', fontSize: 30, fontWeight: '900'},
  name: {fontSize: 24, lineHeight: 30, fontWeight: '900', marginTop: 14},
  account: {maxWidth: '92%', fontSize: 14, lineHeight: 20, fontWeight: '700', marginTop: 2},
  server: {fontSize: 13, lineHeight: 18, fontWeight: '700', marginTop: 2},
  error: {borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, overflow: 'hidden', fontWeight: '700', marginBottom: 12},
  menuGroup: {
    borderRadius: 22,
    overflow: 'hidden',
    shadowOffset: {width: 0, height: 10},
    shadowOpacity: 0.06,
    shadowRadius: 24,
    elevation: 6,
  },
  menuGroupGap: {marginTop: 14},
  menuRow: {minHeight: 74, flexDirection: 'row', alignItems: 'center', paddingLeft: 16},
  menuIcon: {width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center'},
  menuIconText: {color: '#fff', fontSize: 17, lineHeight: 21, fontWeight: '900'},
  menuText: {flex: 1, minHeight: 74, marginLeft: 16, paddingRight: 16, flexDirection: 'row', alignItems: 'center'},
  menuTitleBlock: {flex: 1, minWidth: 0},
  menuTitle: {fontSize: 16, lineHeight: 21, fontWeight: '800'},
  menuSubtitle: {fontSize: 12, lineHeight: 17, fontWeight: '600', marginTop: 2},
  chevron: {fontSize: 25, fontWeight: '300', marginLeft: 8},
  logoutRow: {height: 54, alignItems: 'center', justifyContent: 'center'},
  logoutText: {fontSize: 16, fontWeight: '900'},
  pageTitleBlock: {marginBottom: 18},
  pageTitle: {fontSize: 28, lineHeight: 34, fontWeight: '900'},
  pageSubtitle: {fontSize: 14, lineHeight: 20, fontWeight: '600', marginTop: 8},
  sectionLabel: {fontSize: 13, lineHeight: 18, fontWeight: '900', textTransform: 'uppercase', marginTop: 18, marginBottom: 9, marginLeft: 2},
  settingsGroup: {borderRadius: 18, overflow: 'hidden', shadowOffset: {width: 0, height: 8}, shadowOpacity: 0.06, shadowRadius: 18, elevation: 5},
  detailRow: {minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 12},
  detailIcon: {width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center'},
  detailIconText: {color: '#fff', fontSize: 15, fontWeight: '900'},
  detailTitle: {fontSize: 16, lineHeight: 21, fontWeight: '800'},
  detailSubtitle: {fontSize: 13, lineHeight: 19, fontWeight: '600', marginTop: 2},
  detailValue: {maxWidth: 130, fontSize: 14, fontWeight: '700'},
  flex1: {flex: 1, minWidth: 0},
  profileEditHeader: {alignItems: 'center', paddingVertical: 14},
  profilePhoto: {width: 112, height: 112, borderRadius: 56, borderWidth: 4, alignItems: 'center', justifyContent: 'center'},
  profilePhotoText: {color: '#fff', fontSize: 34, fontWeight: '900'},
  avatarBusyOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 56,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  avatarBusyText: {color: '#fff', fontSize: 11, fontWeight: '900'},
  cameraButton: {position: 'absolute', right: -2, bottom: 7, width: 34, height: 34, borderRadius: 17, borderWidth: 3, alignItems: 'center', justifyContent: 'center'},
  cameraText: {color: '#fff', fontSize: 17, fontWeight: '900'},
  pageProfileName: {fontSize: 26, fontWeight: '900', marginTop: 14},
  pageProfileId: {fontSize: 15, fontWeight: '700', marginTop: 4},
  profileStatus: {alignSelf: 'center', overflow: 'hidden', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, fontWeight: '800', marginBottom: 4},
  profileField: {minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12},
  profileFieldIcon: {width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center'},
  profileFieldIconText: {color: '#fff', fontSize: 16, fontWeight: '900'},
  profileFieldLabel: {fontSize: 11, lineHeight: 15, fontWeight: '900', textTransform: 'uppercase'},
  profileFieldInput: {height: 40, padding: 0, margin: 0, fontSize: 17, lineHeight: 22, fontWeight: '800'},
  profileHint: {fontSize: 12, lineHeight: 18, fontWeight: '700', marginTop: 2},
  profileActionRow: {minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 12},
  profileActionBorder: {borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12},
  passwordPanel: {borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, gap: 2},
  passwordButton: {height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginTop: 8},
  passwordButtonText: {color: '#fff', fontSize: 15, fontWeight: '900'},
  inlineLinkButton: {alignSelf: 'center', paddingHorizontal: 14, paddingVertical: 10, marginTop: 6},
  inlineLinkText: {fontSize: 14, fontWeight: '900'},
  deactivateWarning: {borderRadius: 18, padding: 16, marginBottom: 14},
  deactivateTitle: {fontSize: 17, lineHeight: 22, fontWeight: '900'},
  deactivateText: {fontSize: 14, lineHeight: 20, fontWeight: '700', marginTop: 6},
  actionIntroCard: {
    borderRadius: 22,
    padding: 18,
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
    shadowOffset: {width: 0, height: 8},
    shadowOpacity: 0.05,
    shadowRadius: 18,
    elevation: 4,
  },
  actionHeroIcon: {width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', marginBottom: 4},
  actionHeroIconText: {fontSize: 26, fontWeight: '900'},
  actionTitle: {fontSize: 22, lineHeight: 28, fontWeight: '900', textAlign: 'center'},
  actionText: {fontSize: 14, lineHeight: 20, fontWeight: '700', textAlign: 'center'},
  actionDeviceId: {maxWidth: '100%', fontSize: 12, lineHeight: 18, fontWeight: '800', marginTop: 2},
  blockInputRow: {flexDirection: 'row', alignItems: 'center', gap: 10},
  blockInput: {flex: 1, height: 44, borderRadius: 16, paddingHorizontal: 14, fontSize: 15, fontWeight: '800'},
  blockAddButton: {height: 44, borderRadius: 16, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center'},
  blockAddText: {fontSize: 14, fontWeight: '900'},
  contactSearchBox: {height: 46, borderRadius: 15, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8},
  contactSearchIcon: {fontSize: 21, fontWeight: '800'},
  contactSearchInput: {flex: 1, height: 46, padding: 0, fontSize: 16, fontWeight: '700'},
  contactPickerRow: {minHeight: 64, marginHorizontal: -2, paddingHorizontal: 4, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 12},
  contactPickerName: {fontSize: 16, lineHeight: 21, fontWeight: '800'},
  contactPickerUsername: {fontSize: 13, lineHeight: 18, fontWeight: '600', marginTop: 2},
  contactPickerCheck: {width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center'},
  contactPickerCheckText: {color: '#fff', fontSize: 14, fontWeight: '900'},
  contactPickerEmpty: {minHeight: 86, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12},
  blockedRow: {minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 12},
  blockedUserId: {flex: 1, fontSize: 16, fontWeight: '800'},
  unblockButton: {height: 34, borderRadius: 17, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center'},
  unblockText: {fontSize: 13, fontWeight: '900'},
  profileSaveButton: {height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', marginTop: 18},
  profileSaveText: {fontSize: 16, fontWeight: '900'},
  settingBlock: {padding: 14, gap: 12},
  settingBlockTop: {flexDirection: 'row', alignItems: 'center', gap: 12},
  mobileSettingStack: {gap: 12},
  mobileSettingCard: {
    borderRadius: 18,
    padding: 14,
    gap: 12,
    shadowOffset: {width: 0, height: 8},
    shadowOpacity: 0.05,
    shadowRadius: 18,
    elevation: 4,
  },
  mobileSettingHeader: {flexDirection: 'row', alignItems: 'center', gap: 12},
  mobileSegment: {height: 44, borderRadius: 22, flexDirection: 'row', gap: 6},
  mobileSegmentItem: {flex: 1, borderRadius: 20},
  mobileSegmentGlass: {borderRadius: 20},
  segment: {height: 32, borderRadius: 16, flexDirection: 'row', padding: 2},
  segmentItem: {minWidth: 54, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10},
  segmentText: {fontSize: 12, fontWeight: '800'},
  colorPreview: {width: 46, height: 36, borderRadius: 10, borderWidth: 1, padding: 5},
  colorPreviewInner: {flex: 1, borderRadius: 6},
  swatches: {flexDirection: 'row', justifyContent: 'space-between', gap: 8},
  swatch: {width: 40, height: 40, borderRadius: 20},
  swatchGlass: {borderRadius: 20, padding: 3},
  swatchContent: {borderRadius: 17},
  swatchCheck: {color: '#fff', fontSize: 16, fontWeight: '900'},
  valuePill: {overflow: 'hidden', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6, fontSize: 12, fontWeight: '900'},
  sliderTrack: {height: 7, borderRadius: 4, overflow: 'hidden'},
  sliderFill: {height: 7, borderRadius: 4},
  stepperRow: {flexDirection: 'row', justifyContent: 'flex-end', gap: 8},
  stepperButton: {width: 38, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center'},
  stepperText: {fontSize: 20, fontWeight: '900'},
  backgroundChoices: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  backgroundChoice: {width: '48%', height: 58, borderRadius: 18},
  backgroundChoiceGlass: {borderRadius: 18},
  backgroundChoiceContent: {alignItems: 'flex-start', paddingHorizontal: 10},
  backgroundChoiceText: {overflow: 'hidden', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: 'rgba(255,255,255,0.74)', fontSize: 12, fontWeight: '900'},
  fontGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  fontChip: {height: 42, width: '48%', borderRadius: 20},
  fontChipGlass: {borderRadius: 20},
  fontChipText: {fontSize: 13, fontWeight: '900'},
  sizeStepperRow: {height: 42, flexDirection: 'row', alignItems: 'center', gap: 10},
  sizeButton: {width: 42, height: 42, borderRadius: 21},
  sizeButtonGlass: {borderRadius: 21},
  sizePreview: {flex: 1, textAlign: 'center', fontWeight: '800'},
  privacyPanel: {borderRadius: 18, padding: 18, shadowOffset: {width: 0, height: 8}, shadowOpacity: 0.06, shadowRadius: 18, elevation: 5},
  inlineHeader: {flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14},
  smallDangerIcon: {fontSize: 16, fontWeight: '900'},
  emptyBlock: {height: 178, borderWidth: 1, borderRadius: 16, alignItems: 'center', justifyContent: 'center'},
  emptyIcon: {fontSize: 30, marginBottom: 8},
  emptyText: {fontSize: 15, fontWeight: '700'},
  infoStrip: {overflow: 'hidden', borderRadius: 12, padding: 12, fontSize: 13, lineHeight: 19, fontWeight: '600', marginTop: 16},
  trustCard: {borderRadius: 18, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14},
  trustIcon: {width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center'},
  trustIconText: {color: '#fff', fontSize: 20, fontWeight: '900'},
  trustTitle: {fontSize: 20, lineHeight: 26, fontWeight: '900'},
  trustText: {fontSize: 13, lineHeight: 19, fontWeight: '600', marginTop: 4},
  securityHint: {fontSize: 12, lineHeight: 18, fontWeight: '700', textAlign: 'center'},
  securityNotice: {borderRadius: 14, padding: 14, gap: 10, alignItems: 'center'},
  securityActionRow: {flexDirection: 'row', gap: 10},
  securityActionButton: {flex: 1, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12},
  securityRaisedButton: {borderWidth: 1, shadowColor: '#000', shadowOffset: {width: 0, height: 3}, shadowOpacity: 0.18, shadowRadius: 5, elevation: 4},
  actionPressed: {opacity: 0.9, transform: [{translateY: 2}, {scale: 0.985}], shadowOpacity: 0.06, elevation: 1},
  securityActionText: {fontSize: 14, fontWeight: '900'},
  backupSetupBox: {borderRadius: 16, padding: 12, gap: 10},
  backupSetupInput: {height: 48, borderRadius: 14, paddingHorizontal: 14, fontSize: 15, fontWeight: '800'},
  recoveryModalBackdrop: {flex: 1, backgroundColor: 'rgba(5, 10, 20, 0.55)'},
  recoveryModalKeyboard: {flex: 1, justifyContent: 'flex-end'},
  recoveryModalSheet: {borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 10, gap: 16},
  recoveryModalHandle: {width: 42, height: 5, borderRadius: 3, alignSelf: 'center'},
  recoveryModalTitle: {fontSize: 22, lineHeight: 28, fontWeight: '900', textAlign: 'center'},
  recoveryModalInputRow: {height: 56, borderRadius: 16, flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 6, gap: 8},
  recoveryModalInput: {flex: 1, height: 54, padding: 0, fontSize: 17, fontWeight: '800', letterSpacing: 0.4},
  recoveryPasteButton: {height: 42, borderRadius: 13, paddingHorizontal: 15, alignItems: 'center', justifyContent: 'center'},
  recoveryPasteText: {fontSize: 14, fontWeight: '900'},
  recoveryModalError: {fontSize: 13, lineHeight: 18, fontWeight: '700', textAlign: 'center'},
  securityAccountPill: {alignSelf: 'flex-start', overflow: 'hidden', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, fontSize: 12, fontWeight: '900'},
  sasCard: {borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 12},
  sasTitle: {fontSize: 15, lineHeight: 21, fontWeight: '900', textAlign: 'center'},
  sasEmojiRow: {flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 8},
  sasEmojiItem: {width: 48, alignItems: 'center', gap: 3},
  sasEmoji: {fontSize: 28},
  sasEmojiLabel: {fontSize: 9, fontWeight: '700', textAlign: 'center'},
  sasDecimals: {fontSize: 21, lineHeight: 30, fontWeight: '900', textAlign: 'center', letterSpacing: 1},
  sasActions: {flexDirection: 'row', gap: 10},
  sasButton: {flex: 1, minHeight: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10},
  recoveryResult: {borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 10},
  recoveryCode: {overflow: 'hidden', borderRadius: 12, padding: 12, fontSize: 16, lineHeight: 25, fontWeight: '900', letterSpacing: 0.5, textAlign: 'center'},
  recoveryResultActions: {flexDirection: 'row', gap: 10},
  copyRecoveryButton: {flex: 1, minHeight: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12},
  inputBox: {borderRadius: 16, paddingHorizontal: 14, paddingTop: 11, paddingBottom: 4},
  inputLabel: {fontSize: 12, fontWeight: '900', textTransform: 'uppercase'},
  input: {height: 44, fontSize: 15, fontWeight: '700'},
  primaryAction: {height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center'},
  primaryActionText: {fontSize: 15, fontWeight: '900'},
  softDangerButton: {height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: 14},
  softDangerText: {fontSize: 14, fontWeight: '900'},
  clearIndexButton: {marginHorizontal: 14, marginBottom: 14, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: 14},
  clearIndexText: {fontSize: 14, fontWeight: '900'},
  deviceCard: {minHeight: 96, borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 14, shadowOffset: {width: 0, height: 6}, shadowOpacity: 0.05, shadowRadius: 14, elevation: 4},
  deviceIcon: {width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center'},
  deviceIconText: {fontSize: 20, fontWeight: '900'},
  deviceTitleRow: {flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap'},
  deviceName: {fontSize: 16, fontWeight: '900'},
  onlinePill: {overflow: 'hidden', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, fontSize: 11, fontWeight: '900'},
  deviceLogout: {width: 42, height: 42, borderRadius: 21, borderWidth: 1, alignItems: 'center', justifyContent: 'center'},
  deviceLogoutText: {fontSize: 18, fontWeight: '900'},
  deviceConfirmActions: {flexDirection: 'row', gap: 10, marginTop: 4},
  deviceCancelButton: {flex: 1, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center'},
  deviceConfirmButton: {flex: 1, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center'},
  deviceCancelText: {fontSize: 15, fontWeight: '900'},
  emptyLine: {fontSize: 14, fontWeight: '700', marginTop: 4},
  aboutHero: {
    borderRadius: 24,
    padding: 18,
    alignItems: 'center',
    shadowOffset: {width: 0, height: 10},
    shadowOpacity: 0.06,
    shadowRadius: 22,
    elevation: 5,
  },
  aboutLogoBubble: {width: 104, height: 104, borderRadius: 30, alignItems: 'center', justifyContent: 'center'},
  aboutLogoText: {fontSize: 42, lineHeight: 47, fontWeight: '900'},
  aboutLogoUrl: {fontSize: 7, fontWeight: '900', fontStyle: 'italic', marginTop: -7, marginLeft: 28},
  aboutHeroTitle: {fontSize: 25, lineHeight: 31, fontWeight: '900', marginTop: 14},
  aboutHeroText: {fontSize: 14, lineHeight: 21, fontWeight: '700', textAlign: 'center', marginTop: 6},
  aboutPills: {flexDirection: 'row', gap: 8, marginTop: 14},
  aboutPill: {overflow: 'hidden', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6, fontSize: 12, fontWeight: '900'},
  aboutInfoRow: {minHeight: 70, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 12},
  aboutSecurityCard: {borderRadius: 20, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14},
  aboutLinkRow: {height: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16},
  aboutRowText: {flex: 1, fontSize: 15, fontWeight: '700'},
  externalIcon: {fontSize: 18, fontWeight: '700'},
  aboutCopyright: {fontSize: 12, lineHeight: 18, fontWeight: '700', textAlign: 'center', marginTop: 18},
  rowPressed: {opacity: 0.72},
  pressed: {opacity: 0.72},
});
