import React, {useEffect, useMemo, useState} from 'react';
import {ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle} from 'react-native';
import Video from 'react-native-video';
import {Maximize2, Play} from 'lucide-react-native';
import {
  isEncryptedMatrixMediaSource,
  resolveMatrixMediaUri,
  type MatrixMediaDescriptor,
} from '../core/matrix/MediaDecryptor';

type Props = {
  item: MatrixMediaDescriptor;
  style: StyleProp<ViewStyle>;
  backgroundColor: string;
  indicatorColor: string;
  textColor: string;
  compact?: boolean;
  autoPlay?: boolean;
  resizeMode?: 'contain' | 'cover' | 'stretch' | 'none';
  onExpand?: () => void;
};

export function MatrixMediaVideo({
  item,
  style,
  backgroundColor,
  indicatorColor,
  textColor,
  compact = false,
  autoPlay = false,
  resizeMode = 'cover',
  onExpand,
}: Props) {
  const [resolvedUri, setResolvedUri] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [paused, setPaused] = useState(!autoPlay);
  const authorization = item.mediaHeaders?.Authorization;
  const descriptor = useMemo<MatrixMediaDescriptor>(() => ({
    mediaUrl: item.mediaUrl,
    mediaHeaders: authorization ? {Authorization: authorization} : undefined,
    mediaSourceJson: item.mediaSourceJson,
    mediaFileName: item.mediaFileName,
    mediaMimeType: item.mediaMimeType,
  }), [authorization, item.mediaFileName, item.mediaMimeType, item.mediaSourceJson, item.mediaUrl]);
  const sourceKey = useMemo(() => [
    descriptor.mediaUrl ?? '',
    descriptor.mediaSourceJson ?? '',
    descriptor.mediaFileName ?? '',
    descriptor.mediaMimeType ?? '',
    descriptor.mediaHeaders?.Authorization ?? '',
  ].join('|'), [descriptor]);
  const encrypted = isEncryptedMatrixMediaSource(descriptor.mediaSourceJson);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setFailed(false);
    setResolvedUri(undefined);
    setPaused(!autoPlay);
    resolveMatrixMediaUri(descriptor)
      .then(uri => {
        if (!mounted) return;
        setResolvedUri(uri);
        setLoading(false);
      })
      .catch(error => {
        if (!mounted) return;
        setLoading(false);
        setFailed(true);
        console.warn(`[ECLO media video] ${descriptor.mediaFileName ?? 'video'}: ${errorMessage(error)}`);
      });
    return () => {
      mounted = false;
    };
  }, [autoPlay, descriptor, sourceKey]);

  const remoteHeaders = resolvedUri && /^https?:\/\//i.test(resolvedUri) ? item.mediaHeaders : undefined;
  return (
    <View style={[styles.container, style, {backgroundColor}]}>
      {resolvedUri && !failed ? (
        <Video
          source={{uri: resolvedUri, headers: remoteHeaders}}
          style={StyleSheet.absoluteFill}
          resizeMode={resizeMode}
          paused={paused}
          controls={!compact && !paused}
          playInBackground={false}
          playWhenInactive={false}
          ignoreSilentSwitch="ignore"
          onLoad={() => setLoading(false)}
          onEnd={() => setPaused(true)}
          onError={error => {
            setLoading(false);
            setFailed(true);
            console.warn(`[ECLO media video] ${descriptor.mediaFileName ?? 'video'}: ${errorMessage(error)}`);
          }}
        />
      ) : null}
      {loading ? (
        <View style={styles.centerOverlay}>
          <ActivityIndicator color={indicatorColor} />
          {!compact ? <Text style={[styles.label, {color: textColor}]}>{encrypted ? 'Đang giải mã video…' : 'Đang tải video…'}</Text> : null}
        </View>
      ) : null}
      {!loading && failed ? (
        <View style={styles.centerOverlay}>
          <Text style={[styles.label, {color: textColor}]}>{encrypted ? 'Không giải mã được video' : 'Không tải được video'}</Text>
        </View>
      ) : null}
      {!loading && !failed && paused ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Phát video" onPress={() => compact && onExpand ? onExpand() : setPaused(false)} style={({pressed}) => [styles.playButton, pressed ? styles.pressed : null]}>
          <Play size={compact ? 24 : 32} color="#fff" fill="#fff" />
        </Pressable>
      ) : null}
      {!compact && onExpand ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Xem video toàn màn hình" onPress={onExpand} style={({pressed}) => [styles.expandButton, pressed ? styles.pressed : null]}>
          <Maximize2 size={19} color="#fff" strokeWidth={2.5} />
        </Pressable>
      ) : null}
    </View>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const styles = StyleSheet.create({
  container: {overflow: 'hidden', alignItems: 'center', justifyContent: 'center'},
  centerOverlay: {position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', gap: 7},
  label: {fontSize: 12, fontWeight: '700', paddingHorizontal: 10, textAlign: 'center'},
  playButton: {width: 58, height: 58, borderRadius: 29, backgroundColor: 'rgba(0,0,0,0.58)', alignItems: 'center', justifyContent: 'center', paddingLeft: 3},
  expandButton: {position: 'absolute', right: 8, top: 8, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.58)', alignItems: 'center', justifyContent: 'center'},
  pressed: {opacity: 0.72, transform: [{scale: 0.96}]},
});
