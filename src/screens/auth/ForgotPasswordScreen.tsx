import React, {useState} from 'react';
import {ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {RootStackParamList} from '../../navigation/RootNavigator';
import {normalizeEmail, normalizeOtp, requestPasswordResetCode, resetPassword} from '../../core/api/EcloAuthProfileService';
import {AUTH_PASSWORD_MIN_LENGTH, OTP_MAX_DIGITS, OTP_MIN_DIGITS} from '../../config/appConfig';

type Props = NativeStackScreenProps<RootStackParamList, 'AuthForgotPassword'>;

export function ForgotPasswordScreen({navigation}: Props) {
  const dark = useColorScheme() === 'dark';
  const colors = dark
    ? {background: '#0b1020', title: '#f8fafc', text: '#94a3b8', input: '#111827', inputText: '#f8fafc', placeholder: '#73839a'}
    : {background: '#fff', title: '#050505', text: '#6b7280', input: '#eef1f5', inputText: '#111827', placeholder: '#687282'};
  const [step, setStep] = useState<'email' | 'otp' | 'done'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    const normalizedEmail = normalizeEmail(email);
    setError(null);
    setMessage(null);
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setError('Email không hợp lệ.');
      return;
    }
    if (step === 'otp') {
      if (normalizeOtp(code).length < OTP_MIN_DIGITS) {
        setError(`Vui lòng nhập mã xác thực gồm ${OTP_MIN_DIGITS}-${OTP_MAX_DIGITS} chữ số.`);
        return;
      }
      if (password.length < AUTH_PASSWORD_MIN_LENGTH) {
        setError(`Mật khẩu mới cần tối thiểu ${AUTH_PASSWORD_MIN_LENGTH} ký tự.`);
        return;
      }
      if (password !== confirmPassword) {
        setError('Mật khẩu xác nhận không khớp.');
        return;
      }
    }
    setBusy(true);
    try {
      if (step === 'email') {
        await requestPasswordResetCode(normalizedEmail);
        setEmail(normalizedEmail);
        setStep('otp');
        setMessage('Nếu email tồn tại, mã khôi phục đã được gửi.');
      } else if (step === 'otp') {
        await resetPassword(normalizedEmail, code, password);
        setStep('done');
        setPassword('');
        setConfirmPassword('');
        setCode('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể khôi phục mật khẩu.');
    } finally {
      setBusy(false);
    }
  }

  async function resendCode() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await requestPasswordResetCode(email);
      setMessage('Đã gửi lại mã khôi phục.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể gửi lại mã.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.root, {backgroundColor: colors.background}]}>
      <SafeAreaView style={styles.root}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.logoBlock}>
            <Text style={styles.logo}>eclo</Text>
            <Text style={[styles.logoUrl, {color: colors.title}]}>www.eclo.chat</Text>
          </View>
          <Text style={[styles.title, {color: colors.title}]}>{step === 'done' ? 'Đã đổi mật khẩu' : 'Khôi phục mật khẩu'}</Text>
          <Text style={[styles.hint, {color: colors.text}]}>
            {step === 'email' ? 'Nhập email đã đăng ký để nhận mã xác thực.' : step === 'otp' ? `Nhập mã đã gửi tới ${email} và đặt mật khẩu mới.` : 'Bạn có thể đăng nhập bằng mật khẩu mới.'}
          </Text>

          {step !== 'done' ? (
            <View style={styles.form}>
              {step === 'email' ? (
                <TextInput autoFocus autoCapitalize="none" autoCorrect={false} keyboardType="email-address" placeholder="Email" placeholderTextColor={colors.placeholder} style={[styles.input, {backgroundColor: colors.input, color: colors.inputText}]} value={email} onChangeText={setEmail} />
              ) : (
                <>
                  <TextInput autoFocus keyboardType="number-pad" maxLength={OTP_MAX_DIGITS} placeholder="Mã xác thực" placeholderTextColor={colors.placeholder} style={[styles.input, styles.otpInput, {backgroundColor: colors.input, color: colors.inputText}]} value={code} onChangeText={value => setCode(normalizeOtp(value))} />
                  <TextInput placeholder="Mật khẩu mới" placeholderTextColor={colors.placeholder} secureTextEntry style={[styles.input, {backgroundColor: colors.input, color: colors.inputText}]} value={password} onChangeText={setPassword} />
                  <TextInput placeholder="Nhập lại mật khẩu mới" placeholderTextColor={colors.placeholder} secureTextEntry style={[styles.input, {backgroundColor: colors.input, color: colors.inputText}]} value={confirmPassword} onChangeText={setConfirmPassword} />
                  <Pressable accessibilityRole="button" disabled={busy} onPress={resendCode} style={styles.resendButton}><Text style={styles.resendText}>Gửi lại mã xác thực</Text></Pressable>
                </>
              )}
              <Pressable accessibilityRole="button" disabled={busy} onPress={submit} style={({pressed}) => [styles.primaryButton, pressed && !busy ? styles.pressed : null]}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{step === 'email' ? 'GỬI MÃ KHÔI PHỤC' : 'ĐỔI MẬT KHẨU'}</Text>}
              </Pressable>
              {message ? <Text style={styles.message}>{message}</Text> : null}
              {error ? <Text style={styles.error}>{error}</Text> : null}
            </View>
          ) : (
            <Pressable accessibilityRole="button" onPress={() => navigation.replace('AuthLogin')} style={styles.primaryButton}>
              <Text style={styles.primaryText}>VỀ ĐĂNG NHẬP</Text>
            </Pressable>
          )}
          {step !== 'done' ? <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.backButton}><Text style={styles.backText}>Quay lại đăng nhập</Text></Pressable> : null}
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  content: {flexGrow: 1, paddingHorizontal: 32, paddingTop: 84, paddingBottom: 34},
  logoBlock: {alignSelf: 'flex-start', marginBottom: 48},
  logo: {color: '#0b7cff', fontSize: 74, lineHeight: 76, fontWeight: '900'},
  logoUrl: {fontSize: 11, fontStyle: 'italic', alignSelf: 'flex-end', marginTop: -8, marginRight: 18},
  title: {fontSize: 26, lineHeight: 32, fontWeight: '900'},
  hint: {fontSize: 15, lineHeight: 22, marginTop: 6, marginBottom: 26, fontWeight: '600'},
  form: {gap: 16},
  input: {height: 58, borderRadius: 16, paddingHorizontal: 24, fontSize: 16, fontWeight: '700'},
  otpInput: {fontSize: 24, letterSpacing: 8, textAlign: 'center'},
  primaryButton: {height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0b7cff', marginTop: 8},
  primaryText: {color: '#fff', fontSize: 16, fontWeight: '900'},
  pressed: {opacity: 0.84},
  message: {color: '#067647', backgroundColor: '#ecfdf3', borderRadius: 8, padding: 12, overflow: 'hidden', fontWeight: '700'},
  error: {color: '#b42318', backgroundColor: '#fff1f0', borderRadius: 8, padding: 12, overflow: 'hidden', fontWeight: '700'},
  backButton: {alignSelf: 'center', padding: 12, marginTop: 18},
  backText: {color: '#0b7cff', fontSize: 14, fontWeight: '900'},
  resendButton: {alignSelf: 'center', paddingHorizontal: 10, paddingVertical: 4},
  resendText: {color: '#0b7cff', fontSize: 14, fontWeight: '800'},
});
