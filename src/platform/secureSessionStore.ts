import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import type {AuthData} from '../core/models/session';

const SERVICE = 'org.eclo.chat.session';
const USERNAME = 'matrix';
const LEGACY_FALLBACK_KEY = 'org.eclo.chat.session.fallback';

export async function saveSession(auth: AuthData): Promise<void> {
  await AsyncStorage.removeItem(LEGACY_FALLBACK_KEY).catch(() => undefined);
  const serialized = JSON.stringify(auth);
  await Keychain.setGenericPassword(USERNAME, serialized, {
    service: SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function loadSession(): Promise<AuthData | null> {
  await AsyncStorage.removeItem(LEGACY_FALLBACK_KEY).catch(() => undefined);
  const result = await Keychain.getGenericPassword({service: SERVICE});
  if (result) {
    return parseSession(result.password);
  }
  return null;
}

export async function clearSession(): Promise<void> {
  await AsyncStorage.removeItem(LEGACY_FALLBACK_KEY).catch(() => undefined);
  await Keychain.resetGenericPassword({service: SERVICE}).catch(() => undefined);
}

async function parseSession(raw: string | null): Promise<AuthData | null> {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as AuthData;
  } catch {
    await clearSession();
    return null;
  }
}
