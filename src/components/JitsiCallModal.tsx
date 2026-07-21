import React, { useState, useRef, useEffect } from 'react';
import { StyleSheet, View, TouchableOpacity, Text, SafeAreaView, Animated, PanResponder, Dimensions, Modal } from 'react-native';
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

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const PIP_WIDTH = 120;
const PIP_HEIGHT = 160;

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
  const [isMinimized, setIsMinimized] = useState(false);
  
  // Animation value for position when minimized
  const pan = useRef(new Animated.ValueXY({ x: SCREEN_WIDTH - PIP_WIDTH - 20, y: SCREEN_HEIGHT - PIP_HEIGHT - 100 })).current;

  // Reset state when visibility changes
  useEffect(() => {
    if (visible) {
      setIsMinimized(false);
    }
  }, [visible]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: () => isMinimized,
      onPanResponderGrant: () => {
        pan.setOffset({
          x: (pan.x as any)._value,
          y: (pan.y as any)._value
        });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event(
        [
          null,
          { dx: pan.x, dy: pan.y }
        ],
        { useNativeDriver: false }
      ),
      onPanResponderRelease: (e, gestureState) => {
        pan.flattenOffset();
        
        // Prevent clicking when dragging
        if (Math.abs(gestureState.dx) < 5 && Math.abs(gestureState.dy) < 5) {
          setIsMinimized(false);
        }
      }
    })
  ).current;

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
  
  // Disable Deep Linking prompt to directly join on web
  hashParams.append('config.disableDeepLinking', 'true');

  if (Array.from(hashParams.keys()).length > 0) {
    const hashString = decodeURIComponent(hashParams.toString()).replace(/=/g, '=');
    url += `#${hashString}`;
  }

  return (
    <Modal visible={visible} animationType={isMinimized ? "none" : "slide"} transparent={isMinimized}>
      <View style={isMinimized ? styles.pipModalWrapper : styles.fullModalWrapper} pointerEvents={isMinimized ? "box-none" : "auto"}>
        <Animated.View
          {...panResponder.panHandlers}
          style={[
            isMinimized ? {
              position: 'absolute',
              width: PIP_WIDTH,
              height: PIP_HEIGHT,
              transform: [{ translateX: pan.x }, { translateY: pan.y }],
              borderRadius: 12,
              overflow: 'hidden',
              elevation: 5,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.3,
              shadowRadius: 4,
              zIndex: 9999,
              backgroundColor: '#000',
            } : styles.fullScreen
          ]}
        >
          <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
            {!isMinimized && (
              <View style={styles.header}>
                <TouchableOpacity onPress={() => setIsMinimized(true)} style={styles.minimizeBtn}>
                  <Text style={styles.minimizeText}>Thu nhỏ</Text>
                </TouchableOpacity>
                
                <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                  <Text style={styles.closeText}>Kết thúc</Text>
                </TouchableOpacity>
              </View>
            )}
            
            {isMinimized && (
              <TouchableOpacity 
                style={styles.pipCloseBtn} 
                onPress={(e) => {
                  e.stopPropagation();
                  onClose();
                }}
              >
                <Text style={{color: 'white', fontWeight: 'bold'}}>✕</Text>
              </TouchableOpacity>
            )}

            <WebView
              source={{ uri: url }}
              style={{ flex: 1, backgroundColor: '#000' }}
              allowsInlineMediaPlayback={true}
              mediaPlaybackRequiresUserAction={false}
              javaScriptEnabled={true}
              domStorageEnabled={true}
              mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
            />
            
            {/* Transparent overlay to capture touches when minimized */}
            {isMinimized && (
              <View style={StyleSheet.absoluteFillObject} pointerEvents="box-only" />
            )}
          </SafeAreaView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fullModalWrapper: {
    flex: 1,
    backgroundColor: '#000',
  },
  pipModalWrapper: {
    ...StyleSheet.absoluteFillObject,
  },
  fullScreen: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    height: 50,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    backgroundColor: '#111',
  },
  minimizeBtn: {
    padding: 8,
    backgroundColor: '#333',
    borderRadius: 8,
  },
  minimizeText: {
    color: '#fff',
  },
  closeBtn: {
    padding: 8,
    backgroundColor: '#d32f2f',
    borderRadius: 8,
  },
  closeText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  pipCloseBtn: {
    position: 'absolute',
    top: 5,
    right: 5,
    backgroundColor: 'rgba(0,0,0,0.6)',
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  }
});
