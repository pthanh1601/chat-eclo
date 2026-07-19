import AsyncStorage from '@react-native-async-storage/async-storage';
import type {Asset} from 'react-native-image-picker';
import type {AuthData} from '../models/session';
import type {EcloProfile} from '../api/EcloAuthProfileService';

export type StoredProfile = {
  displayName?: string;
  avatarUrl?: string;
  matrixAvatarUrl?: string;
  email?: string | null;
  emailVerified?: boolean;
  pendingEmail?: string | null;
  phone?: string | null;
  phoneVerified?: boolean;
};

const PROFILE_STORAGE_PREFIX = 'eclo.profile.v1.';
const PROFILE_CONTACTS_EVENT = 'org.eclo.profile_contacts';

export function shortMatrixId(userId: string): string {
  if (!userId.startsWith('@')) {
    return userId;
  }
  return userId.replace(/:.+$/, '');
}

export async function loadStoredProfile(userId: string): Promise<StoredProfile> {
  const raw = await AsyncStorage.getItem(storageKey(userId));
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw) as StoredProfile;
  } catch {
    return {};
  }
}

export async function saveStoredProfile(userId: string, patch: StoredProfile): Promise<StoredProfile> {
  const previous = await loadStoredProfile(userId);
  const next = cleanProfile({...previous, ...patch});
  await AsyncStorage.setItem(storageKey(userId), JSON.stringify(next));
  return next;
}

export async function clearStoredProfile(userId: string): Promise<void> {
  await AsyncStorage.removeItem(storageKey(userId));
}

export async function loadMatrixProfile(auth: AuthData): Promise<StoredProfile> {
  const [profile, threepids, contacts] = await Promise.all([
    matrixJson<{displayname?: string; avatar_url?: string}>(auth, `/profile/${encodeURIComponent(auth.userId)}`).catch(() => ({} as {displayname?: string; avatar_url?: string})),
    matrixJson<{threepids?: Array<{medium?: string; address?: string}>}>(auth, '/account/3pid').catch(() => ({threepids: []})),
    matrixJson<{email?: string; phone?: string}>(auth, `/user/${encodeURIComponent(auth.userId)}/account_data/${encodeURIComponent(PROFILE_CONTACTS_EVENT)}`).catch(() => ({} as {email?: string; phone?: string})),
  ]);
  const matrixEmail = threepids.threepids?.find(item => item.medium === 'email')?.address;
  const matrixPhone = threepids.threepids?.find(item => item.medium === 'msisdn')?.address;

  return cleanProfile({
    displayName: profile.displayname,
    matrixAvatarUrl: profile.avatar_url,
    avatarUrl: matrixMediaUrl(auth.baseUrl, profile.avatar_url, auth.accessToken),
    email: matrixEmail || contacts.email,
    emailVerified: Boolean(matrixEmail),
    phone: matrixPhone || contacts.phone,
    phoneVerified: Boolean(matrixPhone),
  });
}

export function mergeEcloProfile(matrixProfile: StoredProfile, apiProfile?: EcloProfile): StoredProfile {
  const apiHasEmail = apiProfile?.email != null;
  const apiHasPhone = apiProfile?.phone != null;
  return cleanProfile({
    ...matrixProfile,
    displayName: apiProfile?.displayName || matrixProfile.displayName,
    email: apiProfile?.email ?? matrixProfile.email ?? null,
    emailVerified: apiHasEmail ? apiProfile?.emailVerified : Boolean(matrixProfile.emailVerified),
    pendingEmail: apiProfile?.pendingEmail ?? null,
    phone: apiProfile?.phone ?? matrixProfile.phone ?? null,
    phoneVerified: apiHasPhone ? apiProfile?.phoneVerified : Boolean(matrixProfile.phoneVerified),
  });
}

export async function updateMatrixDisplayName(auth: AuthData, displayName: string): Promise<void> {
  await matrixJson(auth, `/profile/${encodeURIComponent(auth.userId)}/displayname`, {
    method: 'PUT',
    body: {displayname: displayName.trim()},
  });
}

