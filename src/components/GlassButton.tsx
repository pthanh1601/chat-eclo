import React from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type AccessibilityRole,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {GlassSurface} from './GlassSurface';
import {useAppTheme} from '../theme/useAppTheme';

type Props = {
  children: React.ReactNode;
  onPress?: () => void;
  selected?: boolean;
  disabled?: boolean;
  danger?: boolean;
  style?: StyleProp<ViewStyle>;
  glassStyle?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
};

export function GlassButton({
  accessibilityLabel,
  accessibilityRole = 'button',
  children,
  contentStyle,
  danger = false,
  disabled = false,
  glassStyle,
  onPress,
  selected = false,
  style,
}: Props) {
  const colors = useAppTheme();
  const baseTint = 'transparent';
  const selectedTint = danger ? alphaColor(colors.danger, 0.46) : alphaColor(colors.primary, 0.42);
  const fallbackColor = selected
    ? danger
      ? alphaColor(colors.danger, 0.16)
      : alphaColor(colors.primary, colors.dark ? 0.24 : 0.14)
    : colors.input;

  return (
    <GlassSurface
      interactive={!disabled}
      effect="regular"
      tintColor={selected ? selectedTint : baseTint}
      fallbackColor={fallbackColor}
      style={[
        styles.glass,
        style,
        disabled ? styles.disabled : null,
        glassStyle,
      ]}>
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole={accessibilityRole}
        disabled={disabled}
        onPress={onPress}
        style={styles.pressable}>
        <View style={[styles.content, contentStyle]}>{children}</View>
      </Pressable>
    </GlassSurface>
  );
}

function alphaColor(color: string, alpha: number) {
  const normalized = color.trim();

  if (normalized.startsWith('#')) {
    const hex = normalized.replace('#', '');
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
  }

  return normalized;
}

const styles = StyleSheet.create({
  glass: {
    width: '100%',
    height: '100%',
    borderRadius: 20,
  },
  pressable: {
    width: '100%',
    height: '100%',
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.48,
  },
});
