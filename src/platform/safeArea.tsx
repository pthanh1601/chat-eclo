import React, {useMemo} from 'react';
import {Dimensions, Platform, StatusBar, View, type StyleProp, type ViewStyle} from 'react-native';
import {SafeAreaInsetsContext, type EdgeInsets} from 'react-native-safe-area-context';

type Edge = 'top' | 'right' | 'bottom' | 'left';

type SafeAreaViewProps = {
  children?: React.ReactNode;
  edges?: Edge[];
  style?: StyleProp<ViewStyle>;
};

export function AppSafeAreaProvider({children}: {children: React.ReactNode}) {
  const {width, height} = Dimensions.get('window');
  const insets = useMemo(() => estimateInsets(width, height), [height, width]);

  return (
    <SafeAreaInsetsContext.Provider value={insets}>
      {children}
    </SafeAreaInsetsContext.Provider>
  );
}

export function useSafeAreaInsets(): EdgeInsets {
  const context = React.useContext(SafeAreaInsetsContext);
  return context ?? estimateInsets(Dimensions.get('window').width, Dimensions.get('window').height);
}

export function SafeAreaView({children, edges = ['top', 'right', 'bottom', 'left'], style}: SafeAreaViewProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        {
          paddingTop: edges.includes('top') ? insets.top : 0,
          paddingRight: edges.includes('right') ? insets.right : 0,
          paddingBottom: edges.includes('bottom') ? insets.bottom : 0,
          paddingLeft: edges.includes('left') ? insets.left : 0,
        },
        style,
      ]}>
      {children}
    </View>
  );
}

function estimateInsets(width: number, height: number): EdgeInsets {
  if (Platform.OS === 'android') {
    return {
      top: StatusBar.currentHeight ?? 24,
      right: 0,
      bottom: 0,
      left: 0,
    };
  }

  const shortest = Math.min(width, height);
  const longest = Math.max(width, height);
  const hasModernPhoneShape = Platform.OS === 'ios' && shortest < 600 && longest >= 780;

  return {
    top: hasModernPhoneShape ? 58 : 24,
    right: 0,
    bottom: hasModernPhoneShape ? 34 : 0,
    left: 0,
  };
}
