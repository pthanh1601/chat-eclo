import React, {useCallback, useEffect, useRef, useState} from 'react';
import {AppState, Linking, PermissionsAndroid, Platform, Pressable, StyleSheet, Text, TurboModuleRegistry, View} from 'react-native';
import type {TurboModule} from 'react-native';
import {Camera, CameraType} from 'react-native-camera-kit';
import {useAppTheme} from '../theme/useAppTheme';

type CameraPermissionApi = TurboModule & {
  checkDeviceCameraAuthorizationStatus: () => Promise<boolean | number>;
  requestDeviceCameraAuthorization: () => Promise<boolean>;
};

const nativeCameraPermission = TurboModuleRegistry.get<CameraPermissionApi>('RNCameraKitModule');

export function QrScanner({onScanned}: {onScanned: (value: string) => boolean | void}) {
  const colors = useAppTheme();
  const [permission, setPermission] = useState<'checking' | 'granted' | 'denied'>('checking');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const scanLocked = useRef(false);

  const refreshPermission = useCallback(() => {
    let active = true;
    setPermission('checking');
    requestCameraPermission().then(granted => {
      if (active) {
        setPermission(granted ? 'granted' : 'denied');
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const cancelRequest = refreshPermission();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        refreshPermission();
      }
    });
    return () => {
      cancelRequest();
      subscription.remove();
    };
  }, [refreshPermission]);

  if (permission !== 'granted') {
    return (
      <View style={[styles.permissionCard, {backgroundColor: colors.input}]}>
        <Text style={[styles.permissionTitle, {color: colors.text}]}>
          {permission === 'checking' ? 'Đang mở camera...' : 'Cần quyền sử dụng camera'}
        </Text>
        <Text style={[styles.permissionText, {color: colors.secondaryText}]}>
          {permission === 'checking'
            ? 'Vui lòng chờ trong giây lát.'
            : 'Cho phép ECLO Chat dùng camera để quét mã QR.'}
        </Text>
        {permission === 'denied' ? (
          <View style={styles.permissionActions}>
            <Pressable accessibilityRole="button" onPress={refreshPermission} style={[styles.settingsButton, {backgroundColor: colors.input, borderColor: colors.separator}]}>
              <Text style={[styles.settingsButtonText, {color: colors.text}]}>Thử lại</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => Linking.openSettings()} style={[styles.settingsButton, {backgroundColor: colors.primary, borderColor: colors.primary}]}>
              <Text style={styles.settingsButtonText}>Mở cài đặt</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.scannerFrame}>
      <Camera
        style={StyleSheet.absoluteFill}
        cameraType={CameraType.Back}
        scanBarcode
        allowedBarcodeTypes={['qr']}
        scanThrottleDelay={800}
        showFrame
        frameColor={colors.primary}
        laserColor={colors.primary}
        onError={event => setCameraError(event.nativeEvent.errorMessage)}
        onReadCode={event => {
          if (scanLocked.current) {
            return;
          }
          const value = event.nativeEvent.codeStringValue?.trim();
          if (!value) {
            return;
          }
          scanLocked.current = true;
          const accepted = onScanned(value);
          if (accepted === false) {
            setTimeout(() => {
              scanLocked.current = false;
            }, 1200);
          }
        }}
      />
      <View pointerEvents="none" style={styles.hintPill}>
        <Text style={styles.hintText}>Đưa mã QR vào giữa khung</Text>
      </View>
      {cameraError ? (
        <View style={styles.cameraError}>
          <Text style={styles.cameraErrorText}>{cameraError}</Text>
        </View>
      ) : null}
    </View>
  );
}

async function requestCameraPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA, {
      title: 'Cho phép quét QR',
      message: 'ECLO Chat cần camera để quét mã QR người dùng và phòng.',
      buttonPositive: 'Cho phép',
      buttonNegative: 'Không cho phép',
    });
    return result === PermissionsAndroid.RESULTS.GRANTED;
  }
  if (!nativeCameraPermission) {
    return false;
  }
  const granted = await nativeCameraPermission.checkDeviceCameraAuthorizationStatus().catch(() => false);
  if (granted === true) {
    return true;
  }
  if (granted === -1) {
    return nativeCameraPermission.requestDeviceCameraAuthorization().catch(() => false);
  }
  return false;
}

const styles = StyleSheet.create({
  scannerFrame: {height: 390, borderRadius: 24, overflow: 'hidden', backgroundColor: '#050b12'},
  hintPill: {position: 'absolute', left: 34, right: 34, bottom: 20, alignItems: 'center'},
  hintText: {backgroundColor: 'rgba(5,11,18,0.78)', color: '#fff', borderRadius: 18, overflow: 'hidden', paddingHorizontal: 16, paddingVertical: 9, fontSize: 13, fontWeight: '800'},
  cameraError: {position: 'absolute', left: 14, right: 14, top: 14, borderRadius: 12, padding: 10, backgroundColor: 'rgba(190,35,45,0.88)'},
  cameraErrorText: {color: '#fff', fontSize: 13, fontWeight: '700'},
  permissionCard: {minHeight: 240, borderRadius: 24, padding: 24, alignItems: 'center', justifyContent: 'center'},
  permissionTitle: {fontSize: 18, fontWeight: '900', textAlign: 'center'},
  permissionText: {fontSize: 14, lineHeight: 21, fontWeight: '600', textAlign: 'center', marginTop: 8},
  permissionActions: {flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18},
  settingsButton: {height: 44, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center'},
  settingsButtonText: {color: '#fff', fontSize: 14, fontWeight: '900'},
});
