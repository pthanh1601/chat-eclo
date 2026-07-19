import React from 'react';
import {LogBox} from 'react-native';
import {AppSafeAreaProvider} from './platform/safeArea';
import {AppSettingsProvider} from './context/AppSettingsContext';
import {SessionProvider} from './context/SessionContext';
import {RootNavigator} from './navigation/RootNavigator';
import {CallOverlay} from './components/call/CallOverlay';
import {SecurityVerificationOverlay} from './components/SecurityVerificationOverlay';

LogBox.ignoreAllLogs();

export default function App() {
  return (
    <AppSafeAreaProvider>
      <AppSettingsProvider>
        <SessionProvider>
          <RootNavigator />
          <SecurityVerificationOverlay />
          <CallOverlay />
        </SessionProvider>
      </AppSettingsProvider>
    </AppSafeAreaProvider>
  );
}
