import React, {useEffect, useState} from 'react';
import {ActivityIndicator, Modal, Pressable, StyleSheet, Text, View} from 'react-native';
import {nativeMatrixService} from '../core/matrix/NativeMatrixService';
import type {SecurityVerification} from '../core/models/session';
import {matrixErrorMessage} from '../core/matrix/errors';
import {useAppTheme} from '../theme/useAppTheme';

export function SecurityVerificationOverlay() {
  const colors = useAppTheme();
  const [verification, setVerification] = useState<SecurityVerification>({phase: 'idle'});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setVerification({...nativeMatrixService.getSecurityVerification()});
    return nativeMatrixService.subscribeSecurity(() => {
      setVerification({...nativeMatrixService.getSecurityVerification()});
    });
  }, []);

  const visible = verification.phase !== 'idle';
  const compareReady = Boolean(verification.emojis?.length || verification.decimals?.length);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(matrixErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function closeTerminal() {
    nativeMatrixService.dismissSecurityVerification();
    setVerification({phase: 'idle'});
    setError(null);
  }

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={() => {
      if (['done', 'cancelled', 'failed'].includes(verification.phase)) {
        closeTerminal();
      } else {
        run(() => nativeMatrixService.cancelDeviceVerification()).catch(() => undefined);
      }
    }}>
      <View style={styles.backdrop}>
        <View style={[styles.card, {backgroundColor: colors.surface, shadowColor: colors.shadow}]}>
          <View style={[styles.icon, {backgroundColor: verification.phase === 'done' ? colors.successSoft : colors.input}]}>
            <Text style={[styles.iconText, {color: verification.phase === 'done' ? colors.success : colors.primary}]}>♢</Text>
          </View>

          {verification.phase === 'incoming' ? (
            <>
              <Text style={[styles.title, {color: colors.text}]}>Yêu cầu xác thực thiết bị</Text>
              <Text style={[styles.body, {color: colors.secondaryText}]}>{verification.deviceName || 'Thiết bị khác'} muốn xác thực.</Text>
              <View style={styles.actions}>
                <ActionButton row label="Từ chối" color={colors.dangerSoft} textColor={colors.danger} disabled={busy} onPress={() => run(() => nativeMatrixService.cancelDeviceVerification())} />
                <ActionButton row label="Chấp nhận" color={colors.primary} textColor="#fff" disabled={busy} onPress={() => run(() => nativeMatrixService.acceptDeviceVerification())} />
              </View>
            </>
          ) : verification.phase === 'requested' ? (
            <>
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.title, {color: colors.text}]}>Đang chờ thiết bị khác</Text>
              <Text style={[styles.body, {color: colors.secondaryText}]}>Chấp nhận yêu cầu trên thiết bị khác.</Text>
              <ActionButton label="Hủy yêu cầu" color={colors.dangerSoft} textColor={colors.danger} disabled={busy} onPress={() => run(() => nativeMatrixService.cancelDeviceVerification())} />
            </>
          ) : verification.phase === 'confirmed' ? (
            <>
              <ActivityIndicator color={colors.success} />
              <Text style={[styles.title, {color: colors.text}]}>Đã xác nhận trên thiết bị này</Text>
              <Text style={[styles.body, {color: colors.secondaryText}]}>Đang chờ thiết bị khác hoàn tất.</Text>
            </>
          ) : compareReady ? (
            <>
              <Text style={[styles.title, {color: colors.text}]}>So khớp emoji</Text>
              <Text style={[styles.body, {color: colors.secondaryText}]}>Đối chiếu với thiết bị còn lại.</Text>
              {verification.emojis?.length ? (
                <View style={styles.emojiGrid}>
                  {verification.emojis.map((item, index) => (
                    <View key={`${item.symbol}-${index}`} style={[styles.emojiItem, {backgroundColor: colors.input}]}>
                      <Text style={styles.emoji}>{item.symbol}</Text>
                      <Text numberOfLines={1} style={[styles.emojiLabel, {color: colors.secondaryText}]}>{item.description}</Text>
                    </View>
                  ))}
                </View>
              ) : <Text style={[styles.decimals, {color: colors.text}]}>{verification.decimals?.join('  ·  ')}</Text>}
              <View style={styles.actions}>
                <ActionButton row label="Không khớp" color={colors.dangerSoft} textColor={colors.danger} disabled={busy} onPress={() => run(() => nativeMatrixService.declineSasVerification())} />
                <ActionButton row label="Chính xác" color={colors.success} textColor="#fff" disabled={busy} onPress={() => run(() => nativeMatrixService.approveSasVerification())} />
              </View>
            </>
          ) : verification.phase === 'done' ? (
            <>
              <Text style={[styles.title, {color: colors.success}]}>Xác thực hoàn tất</Text>
              <Text style={[styles.body, {color: colors.secondaryText}]}>Thiết bị đã được xác thực.</Text>
              <ActionButton label="Đóng" color={colors.primary} textColor="#fff" disabled={false} onPress={closeTerminal} />
            </>
          ) : verification.phase === 'cancelled' || verification.phase === 'failed' ? (
            <>
              <Text style={[styles.title, {color: colors.danger}]}>{verification.phase === 'failed' ? 'Xác thực thất bại' : 'Đã hủy xác thực'}</Text>
              <Text style={[styles.body, {color: colors.secondaryText}]}>{error || 'Bạn có thể gửi lại yêu cầu từ mục Bảo mật.'}</Text>
              <ActionButton label="Đóng" color={colors.input} textColor={colors.text} disabled={false} onPress={closeTerminal} />
            </>
          ) : (
            <>
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.title, {color: colors.text}]}>Đang tạo mã so khớp</Text>
              <Text style={[styles.body, {color: colors.secondaryText}]}>Đang chuẩn bị emoji...</Text>
              {verification.phase === 'accepted' ? <ActionButton label="Tiếp tục" color={colors.primary} textColor="#fff" disabled={busy} onPress={() => run(() => nativeMatrixService.startSasVerification())} /> : null}
            </>
          )}
          {error && verification.phase !== 'failed' ? <Text style={[styles.error, {backgroundColor: colors.dangerSoft, color: colors.danger}]}>{error}</Text> : null}
        </View>
      </View>
    </Modal>
  );
}

