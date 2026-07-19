import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  View,
  type ImageResizeMode,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {
  isEncryptedMatrixMediaSource,
  resolveMatrixMediaUri,
  type MatrixMediaDescriptor,
} from '../core/matrix/MediaDecryptor';

type Props = {
  item: MatrixMediaDescriptor;
  style: StyleProp<ImageStyle>;
  resizeMode?: ImageResizeMode;
  preserveAspectRatio?: boolean;
  backgroundColor: string;
  indicatorColor: string;
  textColor: string;
  showLabel?: boolean;
};

export function MatrixMediaImage({
  item,
  style,
  resizeMode = 'cover',
  preserveAspectRatio = false,
  backgroundColor,
  indicatorColor,
  textColor,
  showLabel = true,
}: Props) {
  const [resolvedUri, setResolvedUri] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [intrinsicAspectRatio, setIntrinsicAspectRatio] = useState<number>();
  const [attempt, setAttempt] = useState(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
    setAttempt(0);
    setIntrinsicAspectRatio(undefined);
  }, [sourceKey]);

  useEffect(() => {
    if (!preserveAspectRatio || !resolvedUri) {
      return;
    }
    let mounted = true;
    const success = (width: number, height: number) => {
      if (mounted && width > 0 && height > 0) {
        setIntrinsicAspectRatio(width / height);
      }
    };
    const failure = () => undefined;
    if (/^https?:\/\//i.test(resolvedUri) && item.mediaHeaders && typeof (Image as any).getSizeWithHeaders === 'function') {
      (Image as any).getSizeWithHeaders(resolvedUri, item.mediaHeaders, success, failure);
    } else {
      Image.getSize(resolvedUri, success, failure);
    }
    return () => {
      mounted = false;
    };
  }, [item.mediaHeaders, preserveAspectRatio, resolvedUri]);

  useEffect(() => {
    let mounted = true;
    clearTimeout(retryTimer.current);
    setLoading(true);
    setFailed(false);
    setResolvedUri(undefined);

    resolveMatrixMediaUri(descriptor)
      .then(uri => {
        if (!mounted) return;
        setResolvedUri(uri);
        setLoading(false);
      })
      .catch(error => {
        if (!mounted) return;
        if (attempt < 1) {
          retryTimer.current = setTimeout(() => setAttempt(value => value + 1), 900);
          return;
        }
        setLoading(false);
        setFailed(true);
        console.warn(`[ECLO media image] ${descriptor.mediaFileName ?? 'media'}: ${errorMessage(error)}`);
      });

    return () => {
      mounted = false;
      clearTimeout(retryTimer.current);
    };
  }, [attempt, descriptor, sourceKey]);

  function retryAfterImageFailure(error: unknown) {
    if (attempt < 1) {
      setLoading(true);
      retryTimer.current = setTimeout(() => setAttempt(value => value + 1), 900);
      return;
    }
    setFailed(true);
    console.warn(`[ECLO media image] ${descriptor.mediaFileName ?? 'media'}: ${errorMessage(error)}`);
  }

  if (loading || failed || !resolvedUri) {
    return (
      <View style={[styles.placeholder, style as StyleProp<ViewStyle>, {backgroundColor}]}>
        {loading ? <ActivityIndicator color={indicatorColor} /> : null}
        {showLabel ? (
          <Text numberOfLines={2} style={[styles.label, {color: textColor}]}>
            {loading ? (encrypted ? 'Đang giải mã ảnh...' : 'Đang tải ảnh...') : (encrypted ? 'Không giải mã được ảnh' : 'Không tải được ảnh')}
          </Text>
        ) : null}
      </View>
    );
  }

  const headers = /^https?:\/\//i.test(resolvedUri) ? item.mediaHeaders : undefined;
  return (
    <Image
      source={{uri: resolvedUri, headers, cache: attempt > 0 ? 'reload' : 'force-cache'}}
      style={[style, preserveAspectRatio && intrinsicAspectRatio ? {aspectRatio: intrinsicAspectRatio} : null]}
      resizeMode={resizeMode}
      onLoad={event => {
        setFailed(false);
        const source = event.nativeEvent.source;
        if (preserveAspectRatio && source?.width > 0 && source?.height > 0) {
          setIntrinsicAspectRatio(source.width / source.height);
        }
      }}
      onError={retryAfterImageFailure}
    />
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const styles = StyleSheet.create({
  placeholder: {alignItems: 'center', justifyContent: 'center', overflow: 'hidden', gap: 7},
  label: {fontSize: 12, fontWeight: '600', paddingHorizontal: 8, textAlign: 'center'},
});
