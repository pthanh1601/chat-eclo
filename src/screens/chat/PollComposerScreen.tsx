import React, {useMemo, useState} from 'react';
import {ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {BarChart3, Plus, Trash2} from 'lucide-react-native';
import {GlassSurface} from '../../components/GlassSurface';
import {useSession} from '../../context/SessionContext';
import {matrixClientService} from '../../core/matrix/MatrixClientService';
import {MessageService} from '../../core/matrix/MessageService';
import {nativeMatrixService} from '../../core/matrix/NativeMatrixService';
import {matrixErrorMessage} from '../../core/matrix/errors';
import type {RootStackParamList} from '../../navigation/RootNavigator';
import {useSafeAreaInsets} from '../../platform/safeArea';
import {useAppTheme} from '../../theme/useAppTheme';

type Props = NativeStackScreenProps<RootStackParamList, 'PollComposer'>;

export function PollComposerScreen({navigation, route}: Props) {
  const colors = useAppTheme();
  const insets = useSafeAreaInsets();
  const {state} = useSession();
  const [question, setQuestion] = useState('');
  const [answers, setAnswers] = useState(['', '']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cleanAnswers = useMemo(() => answers.map(answer => answer.trim()).filter(Boolean), [answers]);
  const canSubmit = question.trim().length > 0 && cleanAnswers.length >= 2 && !busy;

  function updateAnswer(index: number, value: string) {
    setAnswers(current => current.map((answer, answerIndex) => answerIndex === index ? value : answer));
  }

  function removeAnswer(index: number) {
    setAnswers(current => current.length <= 2 ? current : current.filter((_, answerIndex) => answerIndex !== index));
  }

  async function submit() {
    if (!canSubmit || state.status !== 'signed_in') {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (nativeMatrixService.isActive()) {
        await nativeMatrixService.sendPoll(route.params.roomId, question.trim(), cleanAnswers.slice(0, 8));
      } else {
        await new MessageService(matrixClientService.currentClient).sendPoll(route.params.roomId, question.trim(), cleanAnswers.slice(0, 8));
      }
      navigation.goBack();
    } catch (err) {
      setError(matrixErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={[styles.screen, {backgroundColor: colors.background}]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, {paddingTop: insets.top + 72, paddingBottom: insets.bottom + 32}]}>
        <View style={[styles.heroIcon, {backgroundColor: colors.primary}]}>
          <BarChart3 size={28} color="#fff" strokeWidth={2.4} />
        </View>
        <Text style={[styles.title, {color: colors.text}]}>Tạo bình chọn</Text>
        <Text style={[styles.subtitle, {color: colors.secondaryText}]}>Các thành viên trong phòng có thể xem và tham gia bình chọn.</Text>

        {error ? <Text style={[styles.error, {backgroundColor: colors.dangerSoft, color: colors.danger}]}>{error}</Text> : null}

        <GlassSurface style={styles.card}>
          <Text style={[styles.label, {color: colors.tertiaryText}]}>CÂU HỎI</Text>
          <TextInput
            autoFocus
            multiline
            maxLength={240}
            value={question}
            onChangeText={setQuestion}
            placeholder="Bạn muốn hỏi điều gì?"
            placeholderTextColor={colors.tertiaryText}
            style={[styles.questionInput, {color: colors.text, backgroundColor: colors.input}]}
          />

          <Text style={[styles.label, {color: colors.tertiaryText}]}>LỰA CHỌN</Text>
          <View style={styles.answers}>
            {answers.map((answer, index) => (
              <View key={`answer-${index}`} style={styles.answerRow}>
                <View style={[styles.answerNumber, {backgroundColor: colors.primary}]}>
                  <Text style={styles.answerNumberText}>{index + 1}</Text>
                </View>
                <TextInput
                  maxLength={160}
                  value={answer}
                  onChangeText={value => updateAnswer(index, value)}
                  placeholder={`Lựa chọn ${index + 1}`}
                  placeholderTextColor={colors.tertiaryText}
                  style={[styles.answerInput, {color: colors.text, backgroundColor: colors.input}]}
                />
                {answers.length > 2 ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Xóa lựa chọn ${index + 1}`} onPress={() => removeAnswer(index)} style={({pressed}) => [styles.removeButton, pressed ? styles.pressed : null]}>
                    <Trash2 size={18} color={colors.danger} strokeWidth={2.3} />
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>

          {answers.length < 8 ? (
            <Pressable accessibilityRole="button" onPress={() => setAnswers(current => [...current, ''])} style={({pressed}) => [styles.addButton, {backgroundColor: colors.input}, pressed ? styles.pressed : null]}>
              <Plus size={19} color={colors.primary} strokeWidth={2.5} />
              <Text style={[styles.addText, {color: colors.primary}]}>Thêm lựa chọn</Text>
            </Pressable>
          ) : null}
        </GlassSurface>

        <Pressable accessibilityRole="button" disabled={!canSubmit} onPress={submit} style={({pressed}) => [styles.submitButton, {backgroundColor: colors.primary}, !canSubmit ? styles.disabled : null, pressed && canSubmit ? styles.pressed : null]}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Gửi bình chọn</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1},
  content: {paddingHorizontal: 18, gap: 12},
  heroIcon: {width: 54, height: 54, borderRadius: 18, alignSelf: 'center', alignItems: 'center', justifyContent: 'center'},
  title: {fontSize: 24, lineHeight: 30, fontWeight: '900', textAlign: 'center'},
  subtitle: {fontSize: 14, lineHeight: 20, fontWeight: '600', textAlign: 'center', paddingHorizontal: 16, marginBottom: 6},
  error: {borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, fontWeight: '700'},
  card: {borderRadius: 24, padding: 14, gap: 10, overflow: 'hidden'},
  label: {fontSize: 11, lineHeight: 15, fontWeight: '900', marginTop: 2},
  questionInput: {minHeight: 92, borderRadius: 16, paddingHorizontal: 13, paddingVertical: 12, fontSize: 17, lineHeight: 23, fontWeight: '700', textAlignVertical: 'top'},
  answers: {gap: 9},
  answerRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  answerNumber: {width: 27, height: 27, borderRadius: 14, alignItems: 'center', justifyContent: 'center'},
  answerNumberText: {color: '#fff', fontSize: 12, lineHeight: 15, fontWeight: '900'},
  answerInput: {flex: 1, height: 48, borderRadius: 15, paddingHorizontal: 13, fontSize: 15, fontWeight: '700'},
  removeButton: {width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center'},
  addButton: {height: 46, borderRadius: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 2},
  addText: {fontSize: 14, fontWeight: '900'},
  submitButton: {height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginTop: 4},
  submitText: {color: '#fff', fontSize: 16, lineHeight: 21, fontWeight: '900'},
  disabled: {opacity: 0.42},
  pressed: {opacity: 0.72, transform: [{scale: 0.985}]},
});
