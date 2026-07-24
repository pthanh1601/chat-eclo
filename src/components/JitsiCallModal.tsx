import React, { useState, useRef, useEffect, useMemo } from 'react';
import { StyleSheet, View, TouchableOpacity, Text, SafeAreaView, Animated, PanResponder, Dimensions } from 'react-native';
import { WebView } from 'react-native-webview';
import { Minimize2, Maximize2, X } from 'lucide-react-native';

interface JitsiCallModalProps {
  visible: boolean;
  roomName: string;
  token?: string;
  serverURL?: string;
  audioOnly?: boolean;
  displayName?: string;
  avatarUrl?: string;
  onClose: () => void;
  onMinimizeToggle?: (minimized: boolean) => void;
  onEndCall?: () => void;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const PIP_WIDTH = 150;
const PIP_HEIGHT = 220;

export function JitsiCallModal({
  visible,
  roomName,
  token,
  serverURL = 'https://meet.jit.si',
  audioOnly,
  displayName,
  avatarUrl,
  onClose,
  onMinimizeToggle,
  onEndCall
}: JitsiCallModalProps) {
  const [isMinimized, setIsMinimized] = useState(false);
  
  // Animation value for position when minimized
  const pan = useRef(new Animated.ValueXY({ x: SCREEN_WIDTH - PIP_WIDTH - 20, y: SCREEN_HEIGHT - PIP_HEIGHT - 100 })).current;
  const webViewRef = useRef<WebView>(null);
  const _dummy = useRef(null); // Keeps the hook order identical to the cached version in Expo Go

  // Reset state when visibility changes
  useEffect(() => {
    if (visible) {
      setIsMinimized(false);
      onMinimizeToggle?.(false);
    }
  }, [visible]);

  const handleClose = () => {
    if (webViewRef.current) {
      webViewRef.current.injectJavaScript(`
        if (typeof APP !== 'undefined' && APP.conference) {
          APP.conference.hangup();
        } else {
          window.dispatchEvent(new Event('unload'));
        }
        true;
      `);
      setTimeout(() => {
        onClose();
      }, 500);
    } else {
      onClose();
    }
  };

  useEffect(() => {
    onMinimizeToggle?.(isMinimized);
  }, [isMinimized]);

  const panResponder = React.useMemo(() => 
    PanResponder.create({
      onStartShouldSetPanResponder: () => isMinimized,
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
    }),
    [isMinimized, pan]
  );

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
  
  hashParams.append('config.disableProfile', 'true');
  
  // Set audio only
  if (audioOnly) {
    hashParams.append('config.startAudioOnly', 'true');
    hashParams.append('config.startWithVideoMuted', 'true');
  }
  
  // Disable Deep Linking prompt to directly join on web
  hashParams.append('config.disableDeepLinking', 'true');
  
  // Fix iOS WKWebView AudioContext crash on prejoin page
  hashParams.append('config.disableAudioLevels', 'true');
  
  // Hide Jitsi watermark logos via modern config overrides
  const emptySvg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E";
  hashParams.append('config.customLogoUrl', `"${emptySvg}"`);
  hashParams.append('config.watermarkLogoUrl', `"${emptySvg}"`);
  
  // Legacy interface configs
  hashParams.append('interfaceConfig.SHOW_JITSI_WATERMARK', 'false');
  hashParams.append('interfaceConfig.SHOW_WATERMARK_FOR_GUESTS', 'false');
  hashParams.append('interfaceConfig.SHOW_BRAND_WATERMARK', 'false');
  hashParams.append('interfaceConfig.DEFAULT_LOGO_URL', '""');
  hashParams.append('interfaceConfig.DEFAULT_WELCOME_PAGE_LOGO_URL', '""');

  if (Array.from(hashParams.keys()).length > 0) {
    const hashString = decodeURIComponent(hashParams.toString()).replace(/=/g, '=');
    url += `#${hashString}`;
  }

  // Handle Jitsi Hangup
  const handleNavigationStateChange = (navState: any) => {
    // When a user clicks the red hang up button in Jitsi, 
    // Jitsi typically redirects out of the room to a rating page or root domain.
    if (!navState.url.includes(roomName)) {
      onClose();
    }
  };

  // Force hide logos using CSS injection with fuzzy matching for Jitsi's dynamic classes
  const injectedJS = `
    (function() {
      var style = document.createElement('style');
      style.innerHTML = 'a[class*="watermark"], div[class*="watermark"], [class*="watermark"], [class*="logo"], .watermark, .leftwatermark, .rightwatermark, #defaultWatermark, .watermark-link, .header-logo, .prejoin-header .logo, .jitsi-logo { display: none !important; opacity: 0 !important; visibility: hidden !important; pointer-events: none !important; z-index: -9999 !important; }';
      document.head.appendChild(style);
      
      document.addEventListener('click', function(e) {
        var el = e.target;
        var btn = el.closest ? el.closest('[role="button"], button, .button, .toolbox-button') : null;
        if (!btn) {
           var parent = el.parentNode;
           while (parent && parent !== document.body) {
             if (parent.tagName === 'BUTTON' || parent.getAttribute('role') === 'button') {
               btn = parent;
               break;
             }
             parent = parent.parentNode;
           }
        }
        
        if (btn) {
          var aria = (btn.getAttribute('aria-label') || '').toLowerCase();
          var text = (btn.textContent || '').trim().toLowerCase();
          var isEndForAll = aria.includes('end meeting for all') || text.includes('end meeting for all') || (text.includes('kết thúc') && text.includes('tất cả'));
          var isLeave = aria.includes('leave meeting') || text.includes('leave meeting') || text.includes('rời khỏi') || text.includes('rời phòng') || text.includes('rời tạm thời');
          
          if (isEndForAll) {
             window.ReactNativeWebView.postMessage('terminated');
             return;
          } else if (isLeave) {
             window.ReactNativeWebView.postMessage('hangup');
             return;
          }
        }
      }, true);
      
      // Secondary cleanup loop just in case
      setInterval(function() {
        document.querySelectorAll('a[href*="jitsi.org"], img[src*="logo"], [class*="watermark"]').forEach(el => el.style.display = 'none');
      }, 1000);
    })();
    true;
  `;

  return (
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
          zIndex: 99999,
          backgroundColor: '#000',
        } : {
          position: 'absolute',
          width: SCREEN_WIDTH,
          height: SCREEN_HEIGHT,
          top: 0,
          left: 0,
          zIndex: 99999,
          backgroundColor: '#000',
        }
      ]}
    >
      <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
        {!isMinimized && (
          <View style={[styles.header, { justifyContent: 'flex-start' }]}>
            <TouchableOpacity onPress={() => setIsMinimized(true)} style={styles.minimizeBtn}>
              <Minimize2 size={24} color="#fff" />
            </TouchableOpacity>
          </View>
        )}
        
        {isMinimized && (
          <View style={{flexDirection: 'row', position: 'absolute', top: 5, right: 5, zIndex: 100, gap: 5}}>
            <TouchableOpacity 
              style={[styles.pipCloseBtn, {position: 'relative', top: 0, right: 0}]} 
              onPress={(e) => {
                e.stopPropagation();
                setIsMinimized(false);
              }}
            >
              <Maximize2 size={14} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.pipCloseBtn, {position: 'relative', top: 0, right: 0, backgroundColor: '#d32f2f'}]} 
              onPress={(e) => {
                e.stopPropagation();
                handleClose();
              }}
            >
              <X size={14} color="#fff" />
            </TouchableOpacity>
          </View>
        )}

        <View style={{flex: 1}}>
          <WebView
            ref={webViewRef}
            source={{ uri: url }}
            style={{ flex: 1, backgroundColor: '#000' }}
            allowsInlineMediaPlayback={true}
            mediaPlaybackRequiresUserAction={false}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            mediaCapturePermissionGrantType="grant"
            onNavigationStateChange={handleNavigationStateChange}
            injectedJavaScript={injectedJS}
            onMessage={(event) => {
              if (event.nativeEvent.data === 'terminated') {
                onEndCall?.();
                onClose();
              } else if (event.nativeEvent.data === 'hangup') {
                onClose();
              }
            }}
          />
          {/* Overlay to block WebView from eating drag touches */}
          {isMinimized && (
            <View style={[StyleSheet.absoluteFillObject, {backgroundColor: 'rgba(255,255,255,0.01)'}]} pointerEvents="auto" />
          )}
        </View>
      </SafeAreaView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
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
