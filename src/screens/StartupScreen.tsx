import React, {useEffect, useMemo, useRef} from 'react';
import {Animated, Easing, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from '../platform/safeArea';
import {GlassSurface} from '../components/GlassSurface';
import type {SessionBootState} from '../core/models/session';
import {useAppTheme} from '../theme/useAppTheme';

type Props = {
  boot?: SessionBootState;
};

const defaultBoot: SessionBootState = {
  stage: 'launching',
  message: 'Đang mở ECLO Chat...',
  progress: 0.1,
};

export function StartupScreen({boot = defaultBoot}: Props) {
  const colors = useAppTheme();
  const insets = useSafeAreaInsets();
  const logoScale = useRef(new Animated.Value(0.94)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const haloScale = useRef(new Animated.Value(0.78)).current;
  const haloOpacity = useRef(new Animated.Value(0.5)).current;
  const scanX = useRef(new Animated.Value(-120)).current;
  const progress = useRef(new Animated.Value(defaultBoot.progress)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  const clampedProgress = Math.max(0.08, Math.min(1, boot.progress || defaultBoot.progress));

  useEffect(() => {
    Animated.parallel([
      Animated.spring(logoScale, {
        toValue: 1,
        friction: 7,
        tension: 74,
        useNativeDriver: true,
      }),
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();

    const halo = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(haloScale, {
            toValue: 1.18,
            duration: 1150,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(haloOpacity, {
            toValue: 0.08,
            duration: 1150,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(haloScale, {
            toValue: 0.78,
            duration: 0,
            useNativeDriver: true,
          }),
          Animated.timing(haloOpacity, {
            toValue: 0.5,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      ]),
    );

    const scanner = Animated.loop(
      Animated.sequence([
        Animated.timing(scanX, {
          toValue: 260,
          duration: 1180,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(scanX, {
          toValue: -120,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    );

    const breathing = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );

    halo.start();
    scanner.start();
    breathing.start();

    return () => {
      halo.stop();
      scanner.stop();
      breathing.stop();
    };
  }, [breathe, haloOpacity, haloScale, logoOpacity, logoScale, scanX]);

  useEffect(() => {
    Animated.timing(progress, {
      toValue: clampedProgress,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [clampedProgress, progress]);

  const rows = useMemo(() => ['Minh Anh', 'Hải Nam', 'Nhóm dự án'], []);
  const activeStep = stageLabel(boot.stage);
  const pulseOpacity = breathe.interpolate({inputRange: [0, 1], outputRange: [0.56, 1]});
  const progressWidth = progress.interpolate({inputRange: [0, 1], outputRange: ['0%', '100%']});

  return (
    <View style={[styles.screen, {backgroundColor: colors.background, paddingTop: insets.top + 22, paddingBottom: Math.max(insets.bottom, 20) + 18}]}>
      <View style={styles.topArea}>
        <View style={styles.logoWrap}>
          <Animated.View style={[styles.logoHalo, {backgroundColor: colors.primary, opacity: haloOpacity, transform: [{scale: haloScale}]}]} />
          <Animated.View style={{opacity: logoOpacity, transform: [{scale: logoScale}]}}>
            <GlassSurface effect="regular" style={[styles.logoGlass, {shadowColor: colors.primary}]} fallbackColor={colors.dark ? 'rgba(23,32,51,0.78)' : 'rgba(255,255,255,0.78)'}>
              <Text style={[styles.logoWord, {color: colors.primary}]}>eclo</Text>
              <Text style={[styles.logoUrl, {color: colors.text}]}>www.eclo.chat</Text>
            </GlassSurface>
          </Animated.View>
        </View>
        <Text style={[styles.title, {color: colors.text}]}>ECLO Chat</Text>
        <Text style={[styles.subtitle, {color: colors.secondaryText}]}>Đang chuẩn bị không gian nhắn tin an toàn của bạn.</Text>
      </View>

      <GlassSurface effect="regular" style={[styles.statusGlass, {shadowColor: colors.shadow}]} fallbackColor={colors.dark ? 'rgba(23,32,51,0.72)' : 'rgba(255,255,255,0.78)'}>
        <View style={styles.statusTop}>
          <Animated.View style={[styles.statusDot, {backgroundColor: colors.primary, opacity: pulseOpacity}]} />
          <View style={styles.flex1}>
            <Text style={[styles.statusTitle, {color: colors.text}]}>{activeStep}</Text>
            <Text style={[styles.statusText, {color: colors.secondaryText}]}>{boot.message}</Text>
          </View>
          <Text style={[styles.percent, {color: colors.tertiaryText}]}>{Math.round(clampedProgress * 100)}%</Text>
        </View>
        <View style={[styles.progressTrack, {backgroundColor: colors.input}]}>
          <Animated.View style={[styles.progressFill, {backgroundColor: colors.primary, width: progressWidth}]} />
          <Animated.View style={[styles.progressScan, {transform: [{translateX: scanX}]}]} />
        </View>
      </GlassSurface>

      <View style={styles.preview}>
        <View style={styles.previewHeader}>
          <View style={[styles.previewAvatar, {backgroundColor: colors.primary}]}>
            <Text style={styles.previewAvatarText}>E</Text>
          </View>
          <View style={[styles.previewSearch, {backgroundColor: colors.input}]} />
          <View style={[styles.previewAdd, {backgroundColor: colors.primary}]} />
        </View>
        {rows.map((row, index) => (
          <View key={row} style={styles.previewRow}>
            <Animated.View style={[styles.rowAvatar, {backgroundColor: index === 0 ? colors.primary : colors.input, opacity: pulseOpacity}]} />
            <View style={[styles.rowBody, {borderBottomColor: colors.separator}]}>
              <Animated.View style={[styles.rowTitle, {backgroundColor: colors.input, opacity: pulseOpacity, width: index === 0 ? '58%' : '44%'}]} />
              <View style={[styles.rowLine, {backgroundColor: colors.input, width: index === 1 ? '72%' : '62%'}]} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function stageLabel(stage: SessionBootState['stage']) {
  switch (stage) {
    case 'loading_session':
      return 'Đang đọc phiên';
    case 'restoring':
      return 'Đang khôi phục';
    case 'crypto':
      return 'Đang bảo vệ tin nhắn';
    case 'syncing':
      return 'Đang đồng bộ';
    case 'ready':
      return 'Sẵn sàng';
    case 'launching':
    default:
      return 'Đang khởi động';
  }
}

const styles = StyleSheet.create({
  screen: {flex: 1, paddingHorizontal: 22, justifyContent: 'space-between'},
  topArea: {alignItems: 'center', paddingTop: 18},
  logoWrap: {width: 164, height: 164, alignItems: 'center', justifyContent: 'center', marginBottom: 18},
  logoHalo: {position: 'absolute', width: 152, height: 152, borderRadius: 76},
  logoGlass: {
    width: 136,
    height: 136,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: {width: 0, height: 18},
    shadowOpacity: 0.18,
    shadowRadius: 30,
    elevation: 10,
  },
  logoWord: {fontSize: 52, lineHeight: 58, fontWeight: '900'},
  logoUrl: {fontSize: 8, fontStyle: 'italic', fontWeight: '800', marginTop: -8, marginLeft: 36},
  title: {fontSize: 30, lineHeight: 36, fontWeight: '900'},
  subtitle: {maxWidth: 310, textAlign: 'center', fontSize: 15, lineHeight: 22, fontWeight: '700', marginTop: 8},
  statusGlass: {
    borderRadius: 30,
    padding: 16,
    shadowOffset: {width: 0, height: 16},
    shadowOpacity: 0.12,
    shadowRadius: 28,
    elevation: 8,
  },
  statusTop: {minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12},
  statusDot: {width: 12, height: 12, borderRadius: 6},
  statusTitle: {fontSize: 16, lineHeight: 21, fontWeight: '900'},
  statusText: {fontSize: 13, lineHeight: 19, fontWeight: '700', marginTop: 2},
  percent: {fontSize: 12, fontWeight: '900'},
  progressTrack: {height: 7, borderRadius: 4, overflow: 'hidden', marginTop: 14},
  progressFill: {height: 7, borderRadius: 4},
  progressScan: {position: 'absolute', left: 0, top: 0, width: 92, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.42)'},
  preview: {paddingTop: 22},
  previewHeader: {height: 48, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6},
  previewAvatar: {width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center'},
  previewAvatarText: {color: '#fff', fontSize: 18, fontWeight: '900'},
  previewSearch: {flex: 1, height: 46, borderRadius: 23},
  previewAdd: {width: 46, height: 46, borderRadius: 23},
  previewRow: {height: 72, flexDirection: 'row', alignItems: 'center', gap: 12},
  rowAvatar: {width: 50, height: 50, borderRadius: 25},
  rowBody: {flex: 1, height: 72, justifyContent: 'center', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth},
  rowTitle: {height: 15, borderRadius: 8},
  rowLine: {height: 12, borderRadius: 7, opacity: 0.7},
  flex1: {flex: 1, minWidth: 0},
});
