import {useColorScheme} from 'react-native';
import {fontFamilyForChoice, useAppSettings} from '../context/AppSettingsContext';

export type AppTheme = ReturnType<typeof useAppTheme>;

const fallbackPrimary = '#0b7cff';

const palettes = {
  light: {
    dark: false,
    primary: fallbackPrimary,
    background: '#f2f2f7',
    surface: '#fff',
    elevated: '#fff',
    text: '#050505',
    secondaryText: '#6b7280',
    tertiaryText: '#9ca3af',
    separator: '#e5e7eb',
    input: '#eef1f5',
    danger: '#b42318',
    dangerSoft: '#fff1f0',
    warning: '#9a6700',
    warningSoft: '#fff8e1',
    success: '#0f8f5f',
    successSoft: '#e8f8ef',
    bubbleMine: fallbackPrimary,
    bubbleOther: '#fff',
    bubbleOtherBorder: '#e5e7eb',
    shadow: '#0b1324',
  },
  dark: {
    dark: true,
    primary: fallbackPrimary,
    background: '#0b1020',
    surface: '#111827',
    elevated: '#172033',
    text: '#f8fafc',
    secondaryText: '#cbd5e1',
    tertiaryText: '#94a3b8',
    separator: '#263247',
    input: '#172033',
    danger: '#ff8a8a',
    dangerSoft: '#341b22',
    warning: '#f5c451',
    warningSoft: '#332917',
    success: '#6ee7b7',
    successSoft: '#102a22',
    bubbleMine: fallbackPrimary,
    bubbleOther: '#172033',
    bubbleOtherBorder: '#263247',
    shadow: '#000',
  },
};

export function useAppTheme() {
  const systemScheme = useColorScheme();
  const {settings} = useAppSettings();
  const isDark = settings.themeMode === 'system'
    ? systemScheme === 'dark'
    : settings.themeMode === 'dark';
  const base = isDark ? palettes.dark : palettes.light;
  const primary = settings.accentColor;
  const fontFamily = fontFamilyForChoice(settings.fontChoice);
  const fontScale = settings.fontSize / 16;

  return {
    ...base,
    primary,
    bubbleMine: primary,
    fontFamily,
    fontScale,
    fontSize: settings.fontSize,
    chatBackground: settings.chatBackground,
  };
}
