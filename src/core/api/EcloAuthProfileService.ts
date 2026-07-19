import {
  ECLO_API_BASE_URL,
  ECLO_MOBILE_APP_HEADER,
  ECLO_MOBILE_APP_KEY,
  ECLO_PROFILE_READ_RETRY_COUNT,
} from '../../config/ecloApi';
import {OTP_MAX_DIGITS} from '../../config/appConfig';
import type {AuthData} from '../models/session';

type ApiErrorDetails = {
  formErrors?: string[];
  fieldErrors?: Record<string, string[]>;
};

type ApiErrorBody = {
  error?: string;
  code?: string;
  details?: ApiErrorDetails;
};

type ApiSuccess = {
  ok: true;
  message?: string;
};

type ApiRequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  accessToken?: string;
  signal?: AbortSignal;
};

const profileRequests = new Map<string, {controller: AbortController; promise: Promise<EcloProfile>}>();

export type EcloProfile = {
  matrixUserId: string;
  username: string;
  displayName: string;
  email: string | null;
  emailVerified: boolean;
  pendingEmail: string | null;
  phone: string | null;
  phoneVerified: boolean;
};

export type RegisterVerification = {
  email: string;
  code: string;
  username: string;
  password: string;
  displayName: string;
};

export class EcloApiError extends Error {
  status: number;
  code: string;
  details?: ApiErrorDetails;

  constructor(status: number, body: ApiErrorBody) {
    const firstFieldError = body.details?.fieldErrors
      ? Object.values(body.details.fieldErrors).flat().find(Boolean)
      : undefined;
    super(firstFieldError || body.error || `Yêu cầu chưa hoàn tất (${status}).`);
    this.name = 'EcloApiError';
    this.status = status;
    this.code = body.code || 'UNKNOWN_ERROR';
    this.details = body.details;
  }
}

export class RegistrationLoginError extends Error {
  username: string;

  constructor(username: string) {
    super('Tài khoản đã được tạo nhưng chưa thể tự đăng nhập. Vui lòng đăng nhập bằng tài khoản vừa tạo.');
    this.name = 'RegistrationLoginError';
    this.username = username;
  }
}

export async function requestRegistrationCode(email: string): Promise<ApiSuccess> {
  return ecloRequest('/api/auth/register/request-code', {
    method: 'POST',
    body: {email: normalizeEmail(email)},
  });
}

export async function verifyRegistration(input: RegisterVerification): Promise<ApiSuccess & {user: {matrixUserId: string}} > {
  return ecloRequest('/api/auth/register/verify', {
    method: 'POST',
    body: {
      ...input,
      username: input.username.trim().toLowerCase(),
      displayName: input.displayName.trim(),
      email: normalizeEmail(input.email),
      code: normalizeOtp(input.code),
    },
  });
}

export async function requestPasswordResetCode(email: string): Promise<ApiSuccess> {
  return ecloRequest('/api/auth/password/request-code', {
    method: 'POST',
    body: {email: normalizeEmail(email)},
  });
}

export async function resetPassword(email: string, code: string, password: string): Promise<ApiSuccess> {
  return ecloRequest('/api/auth/password/reset', {
    method: 'POST',
    body: {email: normalizeEmail(email), code: normalizeOtp(code), password},
  });
}

export async function getEcloProfile(auth: AuthData): Promise<EcloProfile> {
  const existing = profileRequests.get(auth.accessToken);
  if (existing) {
    return existing.promise;
  }
  const controller = new AbortController();
  const promise = loadEcloProfile(auth, controller.signal).finally(() => {
    profileRequests.delete(auth.accessToken);
  });
  profileRequests.set(auth.accessToken, {controller, promise});
  return promise;
}

export function cancelEcloProfileRequest(auth: AuthData): void {
  profileRequests.get(auth.accessToken)?.controller.abort();
  profileRequests.delete(auth.accessToken);
}

export async function patchEcloProfile(
  auth: AuthData,
  patch: {displayName?: string; phone?: string | null},
): Promise<EcloProfile> {
  const response = await authenticatedRequest<{ok: true; profile: EcloProfile}>(auth, '/api/profile', {
    method: 'PATCH',
    body: patch,
  });
  return response.profile;
}

export async function requestProfileEmailCode(auth: AuthData, email: string): Promise<ApiSuccess> {
  return authenticatedRequest(auth, '/api/profile/email/request-code', {
    method: 'POST',
    body: {email: normalizeEmail(email)},
  });
}

export async function verifyProfileEmail(auth: AuthData, email: string, code: string): Promise<EcloProfile> {
  const response = await authenticatedRequest<{ok: true; profile: EcloProfile}>(auth, '/api/profile/email/verify', {
    method: 'POST',
    body: {email: normalizeEmail(email), code: normalizeOtp(code)},
  });
  return response.profile;
}

export async function changeAccountPassword(
  auth: AuthData,
  email: string,
  oldPassword: string,
  newPassword: string,
): Promise<ApiSuccess> {
  return authenticatedRequest(auth, '/api/auth/password/change', {
    method: 'POST',
    body: {email: normalizeEmail(email), oldPassword, newPassword},
  });
}

export async function requestAccountDeletionCode(auth: AuthData, email: string): Promise<ApiSuccess> {
  return authenticatedRequest(auth, '/api/auth/account/delete/request-code', {
    method: 'POST',
    body: {email: normalizeEmail(email)},
  });
}

export async function verifyAccountDeletion(auth: AuthData, email: string, code: string): Promise<ApiSuccess> {
  return authenticatedRequest(auth, '/api/auth/account/delete/verify', {
    method: 'POST',
    body: {email: normalizeEmail(email), code: normalizeOtp(code)},
  });
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeOtp(value: string): string {
  return value.replace(/\D/g, '').slice(0, OTP_MAX_DIGITS);
}

async function authenticatedRequest<T>(
  auth: AuthData,
  path: string,
  options: Omit<ApiRequestOptions, 'accessToken'> = {},
): Promise<T> {
  return ecloRequest<T>(path, {...options, accessToken: auth.accessToken});
}

async function loadEcloProfile(auth: AuthData, signal: AbortSignal): Promise<EcloProfile> {
  let response: {ok: true; profile: EcloProfile} | undefined;
  for (let attempt = 0; attempt <= ECLO_PROFILE_READ_RETRY_COUNT; attempt += 1) {
    try {
      response = await authenticatedRequest(auth, '/api/profile', {signal});
      break;
    } catch (error) {
      const retryable = !(error instanceof EcloApiError) || error.status === 502 || error.status === 504;
      if (!retryable || attempt >= ECLO_PROFILE_READ_RETRY_COUNT) {
        throw error;
      }
    }
  }
  if (!response) throw new Error('Không thể tải hồ sơ ECLO.');
  if (response.profile.matrixUserId !== auth.userId) {
    throw new Error('Hồ sơ ECLO không khớp với phiên đăng nhập hiện tại.');
  }
  return response.profile;
}

async function ecloRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${ECLO_API_BASE_URL}${path}`, {
      method: options.method || 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        [ECLO_MOBILE_APP_HEADER]: ECLO_MOBILE_APP_KEY,
        ...(options.accessToken ? {Authorization: `Bearer ${options.accessToken}`} : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    throw new Error('Không thể kết nối. Vui lòng kiểm tra mạng và thử lại.');
  }

  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = {error: text || `Yêu cầu chưa hoàn tất (${response.status}).`};
  }

  if (!response.ok) {
    throw new EcloApiError(response.status, (data || {}) as ApiErrorBody);
  }
  return data as T;
}
