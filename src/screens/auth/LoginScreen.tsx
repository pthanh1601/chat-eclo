import React, {useState} from 'react';
import {ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {RootStackParamList} from '../../navigation/RootNavigator';
import {useSession} from '../../context/SessionContext';
import {matrixErrorMessage} from '../../core/matrix/errors';
import {MATRIX_HOMESERVER} from '../../config/matrix';

type Props = NativeStackScreenProps<RootStackParamList, 'AuthLogin'>;

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

export function LoginScreen({navigation, route}: Props) {
  const isDark = useColorScheme() === 'dark';
  const colors = isDark ? theme.dark : theme.light;
  const {signIn} = useSession();
  const [username, setUsername] = useState(route.params?.username ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!username.trim() || !password) {
      setError('Vui lòng nhập tên đăng nhập và mật khẩu.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await signIn(username.trim(), password, MATRIX_HOMESERVER);
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
            <Text style={[styles.title, {color: colors.title}]}>Chào mừng bạn!</Text>
            <Text style={[styles.hint, {color: colors.text}]}>Đăng nhập tài khoản ECLO CHAT để tiếp tục.</Text>
          </View>

          <View style={styles.form}>
            {route.params?.notice ? <Text style={styles.notice}>{route.params.notice}</Text> : null}
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Tên đăng nhập"
              placeholderTextColor={colors.placeholder}
              style={[styles.input, {backgroundColor: colors.input, color: colors.inputText}]}
              value={username}
              onChangeText={setUsername}
            />

            <TextInput
              placeholder="Mật khẩu"
              placeholderTextColor={colors.placeholder}
              secureTextEntry
              style={[styles.input, {backgroundColor: colors.input, color: colors.inputText}]}
              value={password}
              onChangeText={setPassword}
            />

            <Pressable accessibilityRole="button" onPress={() => navigation.navigate('AuthForgotPassword')} style={styles.forgotButton}>
              <Text style={[styles.forgotText, {color: colors.text}]}>Quên mật khẩu?</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={submit}
              style={({pressed}) => [
                styles.primaryButton,
                (pressed && !busy) ? styles.buttonPressed : null,
              ]}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>ĐĂNG NHẬP NGAY</Text>}
            </Pressable>

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>

          <View style={styles.registerRow}>
            <Text style={[styles.registerText, {color: colors.text}]}>Chưa có tài khoản? </Text>
            <Pressable accessibilityRole="button" onPress={() => navigation.navigate('AuthRegister')} hitSlop={8}>
              <Text style={styles.registerLink}>Đăng ký</Text>
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
  forgotButton: {alignSelf: 'flex-end', paddingTop: 2, paddingBottom: 10, paddingHorizontal: 2},
  forgotText: {fontSize: 14, fontWeight: '700'},
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
  },
  primaryButtonText: {color: '#fff', fontSize: 16, fontWeight: '900'},
  buttonPressed: {opacity: 0.86},
  error: {color: '#b42318', backgroundColor: '#fff1f0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, overflow: 'hidden', fontWeight: '700'},
  notice: {color: '#067647', backgroundColor: '#ecfdf3', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, overflow: 'hidden', fontWeight: '700'},
  registerRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 28},
  registerText: {fontSize: 14, fontWeight: '600'},
  registerLink: {color: '#0b7cff', fontSize: 14, fontWeight: '900'},
  footer: {textAlign: 'center', fontSize: 13, fontWeight: '700', marginTop: 'auto', paddingTop: 56},
});