function ActionButton({color, disabled, label, onPress, row = false, textColor}: {color: string; disabled: boolean; label: string; onPress: () => void; row?: boolean; textColor: string}) {
  return (
    <Pressable accessibilityRole="button" hitSlop={6} disabled={disabled} onPress={onPress} style={({pressed}) => [styles.button, row ? styles.rowButton : styles.fullButton, {backgroundColor: color, borderColor: textColor, opacity: disabled ? 0.55 : 1}, pressed ? styles.pressed : null]}>
      <Text style={[styles.buttonText, {color: textColor}]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {flex: 1, backgroundColor: 'rgba(5, 10, 20, 0.62)', alignItems: 'center', justifyContent: 'center', padding: 22},
  card: {width: '100%', maxWidth: 420, borderRadius: 26, padding: 22, alignItems: 'center', gap: 14, shadowOffset: {width: 0, height: 18}, shadowOpacity: 0.24, shadowRadius: 30, elevation: 20},
  icon: {width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center'},
  iconText: {fontSize: 28, fontWeight: '900'},
  title: {fontSize: 21, lineHeight: 27, fontWeight: '900', textAlign: 'center'},
  body: {fontSize: 14, lineHeight: 21, fontWeight: '600', textAlign: 'center'},
  actions: {width: '100%', flexDirection: 'row', gap: 10},
  button: {minHeight: 48, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, shadowColor: '#000', shadowOffset: {width: 0, height: 3}, shadowOpacity: 0.2, shadowRadius: 5, elevation: 4},
  rowButton: {flex: 1},
  fullButton: {width: '100%'},
  buttonText: {fontSize: 15, fontWeight: '900'},
  emojiGrid: {flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 8},
  emojiItem: {width: 64, borderRadius: 14, paddingVertical: 8, alignItems: 'center'},
  emoji: {fontSize: 30},
  emojiLabel: {fontSize: 9, lineHeight: 12, fontWeight: '700', marginTop: 3, paddingHorizontal: 3, textAlign: 'center'},
  decimals: {fontSize: 23, lineHeight: 32, fontWeight: '900', letterSpacing: 1, textAlign: 'center'},
  error: {overflow: 'hidden', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, fontSize: 12, lineHeight: 17, fontWeight: '700', textAlign: 'center'},
  pressed: {opacity: 0.9, transform: [{translateY: 2}, {scale: 0.985}], shadowOpacity: 0.06, elevation: 1},
});
