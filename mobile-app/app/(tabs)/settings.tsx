import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function Settings() {
  const [nasUrl, setNasUrl] = useState('');
  const [username, setUsername] = useState('');

  useEffect(() => {
    loadInfo();
  }, []);

  async function loadInfo() {
    const url = await AsyncStorage.getItem('nas_url');
    const user = await AsyncStorage.getItem('username');
    setNasUrl(url || '');
    setUsername(user || '');
  }

  async function handleLogout() {
    Alert.alert(
      'Cerrar sesión',
      '¿Seguro que quieres desconectarte del NAS?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Desconectar',
          style: 'destructive',
          onPress: async () => {
            try {
              const url = await AsyncStorage.getItem('nas_url');
              const sessionId = await AsyncStorage.getItem('session_id');
              
              // Try to logout on server
              if (url && sessionId) {
                await fetch(`${url}/api/auth/logout`, {
                  method: 'POST',
                  headers: { 'X-Session-ID': sessionId },
                }).catch(() => {});
              }
            } finally {
              // Clear local storage
              await AsyncStorage.multiRemove([
                'nas_url',
                'session_id',
                'csrf_token',
                'username',
              ]);
              router.replace('/login');
            }
          },
        },
      ]
    );
  }

  return (
    <ScrollView style={styles.container}>
      {/* Connection Info */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>🔗 Conexión</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>NAS</Text>
            <Text style={styles.value}>{nasUrl || 'No conectado'}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Usuario</Text>
            <Text style={styles.value}>{username || '-'}</Text>
          </View>
        </View>
      </View>

      {/* App Info */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>📱 App</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>Versión</Text>
            <Text style={styles.value}>1.0.0 MVP</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Build</Text>
            <Text style={styles.value}>Expo SDK 54</Text>
          </View>
        </View>
      </View>

      {/* Coming Soon */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>🚀 Próximamente</Text>
        <View style={styles.card}>
          <Text style={styles.feature}>• Push notifications</Text>
          <Text style={styles.feature}>• Subir archivos desde el móvil</Text>
          <Text style={styles.feature}>• VPN integrada (Tailscale)</Text>
          <Text style={styles.feature}>• Widget de inicio</Text>
          <Text style={styles.feature}>• Multi-NAS</Text>
        </View>
      </View>

      {/* Actions */}
      <View style={styles.section}>
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutText}>🚪 Cerrar sesión</Text>
        </TouchableOpacity>
      </View>

      {/* Footer */}
      <Text style={styles.footer}>
        HomePiNAS Mobile{'\n'}
        © 2026 homelabs.club
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1a',
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#888',
    marginBottom: 8,
  },
  card: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  label: {
    color: '#888',
    fontSize: 14,
  },
  value: {
    color: '#fff',
    fontSize: 14,
  },
  feature: {
    color: '#666',
    fontSize: 14,
    paddingVertical: 4,
  },
  logoutButton: {
    backgroundColor: '#ff6b6b20',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ff6b6b40',
  },
  logoutText: {
    color: '#ff6b6b',
    fontSize: 16,
    fontWeight: '600',
  },
  footer: {
    color: '#444',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 20,
    marginBottom: 40,
  },
});
