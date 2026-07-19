import React, {useEffect, useState} from 'react';
import {Image, StyleSheet, Text, View, type ImageStyle, type StyleProp, type ViewStyle} from 'react-native';
import {MATRIX_HOMESERVER} from '../config/matrix';

type Props = {
  label: string;
  uri?: string;
  size?: number;
  backgroundColor: string;
  textColor?: string;
  style?: StyleProp<ImageStyle | ViewStyle>;
};

type RemoteImageSource = {uri: string; headers?: Record<string, string>};

export function MatrixAvatar({label, uri, size = 50, backgroundColor, textColor = '#fff', style}: Props) {
  const [failed, setFailed] = useState(false);
  const initial = label.trim().replace(/^@/, '').charAt(0).toUpperCase() || 'E';
  const imageSource = resolveImageSource(uri);

  useEffect(() => {
    setFailed(false);
  }, [imageSource?.uri]);

  const shape = {width: size, height: size, borderRadius: size / 2};

  if (imageSource && !failed) {
    return (
      <Image
        source={imageSource}
        onError={() => setFailed(true)}
        style={[styles.avatar, shape, style as StyleProp<ImageStyle>]}
      />
    );
  }

  return (
    <View style={[styles.avatar, shape, {backgroundColor}, style as StyleProp<ViewStyle>]}>
      <Text style={[styles.text, {color: textColor, fontSize: Math.max(13, size * 0.38)}]}>{initial}</Text>
    </View>
  );
}

function isLoadableImageUri(uri?: string): boolean {
  return Boolean(uri && /^(https?:|file:|data:)/i.test(uri));
}

function resolveImageSource(uri?: string): RemoteImageSource | undefined {
  if (!uri) {
    return undefined;
  }
  if (isLoadableImageUri(uri)) {
    return sourceWithAuthHeader(uri);
  }
  const match = uri.match(/^mxc:\/\/([^/]+)\/(.+)$/);
  if (!match) {
    return undefined;
  }
  const rawServerName = match[1];
  const rawMediaId = match[2];
  if (!rawServerName || !rawMediaId) {
    return undefined;
  }
  const serverName = encodeURIComponent(rawServerName);
  const mediaId = encodeURIComponent(rawMediaId);
  const baseUrl = MATRIX_HOMESERVER.replace(/\/+$/, '');
  return {uri: `${baseUrl}/_matrix/client/v1/media/thumbnail/${serverName}/${mediaId}?width=160&height=160&method=crop`};
}

function sourceWithAuthHeader(uri: string): RemoteImageSource {
  if (!/^https?:\/\//i.test(uri)) {
    return {uri};
  }
  try {
    const parsed = new URL(uri);
    const token = parsed.searchParams.get('access_token');
    if (!token) {
      return {uri};
    }
    parsed.searchParams.delete('access_token');
    return {
      uri: parsed.toString(),
      headers: {Authorization: `Bearer ${token}`},
    };
  } catch {
    return {uri};
  }
}

const styles = StyleSheet.create({
  avatar: {alignItems: 'center', justifyContent: 'center', overflow: 'hidden'},
  text: {fontWeight: '900'},
});
