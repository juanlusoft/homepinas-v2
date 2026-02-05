import { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function Index() {
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    try {
      const sessionId = await AsyncStorage.getItem('session_id');
      const nasUrl = await AsyncStorage.getItem('nas_url');
      
      if (sessionId && nasUrl) {
        // Verify session is still valid
        const response = await fetch(`${nasUrl}/api/auth/verify-session`, {
          method: 'POST',
          headers: { 'X-Session-ID': sessionId },
        });
        
        if (response.ok) {
          router.replace('/(tabs)');
          return;
        }
      }
      
      router.replace('/login');
    } catch (e) {
      router.replace('/login');
    } finally {
      setChecking(false);
    }
  }

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#0078d4" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f0f1a',
  },
});
