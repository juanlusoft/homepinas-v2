import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function Login() {
  const [nasUrl, setNasUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'connect' | 'login'>('connect');

  async function handleConnect() {
    if (!nasUrl.trim()) {
      Alert.alert('Error', 'Introduce la IP del NAS');
      return;
    }

    setLoading(true);
    
    let url = nasUrl.trim();
    if (!url.startsWith('http')) {
      url = `http://${url}`;
    }
    if (!url.includes(':')) {
      url = `${url}:3001`;
    }

    try {
      const response = await fetch(`${url}/api/system/info`, { 
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });
      
      if (response.ok) {
        const data = await response.json();
        await AsyncStorage.setItem('nas_url', url);
        setNasUrl(url);
        setStep('login');
        Alert.alert('✅ Conectado', `NAS: ${data.hostname || 'HomePiNAS'}`);
      } else {
        Alert.alert('Error', 'No se pudo conectar al NAS');
      }
    } catch (e: any) {
      Alert.alert('Error de conexión', `No se puede alcanzar ${url}\n\n¿Estás en la misma red WiFi?`);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin() {
    if (!username.trim() || !password.trim()) {
      Alert.alert('Error', 'Introduce usuario y contraseña');
      return;
    }

    setLoading(true);
    
    try {
      const savedUrl = await AsyncStorage.getItem('nas_url');
      const response = await fetch(`${savedUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (data.success) {
        await AsyncStorage.setItem('session_id', data.sessionId);
        await AsyncStorage.setItem('csrf_token', data.csrfToken);
        await AsyncStorage.setItem('username', data.user?.username || username);
        router.replace('/(tabs)');
      } else if (data.requires2FA) {
        Alert.alert('2FA', '2FA no está soportado aún en la app');
      } else {
        Alert.alert('Error', data.message || 'Credenciales incorrectas');
      }
    } catch (e: any) {
      Alert.alert('Error', `Login fallido: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <View style={styles.card}>
        <Text style={styles.logo}>🏠</Text>
        <Text style={styles.title}>HomePiNAS</Text>
        <Text style={styles.subtitle}>
          {step === 'connect' ? 'Conectar al NAS' : 'Iniciar sesión'}
        </Text>

        {step === 'connect' ? (
          <>
            <TextInput
              style={styles.input}
              placeholder="IP del NAS (ej: 192.168.1.100)"
              placeholderTextColor="#666"
              value={nasUrl}
              onChangeText={setNasUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleConnect}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Conectar</Text>
              )}
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TextInput
              style={styles.input}
              placeholder="Usuario"
              placeholderTextColor="#666"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TextInput
              style={styles.input}
              placeholder="Contraseña"
              placeholderTextColor="#666"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleLogin}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Entrar</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.linkButton}
              onPress={() => setStep('connect')}
            >
              <Text style={styles.linkText}>← Cambiar NAS</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1a',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  logo: {
    fontSize: 48,
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#0078d4',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#888',
    marginBottom: 24,
  },
  input: {
    width: '100%',
    backgroundColor: '#0f0f1a',
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    color: '#fff',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#333',
  },
  button: {
    width: '100%',
    backgroundColor: '#0078d4',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  linkButton: {
    marginTop: 16,
  },
  linkText: {
    color: '#0078d4',
    fontSize: 14,
  },
});
