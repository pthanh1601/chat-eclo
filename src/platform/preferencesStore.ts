import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'org.eclo.chat.pref.';

export async function getPreference<T>(key: string, fallback: T): Promise<T> {
  const value = await AsyncStorage.getItem(PREFIX + key);
  return value ? (JSON.parse(value) as T) : fallback;
}

export async function setPreference<T>(key: string, value: T): Promise<void> {
  await AsyncStorage.setItem(PREFIX + key, JSON.stringify(value));
}