export async function updateMatrixAvatar(auth: AuthData, asset: Asset): Promise<StoredProfile> {
  const contentUri = await uploadMatrixMedia(auth, asset);
  await matrixJson(auth, `/profile/${encodeURIComponent(auth.userId)}/avatar_url`, {
    method: 'PUT',
    body: {avatar_url: contentUri},
  });
  return {
    matrixAvatarUrl: contentUri,
    avatarUrl: matrixMediaUrl(auth.baseUrl, contentUri, auth.accessToken),
  };
}

export async function updateMatrixRoomProfile(
  auth: AuthData,
  roomId: string,
  patch: {name?: string; avatar?: Asset},
): Promise<{avatarUrl?: string; matrixAvatarUrl?: string}> {
  let contentUri: string | undefined;
  if (patch.name?.trim()) {
    await matrixJson(auth, `/rooms/${encodeURIComponent(roomId)}/state/m.room.name/`, {
      method: 'PUT',
      body: {name: patch.name.trim()},
    });
  }
  if (patch.avatar) {
    contentUri = await uploadMatrixMedia(auth, patch.avatar);
    await matrixJson(auth, `/rooms/${encodeURIComponent(roomId)}/state/m.room.avatar/`, {
      method: 'PUT',
      body: {url: contentUri},
    });
  }
  return {
    matrixAvatarUrl: contentUri,
    avatarUrl: matrixMediaUrl(auth.baseUrl, contentUri, auth.accessToken),
  };
}

function cleanProfile(profile: StoredProfile): StoredProfile {
  return Object.fromEntries(
    Object.entries(profile).filter(([, value]) => {
      if (typeof value === 'string') {
        return value.trim().length > 0;
      }
      return value !== undefined;
    }),
  ) as StoredProfile;
}

function storageKey(userId: string): string {
  return `${PROFILE_STORAGE_PREFIX}${userId}`;
}

export async function uploadMatrixMedia(auth: AuthData, asset: Asset): Promise<string> {
  if (!asset.uri) {
    throw new Error('Không tìm thấy ảnh đã chọn.');
  }
  const filename = asset.fileName || `avatar-${Date.now()}.jpg`;
  const contentType = asset.type || 'image/jpeg';
  const body = {
    uri: asset.uri,
    name: filename,
    type: contentType,
  };

  const endpoints = [
    `/_matrix/media/v3/upload?filename=${encodeURIComponent(filename)}`,
    `/_matrix/media/r0/upload?filename=${encodeURIComponent(filename)}`,
  ];
  let lastError: unknown;

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${auth.baseUrl.replace(/\/+$/, '')}${endpoint}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          'Content-Type': contentType,
        },
        body: body as any,
      });

      if (response.status === 404) {
        lastError = new Error('Không thể tải ảnh lên.');
        continue;
      }
      if (!response.ok) {
        throw await matrixResponseError(response);
      }
      const payload = await response.json() as {content_uri?: string};
      if (!payload.content_uri) {
        throw new Error('Máy chủ không trả về đường dẫn ảnh.');
      }
      return payload.content_uri;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Không thể tải ảnh đại diện lên.');
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

  if (response.status === 204) {
    return {} as T;
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

function matrixMediaUrl(baseUrl: string, mxcUrl?: string, accessToken?: string): string | undefined {
  const match = mxcUrl?.match(/^mxc:\/\/([^/]+)\/(.+)$/);
  if (!match) {
    return mxcUrl;
  }
  const rawServerName = match[1];
  const rawMediaId = match[2];
  if (!rawServerName || !rawMediaId) {
    return undefined;
  }
  const serverName = encodeURIComponent(rawServerName);
  const mediaId = encodeURIComponent(rawMediaId);
  const params = new URLSearchParams({
    width: '320',
    height: '320',
    method: 'crop',
  });
  if (accessToken) {
    params.set('access_token', accessToken);
  }
  return `${baseUrl.replace(/\/+$/, '')}/_matrix/client/v1/media/thumbnail/${serverName}/${mediaId}?${params.toString()}`;
}
