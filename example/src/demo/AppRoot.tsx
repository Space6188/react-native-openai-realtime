import React from 'react';
import {SafeAreaView, StatusBar, StyleSheet} from 'react-native';
import {GlobalRealtimeProvider} from '../provider/globalProvider';
import {KitchenSinkRealtimeDemo} from './example';

export default function App() {
  return (
    <GlobalRealtimeProvider>
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" />
        <KitchenSinkRealtimeDemo />
      </SafeAreaView>
    </GlobalRealtimeProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
