import React, {createContext, useCallback, useContext, useEffect, useMemo, useState} from 'react';
import type {AuthData, SessionBootState, SessionState} from '../core/models/session';
import {MATRIX_HOMESERVER} from '../config/matrix';
import {matrixClientService} from '../core/matrix/MatrixClientService';
import {nativeMatrixService} from '../core/matrix/NativeMatrixService';
import {clearSession, loadSession, saveSession} from '../platform/secureSessionStore';
import {cancelEcloProfileRequest, getEcloProfile, RegistrationLoginError, verifyRegistration, type RegisterVerification} from '../core/api/EcloAuthProfileService';
import {mergeEcloProfile, saveStoredProfile} from '../core/matrix/ProfileSettingsService';

type SessionContextValue = {
  state: SessionState;
  signIn: (username: string, password: string, baseUrl?: string) => Promise<void>;
  register: (input: RegisterVerification, baseUrl?: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);
const initialBoot: SessionBootState = {
  stage: 'launching',
  message: 'Đang mở ECLO Chat...',
  progress: 0.08,
};
const RESTORE_RETRY_MS = 3000;

export function SessionProvider({children}: {children: React.ReactNode}) {
  const [state, setState] = useState<SessionState>({status: 'checking', boot: initialBoot});

  const activate = useCallback(async (auth: AuthData) => {
    setState({
      status: 'checking',
      boot: {stage: 'restoring', message: 'Đang khôi phục phiên đăng nhập...', progress: 0.18},
    });
    await nativeMatrixService.startSession(auth, progress => {
      setState({
        status: 'checking',
        boot: {
          stage: progress.stage === 'cache'
            ? 'loading_session'
            : progress.stage === 'restore'
              ? 'restoring'
              : progress.stage === 'crypto'
                ? 'crypto'
                : progress.stage === 'sync'
                  ? 'syncing'
                  : 'ready',
          message: progress.message,
          progress: progress.progress,
        },
      });
    });
    await saveSession(auth);
    setState({status: 'signed_in', auth});
    primeAccountProfile(auth).catch(() => undefined);
  }, []);

  useEffect(() => {
    let mounted = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const restoreSavedSession = async () => {
      if (!mounted) {
        return;
      }
      setState({status: 'checking', boot: {stage: 'loading_session', message: 'Đang kiểm tra phiên đăng nhập...', progress: 0.12}});
      let auth: AuthData | null = null;
      try {
        auth = await loadSession();
      } catch {
        auth = null;
      }
      if (!mounted) {
        return;
      }
      if (!auth) {
        setState({status: 'signed_out'});
        return;
      }
      try {
        await activate(auth);
      } catch (error) {
        if (!mounted) {
          return;
        }
        if (isFatalSessionError(error)) {
          await clearSession().catch(() => undefined);
          setState({status: 'signed_out'});
          return;
        }
        setState({
          status: 'checking',
          boot: {
            stage: 'syncing',
            message: 'Không có kết nối mạng. ECLO Chat sẽ tự thử lại, bạn không cần đăng nhập lại.',
            progress: 0.72,
          },
        });
        retryTimer = setTimeout(restoreSavedSession, RESTORE_RETRY_MS);
      }
    };

    restoreSavedSession();
    return () => {
      mounted = false;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    };
  }, [activate]);

  const value = useMemo<SessionContextValue>(
    () => ({
      state,
      signIn: async (username, password, baseUrl) => {
        const auth = await nativeMatrixService.login(username, password, baseUrl ?? MATRIX_HOMESERVER);
        await saveSession(auth);
        setState({status: 'signed_in', auth});
        primeAccountProfile(auth).catch(() => undefined);
      },
      register: async (input, baseUrl) => {
        await verifyRegistration(input);
        const username = input.username.trim().toLowerCase();
        let auth: AuthData;
        try {
          auth = await nativeMatrixService.login(username, input.password, baseUrl ?? MATRIX_HOMESERVER);
        } catch {
          throw new RegistrationLoginError(username);
        }
        await saveSession(auth);
        setState({status: 'signed_in', auth});
        primeAccountProfile(auth).catch(() => undefined);
      },
      signOut: async () => {
        if (state.status === 'signed_in') {
          cancelEcloProfileRequest(state.auth);
        }
        await nativeMatrixService.stop();
        await matrixClientService.stop();
        await clearSession();
        setState({status: 'signed_out'});
      },
    }),
    [activate, state],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error('useSession must be used inside SessionProvider.');
  }
  return value;
}

async function primeAccountProfile(auth: AuthData): Promise<void> {
  const profile = await getEcloProfile(auth);
  await saveStoredProfile(auth.userId, mergeEcloProfile({}, profile));
}

function isFatalSessionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const lower = message.toLowerCase();
  return lower.includes('m_unknown_token')
    || lower.includes('unknown token')
    || lower.includes('soft logout')
    || lower.includes('access token')
    || lower.includes('token is not')
    || lower.includes('deactivated')
    || lower.includes('user has been deactivated');
}
