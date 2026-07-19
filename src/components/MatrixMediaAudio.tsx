import React, {useEffect, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, Pressable, StyleSheet, Text, View} from 'react-native';
import {Pause, Play} from 'lucide-react-native';
import {createSound, type PlayBackType} from 'react-native-nitro-sound';
import {resolveMatrixMediaUri, type MatrixMediaDescriptor} from '../core/matrix/MediaDecryptor';

type Props = {
  item: MatrixMediaDescriptor;
  backgroundColor: string;
  buttonColor: string;
  textColor: string;
};

type NitroSound = ReturnType<typeof createSound>;

export function MatrixMediaAudio({item, backgroundColor, buttonColor, textColor}: Props) {
  const [resolvedUri, setResolvedUri] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const soundRef = useRef<NitroSound | null>(null);
  const authorization = item.mediaHeaders?.Authorization;
  const descriptor = useMemo<MatrixMediaDescriptor>(() => ({
    mediaUrl: item.mediaUrl,
    mediaHeaders: authorization ? {Authorization: authorization} : undefined,
    mediaSourceJson: item.mediaSourceJson,
    mediaFileName: item.mediaFileName,
    mediaMimeType: item.mediaMimeType,
  }), [authorization, item.mediaFileName, item.mediaMimeType, item.mediaSourceJson, item.mediaUrl]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setFailed(false);
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
        console.warn(`[ECLO media audio] ${descriptor.mediaFileName ?? 'audio'}: ${errorMessage(error)}`);
      });
    return () => {
      mounted = false;
    };
  }, [descriptor]);

  useEffect(() => () => {
    const sound = soundRef.current;
    soundRef.current = null;
    if (sound) {
      sound.removePlayBackListener();
      sound.removePlaybackEndListener();
      sound.stopPlayer().catch(() => undefined);
      sound.dispose();
    }
  }, []);

  async function togglePlayback() {
    if (!resolvedUri || failed) {
      return;
    }
    try {
      let sound = soundRef.current;
      if (!sound) {
        sound = createSound();
        soundRef.current = sound;
        sound.setSubscriptionDuration(0.2);
        sound.addPlayBackListener((event: PlayBackType) => {
          setPosition(event.currentPosition);
          setDuration(event.duration);
        });
        sound.addPlaybackEndListener(() => {
          setPlaying(false);
          setPosition(0);
        });
      }
      if (playing) {
        await sound.pausePlayer();
        setPlaying(false);
      } else if (position > 0 && (!duration || position < duration)) {
        await sound.resumePlayer();
        setPlaying(true);
      } else {
        const headers = /^https?:\/\//i.test(resolvedUri) ? item.mediaHeaders : undefined;
        await sound.startPlayer(resolvedUri, headers);
        setPlaying(true);
      }
    } catch (error) {
      setPlaying(false);
      setFailed(true);
      console.warn(`[ECLO media audio] ${descriptor.mediaFileName ?? 'audio'}: ${errorMessage(error)}`);
    }
  }

  const progress = duration > 0 ? Math.min(100, Math.max(0, position / duration * 100)) : 0;
  return (
    <View style={[styles.container, {backgroundColor}]}>
      <Pressable accessibilityRole="button" accessibilityLabel={playing ? 'Tạm dừng ghi âm' : 'Phát ghi âm'} disabled={loading || failed} onPress={() => void togglePlayback()} style={({pressed}) => [styles.button, {backgroundColor: buttonColor}, pressed ? styles.pressed : null]}>
        {loading ? <ActivityIndicator size="small" color="#fff" /> : playing ? <Pause size={20} color="#fff" fill="#fff" /> : <Play size={20} color="#fff" fill="#fff" />}
      </Pressable>
      <View style={styles.body}>
        <Text numberOfLines={1} style={[styles.title, {color: textColor}]}>{failed ? 'Không phát được ghi âm' : item.mediaFileName ?? 'Tin nhắn thoại'}</Text>
        <View style={[styles.track, {backgroundColor: `${textColor}2a`}]}>
          <View style={[styles.progress, {backgroundColor: buttonColor, width: `${progress}%`}]} />
        </View>
        <Text style={[styles.time, {color: textColor}]}>{formatDuration(position)} / {duration ? formatDuration(duration) : '--:--'}</Text>
      </View>
    </View>
  );
}

function formatDuration(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const styles = StyleSheet.create({
  container: {width: 240, minHeight: 70, borderRadius: 16, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 10},
  button: {width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', paddingLeft: 2},
  body: {flex: 1, gap: 5},
  title: {fontSize: 13, fontWeight: '800'},
  track: {height: 4, borderRadius: 2, overflow: 'hidden'},
  progress: {height: 4, borderRadius: 2},
  time: {fontSize: 11, fontWeight: '700', opacity: 0.72},
  pressed: {opacity: 0.74, transform: [{scale: 0.96}]},
});
