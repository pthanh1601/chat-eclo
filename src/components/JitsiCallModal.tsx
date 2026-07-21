import React from 'react';
import { StyleSheet, View, Modal, TouchableOpacity, Text, SafeAreaView } from 'react-native';
import { WebView } from 'react-native-webview';

interface JitsiCallModalProps {
  visible: boolean;
  roomName: string;
  token?: string;
  serverURL?: string;
  audioOnly?: boolean;
  displayName?: string;
  avatarUrl?: string;
  onClose: () => void;
}

export function JitsiCallModal({
  visible,
  roomName,
  token,
  serverURL = 'https://meet.jit.si',
  audioOnly,
  displayName,
  avatarUrl,
  onClose,
}: JitsiCallModalProps) {
  if (!visible) return null;

  // Build the Jitsi URL with config overwrites in the hash
  let url = `${serverURL}/${roomName}`;
  
  const hashParams = new URLSearchParams();
  
  if (token) {
    url += `?jwt=${token}`;
  }

  // Inject user info into config
  if (displayName) hashParams.append('userInfo.displayName', `"${displayName}"`);
  if (avatarUrl) hashParams.append('userInfo.avatarURL', `"${avatarUrl}"`);
  
  // Set audio only
  if (audioOnly) {
    hashParams.append('config.startAudioOnly', 'true');
    hashParams.append('config.startWithVideoMuted', 'true');
  }

  if (Array.from(hashParams.keys()).length > 0) {
    const hashString = decodeURIComponent(hashParams.toString()).replace(/=/g, '=');
    url += `#${hashString}`;
  }

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeText}>Đóng</Text>
          </TouchableOpacity>
        </View>
        <WebView
          source={{ uri: url }}
          style={styles.webview}
          allowsInlineMediaPlayback={true}
          mediaPlaybackRequiresUserAction={false}
          javaScriptEnabled={true}
          domStorageEnabled={true}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
    zIndex: 99999,
  },
  jitsiContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  jitsi: {
    flex: 1,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtn: {
    position: 'absolute',
    top: 50,
    right: 20,
    backgroundColor: 'rgba(255,50,50,0.8)',
    padding: 12,
    borderRadius: 30,
    zIndex: 100000,
  }
});
