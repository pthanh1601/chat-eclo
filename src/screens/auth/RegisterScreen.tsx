import React, {useState} from 'react';
import {ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {useSession} from '../../context/SessionContext';
import {matrixErrorMessage} from '../../core/matrix/errors';
import {MATRIX_HOMESERVER} from '../../config/matrix';
import type {RootStackParamList} from '../../navigation/RootNavigator';
import {normalizeEmail, normalizeOtp, RegistrationLoginError, requestRegistrationCode} from '../../core/api/EcloAuthProfileService';
import {AUTH_PASSWORD_MIN_LENGTH, AUTH_USERNAME_MAX_LENGTH, AUTH_USERNAME_MIN_LENGTH, OTP_MAX_DIGITS, OTP_MIN_DIGITS} from '../../config/appConfig';

type Props = NativeStackScreenProps<RootStackParamList, 'AuthRegister'>;

const theme = {
  light: {
    background: '#fff',
    title: '#050505',
    text: '#6b7280',
    input: '#eef1f5',
    inputText: '#111827',
    placeholder: '#687282',
    footer: '#b5bbc5',
  },
  dark: {
    background: '#0b1020',
    title: '#f8fafc',
    text: '#94a3b8',
    input: '#111827',
    inputText: '#f8fafc',
    placeholder: '#73839a',
    footer: '#64748b',
  },
};

export function RegisterScreen({navigation}: Props) {
  const isDark = useColorScheme() === 'dark';
  const colors = isDark ? theme.dark : theme.light;
  const {register} = useSession();
  const [step, setStep] = useState<'form' | 'otp'>('form');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const nextUsername = username.trim().toLowerCase();
    const nextEmail = normalizeEmail(email);
    const nextDisplayName = displayName.trim();
    if (nextUsername.length < AUTH_USERNAME_MIN_LENGTH || nextUsername.length > AUTH_USERNAME_MAX_LENGTH) {
      setError(`Tên đăng nhập cần từ ${AUTH_USERNAME_MIN_LENGTH} đến ${AUTH_USERNAME_MAX_LENGTH} ký tự.`);
      return;
    }
    if (!/^[a-z0-9_=\-.]+$/.test(nextUsername) || nextUsername.startsWith('.') || nextUsername.endsWith('.')) {
      setError('Tên đăng nhập chỉ dùng chữ thường, số, dấu chấm, gạch dưới hoặc gạch ngang.');
      return;
    }
    if (!nextDisplayName) {
      setError('Vui lòng nhập tên hiển thị.');
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(nextEmail)) {
      setError('Email không hợp lệ.');
      return;
    }
    if (password.length < AUTH_PASSWORD_MIN_LENGTH) {
      setError(`Mật khẩu cần tối thiểu ${AUTH_PASSWORD_MIN_LENGTH} ký tự.`);
      return;
    }
    if (password !== confirmPassword) {
      setError('Mật khẩu xác nhận không khớp.');
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (step === 'form') {
        await requestRegistrationCode(nextEmail);
        setEmail(nextEmail);
        setUsername(nextUsername);
        setDisplayName(nextDisplayName);
        setStep('otp');
        setMessage(`Mã xác thực đã được gửi tới ${nextEmail}.`);
        return;
      }
      const otp = normalizeOtp(code);
      if (otp.length < OTP_MIN_DIGITS) {
        setError(`Vui lòng nhập mã xác thực gồm ${OTP_MIN_DIGITS}-${OTP_MAX_DIGITS} chữ số.`);
        return;
      }
      await register({
        username: nextUsername,
        displayName: nextDisplayName,
        email: nextEmail,
        password,
        code: otp,
      }, MATRIX_HOMESERVER);
    } catch (err) {
      if (err instanceof RegistrationLoginError) {
        navigation.replace('AuthLogin', {username: err.username, notice: err.message});
        return;
      }
      setError(matrixErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function resendCode() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await requestRegistrationCode(email);
      setMessage(`Đã gửi lại mã xác thực tới ${email}.`);
    } catch (err) {
      setError(matrixErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.root, {backgroundColor: colors.background}]}>
      <SafeAreaView style={[styles.safeArea, {backgroundColor: colors.background}]}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.logoBlock}>
            <Text style={styles.logoWord}>eclo</Text>
            <Text style={[styles.logoUrl, {color: colors.title}]}>www.eclo.chat</Text>
          </View>

          <View style={styles.heading}>
            <Text style={[styles.title, {color: colors.title}]}>{step === 'otp' ? 'Xác thực email' : 'Tạo tài khoản'}</Text>
            <Text style={[styles.hint, {color: colors.text}]}>{step === 'otp' ? `Nhập mã OTP đã gửi tới ${email}.` : 'Điền đầy đủ thông tin để nhận mã kích hoạt qua email.'}</Text>
          </View>

          <View style={styles.form}>
            {step === 'form' ? (
              <>
                <TextInput autoCapitalize="none" autoCorrect={false} placeholder="Tên đăng nhập" placeholderTextColor={colors.placeholder} style={[styles.input, {backgroundColor: colors.input, color: colors.inputText}]} value={username} onChangeText={setUsername} />
                <TextInput placeholder="Tên hiển thị" placeholderTextColor={colors.placeholder} style={[styles.input, {backgroundColor: colors.input, color: colors.inputText}]} value={displayName} onChangeText={setDisplayName} />
                <TextInput autoCapitalize="none" autoCorrect={false} keyboardType="email-address" placeholder="Email" placeholderTextColor={colors.placeholder} style={[styles.input, {backgroundColor: colors.input, color: colors.inputText}]} value={email} onChangeText={setEmail} />
                <TextInput placeholder={`Mật khẩu (ít nhất ${AUTH_PASSWORD_MIN_LENGTH} ký tự)`} placeholderTextColor={colors.placeholder} secureTextEntry style={[styles.input, {backgroundColor: colors.input, color: colors.inputText}]} value={password} onChangeText={setPassword} />
                <TextInput placeholder="Nhập lại mật khẩu" placeholderTextColor={colors.placeholder} secureTextEntry style={[styles.input, {backgroundColor: colors.input, color: colors.inputText}]} value={confirmPassword} onChangeText={setConfirmPassword} />
              </>
            ) : (
              <>
                <TextInput autoFocus keyboardType="number-pad" maxLength={OTP_MAX_DIGITS} placeholder="Mã xác thực" placeholderTextColor={colors.placeholder} style={[styles.input, styles.otpInput, {backgroundColor: colors.input, color: colors.inputText}]} value={code} onChangeText={value => setCode(normalizeOtp(value))} />
                <View style={styles.otpActions}>
                  <Pressable accessibilityRole="button" disabled={busy} onPress={() => setStep('form')} style={styles.editButton}><Text style={styles.editText}>Sửa thông tin</Text></Pressable>
                  <Pressable accessibilityRole="button" disabled={busy} onPress={resendCode} style={styles.editButton}><Text style={styles.editText}>Gửi lại mã</Text></Pressable>
                </View>
              </>
            )}

            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={submit}
              style={({pressed}) => [
                styles.primaryButton,
                (pressed && !busy) ? styles.buttonPressed : null,
              ]}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>{step === 'form' ? 'GỬI MÃ XÁC THỰC' : 'XÁC THỰC & ĐĂNG KÝ'}</Text>}
            </Pressable>

            {message ? <Text style={styles.message}>{message}</Text> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>

          <View style={styles.registerRow}>
            <Text style={[styles.registerText, {color: colors.text}]}>Đã có tài khoản? </Text>
            <Pressable accessibilityRole="button" onPress={() => navigation.navigate('AuthLogin')} hitSlop={8}>
              <Text style={styles.registerLink}>Đăng nhập</Text>
            </Pressable>
          </View>

          <Text style={[styles.footer, {color: colors.footer}]}>© 2026 ECLO CHAT.</Text>
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  safeArea: {flex: 1},
  content: {flexGrow: 1, paddingHorizontal: 32, paddingTop: 84, paddingBottom: 34},
  logoBlock: {alignSelf: 'flex-start', marginBottom: 50},
  logoWord: {color: '#0b7cff', fontSize: 74, lineHeight: 76, fontWeight: '900'},
  logoUrl: {fontSize: 11, fontStyle: 'italic', alignSelf: 'flex-end', marginTop: -8, marginRight: 18},
  heading: {marginBottom: 26},
  title: {fontSize: 26, lineHeight: 32, fontWeight: '900'},
  hint: {fontSize: 15, lineHeight: 22, marginTop: 6, fontWeight: '600'},
  form: {gap: 16},
  input: {height: 58, borderRadius: 16, paddingHorizontal: 24, fontSize: 16, fontWeight: '700'},
  otpInput: {fontSize: 24, letterSpacing: 8, textAlign: 'center'},
  editButton: {alignSelf: 'center', paddingHorizontal: 10, paddingVertical: 4},
  editText: {color: '#0b7cff', fontSize: 14, fontWeight: '800'},
  otpActions: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16},
  primaryButton: {
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0b7cff',
    shadowColor: '#0b7cff',
    shadowOffset: {width: 0, height: 14},
    shadowOpacity: 0.24,
    shadowRadius: 22,
    elevation: 8,
    marginTop: 8,
  },
  primaryButtonText: {color: '#fff', fontSize: 16, fontWeight: '900'},
  buttonPressed: {opacity: 0.86},
  error: {color: '#b42318', backgroundColor: '#fff1f0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, overflow: 'hidden', fontWeight: '700'},
  message: {color: '#067647', backgroundColor: '#ecfdf3', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, overflow: 'hidden', fontWeight: '700'},
  registerRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 28},
  registerText: {fontSize: 14, fontWeight: '600'},
  registerLink: {color: '#0b7cff', fontSize: 14, fontWeight: '900'},
  footer: {textAlign: 'center', fontSize: 13, fontWeight: '700', marginTop: 'auto', paddingTop: 56},
});
