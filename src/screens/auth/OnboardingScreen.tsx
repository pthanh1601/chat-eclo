import React, {useEffect, useRef, useState} from 'react';
import {Pressable, SafeAreaView, ScrollView, StyleSheet, Text, useColorScheme, useWindowDimensions, View} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {RootStackParamList} from '../../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'AuthWelcome'>;

const slides = [
  {
    key: 'secure',
    label: '01',
    title: 'Trò chuyện riêng tư',
    body: 'Tin nhắn của bạn được bảo vệ trong các cuộc trò chuyện cá nhân và nhóm.',
  },
  {
    key: 'rooms',
    label: '02',
    title: 'Tin nhắn gọn gàng',
    body: 'Theo dõi các cuộc trò chuyện cá nhân, nhóm và tin nhắn cũ ở cùng một nơi.',
  },
  {
    key: 'recovery',
    label: '03',
    title: 'Khôi phục an toàn',
    body: 'Dùng Mã khôi phục để mở lại tin nhắn cũ khi đổi sang thiết bị mới.',
  },
];

const theme = {
  light: {
    background: '#fff',
    card: '#f8fbff',
    cardBorder: '#dbeafe',
    title: '#050505',
    text: '#64748b',
    muted: '#6b7280',
    line: '#bfdbfe',
    lineSoft: '#dbeafe',
    dot: '#bfdbfe',
  },
  dark: {
    background: '#0b1020',
    card: '#111827',
    cardBorder: '#263a5e',
    title: '#f8fafc',
    text: '#cbd5e1',
    muted: '#94a3b8',
    line: '#1e60a8',
    lineSoft: '#1f3150',
    dot: '#1f3150',
  },
};

export function OnboardingScreen({navigation}: Props) {
  const {width} = useWindowDimensions();
  const isDark = useColorScheme() === 'dark';
  const colors = isDark ? theme.dark : theme.light;
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const isLast = index === slides.length - 1;

  useEffect(() => {
    const resetTimer = setTimeout(() => {
      scrollRef.current?.scrollTo({x: 0, animated: false});
      setIndex(0);
    }, 0);

    return () => clearTimeout(resetTimer);
  }, [width]);

  function goLogin() {
    navigation.replace('AuthLogin');
  }

  function next() {
    if (isLast) {
      goLogin();
      return;
    }
    scrollRef.current?.scrollTo({x: width * (index + 1), animated: true});
  }

  return (
    <SafeAreaView style={[styles.screen, {backgroundColor: colors.background}]}>
      <View style={styles.topBar}>
        <Text style={styles.brand}>ECLO Chat</Text>
        <Pressable accessibilityRole="button" onPress={goLogin} hitSlop={10}>
          <Text style={[styles.skip, {color: colors.muted}]}>Bỏ qua</Text>
        </Pressable>
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={event => setIndex(Math.round(event.nativeEvent.contentOffset.x / width))}>
        {slides.map(item => (
          <View key={item.key} style={[styles.slide, {width}]}>
            <View style={[styles.visual, {backgroundColor: colors.card, borderColor: colors.cardBorder}]}>
              <Text style={styles.visualText}>{item.label}</Text>
              <View style={[styles.messageLine, {backgroundColor: colors.line}]} />
              <View style={[styles.messageLine, styles.messageLineShort, {backgroundColor: colors.lineSoft}]} />
              <View style={styles.lockBadge}>
                <Text style={styles.lockText}>Bảo mật</Text>
              </View>
            </View>
            <Text style={[styles.title, {color: colors.title}]}>{item.title}</Text>
            <Text style={[styles.body, {color: colors.text}]}>{item.body}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {slides.map((slide, dotIndex) => (
            <View key={slide.key} style={[styles.dot, {backgroundColor: colors.dot}, dotIndex === index ? styles.dotActive : null]} />
          ))}
        </View>
        <Pressable accessibilityRole="button" onPress={next} style={({pressed}) => [styles.button, pressed ? styles.buttonPressed : null]}>
          <Text style={styles.buttonText}>{isLast ? 'Bắt đầu' : 'Tiếp tục'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1},
  topBar: {height: 60, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  brand: {color: '#0b7cff', fontSize: 18, fontWeight: '900'},
  skip: {fontSize: 15, fontWeight: '700'},
  slide: {flex: 1, justifyContent: 'center', paddingHorizontal: 28, paddingBottom: 24},
  visual: {height: 250, borderRadius: 8, borderWidth: 1, padding: 24, justifyContent: 'center', marginBottom: 38},
  visualText: {color: '#0b7cff', fontSize: 54, fontWeight: '900'},
  messageLine: {height: 16, borderRadius: 8, marginTop: 18, width: '82%'},
  messageLineShort: {width: '58%'},
  lockBadge: {position: 'absolute', right: 22, bottom: 22, borderRadius: 8, backgroundColor: '#0f172a', paddingHorizontal: 14, paddingVertical: 9},
  lockText: {color: '#fff', fontWeight: '900'},
  title: {fontSize: 34, fontWeight: '900', lineHeight: 40},
  body: {fontSize: 17, lineHeight: 25, marginTop: 14},
  footer: {paddingHorizontal: 22, paddingBottom: 24, gap: 18},
  dots: {flexDirection: 'row', gap: 8, alignSelf: 'center'},
  dot: {width: 8, height: 8, borderRadius: 4},
  dotActive: {width: 24, backgroundColor: '#0b7cff'},
  button: {height: 54, borderRadius: 8, backgroundColor: '#0b7cff', alignItems: 'center', justifyContent: 'center'},
  buttonPressed: {opacity: 0.86},
  buttonText: {color: '#fff', fontSize: 16, fontWeight: '900'},
});
