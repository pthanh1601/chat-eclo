/**
 * ECLO Chat mobile public configuration.
 */
export const APP_CONFIG = {
  matrix: {
    homeserverUrl: 'https://matrix.5hpc.com',
    jitsiUrl: 'https://jitsi.5hpc.com',
    matrixToBaseUrl: 'https://matrix.to/#',
  },
  ecloApi: {
    baseUrl: 'https://auth.eclo.chat',
    mobileAppHeader: 'X-ECLO-App-Key',
    mobileAppKeys: {
      ios: 'ios-production',
      android: 'android-production',
    },
    profileReadRetryCount: 1,
  },
  auth: {
    passwordMinLength: 6,
    usernameMinLength: 3,
    usernameMaxLength: 32,
    otpMinDigits: 4,
    otpMaxDigits: 10,
  },
  klipy: {
    baseUrl: 'https://api.klipy.com/v2',
    apiKey: 'fk5sKh9rRNy0a2mZlAqbqhlxfdDYqZ28sgCKITxciXPiqZc3nik4gevBZzXgK2cA',
  },
  events: {
    clear: 'org.eclo.clear',
    mute: 'org.eclo.mute',
    profileContacts: 'org.eclo.profile_contacts',
    feedPost: 'org.eclo.feed.post',
    jitsi: 'org.eclo.jitsi',
    jitsiEnd: 'org.eclo.jitsi_end',
    forwarded: 'org.eclo.forwarded',
    reactionKey: 'org.eclo.reaction_key',
    stickerMedia: 'org.eclo.sticker_media',
    mediaBatchId: 'eclo.media_batch_id',
  },
} as const;

export const AUTH_PASSWORD_MIN_LENGTH = APP_CONFIG.auth.passwordMinLength;
export const AUTH_USERNAME_MIN_LENGTH = APP_CONFIG.auth.usernameMinLength;
export const AUTH_USERNAME_MAX_LENGTH = APP_CONFIG.auth.usernameMaxLength;
export const OTP_MIN_DIGITS = APP_CONFIG.auth.otpMinDigits;
export const OTP_MAX_DIGITS = APP_CONFIG.auth.otpMaxDigits;
