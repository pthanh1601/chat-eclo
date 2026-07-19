import React from 'react';
import {StyleSheet, type StyleProp, type ViewProps, type ViewStyle} from 'react-native';
import {LiquidGlassView, isLiquidGlassSupported} from '@callstack/liquid-glass';
import {useAppTheme} from '../theme/useAppTheme';

type Props = Omit<ViewProps, 'style'> & {
  effect?: 'clear' | 'regular';
  interactive?: boolean;
  style?: StyleProp<ViewStyle>;
  tintColor?: string;
  fallbackColor?: string;
};

export function GlassSurface({
  children,
  effect = 'regular',
  fallbackColor,
  interactive = false,
  style,
  tintColor,
  ...props
}: Props) {
  const colors = useAppTheme();
  const tint = tintColor ?? (colors.dark ? 'rgba(20, 24, 32, 0.50)' : 'rgba(255, 255, 255, 0.48)');
  const fallbackStyle = !isLiquidGlassSupported ? {backgroundColor: fallbackColor ?? tint} : null;

  return (
    <LiquidGlassView
      {...props}
      colorScheme={colors.dark ? 'dark' : 'light'}
      effect={effect}
      interactive={interactive}
      tintColor={tint}
      style={[
        styles.surface,
        fallbackStyle,
        style,
      ]}>
      {children}
    </LiquidGlassView>
  );
}

const styles = StyleSheet.create({
  surface: {overflow: 'hidden'},
});
