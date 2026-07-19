import React, {useEffect, useState} from 'react';
import {ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {Image as ImageIcon, Search} from 'lucide-react-native';
import {searchKlipy, type KlipyItem, type KlipyMediaType} from '../core/media/KlipyService';
import {useAppTheme} from '../theme/useAppTheme';

type Props = {
  onEmoji: (emoji: string) => void;
  onSelect: (item: KlipyItem, type: KlipyMediaType) => void;
};

export function KlipyPicker({onEmoji, onSelect}: Props) {
  const colors = useAppTheme();
  const [tab, setTab] = useState<'emoji' | KlipyMediaType>('emoji');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<KlipyItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (tab === 'emoji') {
      setItems([]);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      searchKlipy(query, tab)
        .then(results => {
          if (!cancelled) setItems(results);
        })
        .catch(err => {
          if (!cancelled) setError(err instanceof Error ? err.message : 'Không tải được nội dung KLIPY.');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, query.trim() ? 320 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, tab]);

  return (
    <View style={styles.wrap}>
      <View style={[styles.tabs, {backgroundColor: colors.input}]}>
        <Tab label="Emoji" active={tab === 'emoji'} onPress={() => setTab('emoji')} />
        <Tab label="GIF" active={tab === 'gif'} onPress={() => setTab('gif')} />
        <Tab label="Sticker" active={tab === 'sticker'} onPress={() => setTab('sticker')} />
      </View>

      {tab === 'emoji' ? (
        <View style={styles.emojiGrid}>
          {['😀', '😂', '😍', '🥰', '😎', '👍', '❤️', '🎉', '👏', '🙏', '🔥', '✅'].map(emoji => (
            <Pressable key={emoji} accessibilityRole="button" accessibilityLabel={`Emoji ${emoji}`} onPress={() => onEmoji(emoji)} style={({pressed}) => [styles.emojiButton, pressed ? styles.pressed : null]}>
              <Text style={styles.emojiText}>{emoji}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <>
          <View style={[styles.searchBox, {backgroundColor: colors.input}]}>
            <Search size={17} color={colors.tertiaryText} strokeWidth={2.4} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={tab === 'sticker' ? 'Tìm sticker KLIPY' : 'Tìm GIF KLIPY'}
              placeholderTextColor={colors.tertiaryText}
              style={[styles.searchInput, {color: colors.text}]}
            />
          </View>
          {loading ? <ActivityIndicator style={styles.loader} color={colors.primary} /> : null}
          {error ? <Text style={[styles.error, {color: colors.danger}]}>{error}</Text> : null}
          {!loading && !error && !items.length ? (
            <View style={styles.empty}>
              <ImageIcon size={22} color={colors.tertiaryText} />
              <Text style={[styles.emptyText, {color: colors.secondaryText}]}>Không có kết quả.</Text>
            </View>
          ) : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.mediaList}>
            {items.map(item => (
              <Pressable key={item.id} accessibilityRole="imagebutton" accessibilityLabel={item.title} onPress={() => onSelect(item, tab)} style={({pressed}) => [styles.mediaTile, {backgroundColor: colors.input}, pressed ? styles.pressed : null]}>
                <Image source={{uri: item.preview}} style={styles.mediaImage} resizeMode="cover" />
              </Pressable>
            ))}
          </ScrollView>
          <Text style={[styles.attribution, {color: colors.tertiaryText}]}>Powered by KLIPY</Text>
        </>
      )}
    </View>
  );
}

function Tab({active, label, onPress}: {active: boolean; label: string; onPress: () => void}) {
  const colors = useAppTheme();
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{selected: active}} onPress={onPress} style={[styles.tab, active ? {backgroundColor: colors.primary} : null]}>
      <Text style={[styles.tabText, {color: active ? '#fff' : colors.secondaryText}]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {gap: 9},
  tabs: {height: 38, borderRadius: 13, padding: 3, flexDirection: 'row'},
  tab: {flex: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center'},
  tabText: {fontSize: 12, lineHeight: 16, fontWeight: '900'},
  emojiGrid: {flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between'},
  emojiButton: {width: '16.66%', height: 42, alignItems: 'center', justifyContent: 'center'},
  emojiText: {fontSize: 25},
  searchBox: {height: 40, borderRadius: 13, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 7},
  searchInput: {flex: 1, height: 40, paddingVertical: 0, fontSize: 14, fontWeight: '700'},
  loader: {height: 88},
  mediaList: {gap: 7, minHeight: 94},
  mediaTile: {width: 94, height: 94, borderRadius: 13, overflow: 'hidden'},
  mediaImage: {width: '100%', height: '100%'},
  error: {fontSize: 12, lineHeight: 16, fontWeight: '700', paddingVertical: 12, textAlign: 'center'},
  empty: {height: 72, alignItems: 'center', justifyContent: 'center', gap: 5},
  emptyText: {fontSize: 12, fontWeight: '700'},
  attribution: {fontSize: 10, lineHeight: 13, fontWeight: '700', textAlign: 'right'},
  pressed: {opacity: 0.7, transform: [{scale: 0.97}]},
});
