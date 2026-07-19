import AsyncStorage from '@react-native-async-storage/async-storage';
import type {AuthData} from '../models/session';

export type AccountDevice = {
  device_id: string;
  display_name?: string;
  last_seen_ts?: number;
  last_seen_ip?: string;
};

const IGNORED_USERS_EVENT = 'm.ignored_user_list';
const LOCAL_BLOCKED_PREFIX = 'eclo.blocked.v1.';

export async function listAccountDevices(auth: AuthData): Promise<AccountDevice[]> {
  const payload = await matrixJson<{devices?: AccountDevice[]}>(auth, '/devices');
  return payload.devices ?? [];
}

export async function deleteAccountDevice(auth: AuthData, deviceId: string, password: string): Promise<void> {
  await matrixJson(auth, `/devices/${encodeURIComponent(deviceId)}`, {
    method: 'DELETE',
    body: {
      auth: {
        type: 'm.login.password',
        user: auth.userId,
        password,
      },
    },
  });
}

export async function loadBlockedUsers(auth: AuthData): Promise<string[]> {
  const payload = await matrixJson<{ignored_users?: Record<string, unknown>}>(auth, `/user/${encodeURIComponent(auth.userId)}/account_data/${encodeURIComponent(IGNORED_USERS_EVENT)}`)
    .catch(() => ({ignored_users: {}}));
  return Object.keys(payload.ignored_users ?? {}).sort();
}

export async function saveBlockedUsers(auth: AuthData, users: string[]): Promise<void> {
  const ignored_users = Object.fromEntries([...new Set(users)].sort().map(userId => [userId, {}]));
  await matrixJson(auth, `/user/${encodeURIComponent(auth.userId)}/account_data/${encodeURIComponent(IGNORED_USERS_EVENT)}`, {
    method: 'PUT',
    body: {ignored_users},
  });
}

export async function loadLocalBlockedUsers(ownerId: string): Promise<string[]> {
  const raw = await AsyncStorage.getItem(`${LOCAL_BLOCKED_PREFIX}${ownerId}`).catch(() => null);
  if (!raw) {
    return [];
  }
  try {
    return (JSON.parse(raw) as string[]).filter(Boolean).sort();
  } catch {
    return [];
  }
}

export async function saveLocalBlockedUsers(ownerId: string, users: string[]): Promise<string[]> {
  const next = [...new Set(users)].sort();
  await AsyncStorage.setItem(`${LOCAL_BLOCKED_PREFIX}${ownerId}`, JSON.stringify(next));
  return next;
}

async function matrixJson<T = unknown>(
  auth: AuthData,
  path: string,
  options: {method?: string; body?: unknown} = {},
): Promise<T> {
  const response = await fetch(`${auth.baseUrl.replace(/\/+$/, '')}/_matrix/client/v3${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      Accept: 'application/json',
      ...(options.body === undefined ? null : {'Content-Type': 'application/json'}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    throw await matrixResponseError(response);
  }

  const text = await response.text();
  return text ? JSON.parse(text) as T : {} as T;
}

async function matrixResponseError(response: Response): Promise<Error> {
  const text = await response.text().catch(() => '');
  try {
    const payload = JSON.parse(text) as {error?: string; errcode?: string};
    return new Error(payload.error || payload.errcode || `Yêu cầu thất bại (${response.status}).`);
  } catch {
    return new Error(text || `Yêu cầu thất bại (${response.status}).`);
  }
}
