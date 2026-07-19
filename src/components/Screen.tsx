import React from 'react';
import {StyleSheet, View} from 'react-native';

export function Screen({children}: {children: React.ReactNode}) {
  return <View style={styles.screen}>{children}</View>;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f7f8fb',
    padding: 16,
  },
});
