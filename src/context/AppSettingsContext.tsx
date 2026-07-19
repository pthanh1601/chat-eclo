import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {createContext, useCallback, useContext, useEffect, useMemo, useState} from 'react';
import {Appearance, Text, TextInput} from 'react-native';

export type ThemeMode = 'light' | 'dark' | 'system';
export type FontChoice = 'system' | 'rounded' | 'serif' | 'mono';
export type ChatBackgroundChoice = 'gradient' | 'doodle' | 'wave' | 'stars';

export type AppSettings = {
  accentColor: string;
  chatBackground: ChatBackgroundChoice;
  fontChoice: FontChoice;
  fontSize: number;
  themeMode: ThemeMode;
};

type AppSettingsContextValue = {
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
};

const STORAGE_KEY = 'eclo.app.settings.v1';
export const APP_ACCENT_COLORS = ['#0b7cff', '#20a4d8', '#05a98b', '#ff6b35', '#e91e63', '#6b7280'] as const;
export const APP_FONT_OPTIONS: Array<{key: FontChoice; label: string; family?: string}> = [
  {key: 'system', label: 'Hệ thống'},
  {key: 'rounded', label: 'Rounded', family: 'Avenir Next'},
  {key: 'serif', label: 'Serif', family: 'Georgia'},
  {key: 'mono', label: 'Mono', family: 'Menlo'},
];
export const CHAT_BACKGROUND_OPTIONS: Array<{key: ChatBackgroundChoice; label: string}> = [
  {key: 'gradient', label: 'Gradient'},
  {key: 'doodle', label: 'Doodle'},
  {key: 'wave', label: 'Sóng'},
  {key: 'stars', label: 'Sao'},
];

export const defaultAppSettings: AppSettings = {
  accentColor: APP_ACCENT_COLORS[0],
  chatBackground: 'gradient',
  fontChoice: 'system',
  fontSize: 16,
  themeMode: 'system',
};

const AppSettingsContext = createContext<AppSettingsContextValue>({
  settings: defaultAppSettings,
  updateSettings: () => undefined,
});

export function AppSettingsProvider({children}: {children: React.ReactNode}) {
  const [settings, setSettings] = useState<AppSettings>(defaultAppSettings);

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then(value => {
        if (!value || !mounted) {
          return;
        }
        setSettings(sanitizeSettings(JSON.parse(value)));
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    Appearance.setColorScheme(settings.themeMode === 'system' ? 'unspecified' : settings.themeMode);
  }, [settings.themeMode]);

  useEffect(() => {
    const fontFamily = fontFamilyForChoice(settings.fontChoice);
    const defaultStyle = {fontFamily, fontSize: settings.fontSize};
    (Text as any).defaultProps = {
      ...(Text as any).defaultProps,
      style: defaultStyle,
    };
    (TextInput as any).defaultProps = {
      ...(TextInput as any).defaultProps,
      style: defaultStyle,
    };
  }, [settings.fontChoice, settings.fontSize]);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings(current => {
      const next = sanitizeSettings({...current, ...patch});
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  }, []);

  const value = useMemo(() => ({settings, updateSettings}), [settings, updateSettings]);

  return <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>;
}

export function useAppSettings() {
  return useContext(AppSettingsContext);
}

export function fontFamilyForChoice(choice: FontChoice) {
  return APP_FONT_OPTIONS.find(item => item.key === choice)?.family;
}

function sanitizeSettings(value: Partial<AppSettings>): AppSettings {
  const accentColor = APP_ACCENT_COLORS.includes(value.accentColor as typeof APP_ACCENT_COLORS[number])
    ? value.accentColor as string
    : defaultAppSettings.accentColor;
  const themeMode = value.themeMode === 'light' || value.themeMode === 'dark' || value.themeMode === 'system'
    ? value.themeMode
    : defaultAppSettings.themeMode;
  const fontChoice = APP_FONT_OPTIONS.some(item => item.key === value.fontChoice)
    ? value.fontChoice as FontChoice
    : defaultAppSettings.fontChoice;
  const chatBackground = CHAT_BACKGROUND_OPTIONS.some(item => item.key === value.chatBackground)
    ? value.chatBackground as ChatBackgroundChoice
    : defaultAppSettings.chatBackground;
  const fontSize = Math.max(12, Math.min(32, Number(value.fontSize) || defaultAppSettings.fontSize));

  return {accentColor, chatBackground, fontChoice, fontSize, themeMode};
}
