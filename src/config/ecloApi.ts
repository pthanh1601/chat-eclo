import {Platform} from 'react-native';
import {APP_CONFIG} from './appConfig';

export const ECLO_API_BASE_URL = cleanUrl(APP_CONFIG.ecloApi.baseUrl);
export const ECLO_MOBILE_APP_HEADER = APP_CONFIG.ecloApi.mobileAppHeader;
export const ECLO_PROFILE_READ_RETRY_COUNT = APP_CONFIG.ecloApi.profileReadRetryCount;
export const ECLO_MOBILE_APP_KEY = Platform.OS === 'ios'
  ? APP_CONFIG.ecloApi.mobileAppKeys.ios
  : APP_CONFIG.ecloApi.mobileAppKeys.android;

function cleanUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}
