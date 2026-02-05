import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface BackupDevice {
  id: string;
  name: string;
  type: 'file' | 'image';
  os: string;
  lastBackup: string | null;
  nextBackup: string | null;
  status: 'idle' | 'running' | 'error';
  versions: number;
}

export default function Backup() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [devices, setDevices] = useState<BackupDevice[]>([]);
  const [pendingAgents, setPendingAgents] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const nasUrl = await AsyncStorage.getItem('nas_url');
      const sessionId = await AsyncStorage.getItem('session_id');

      if (!nasUrl || !sessionId) {
        setError('No conectado');
        return;
      }

      const headers = { 'X-Session-ID': sessionId };

      const [devRes, pendingRes] = await Promise.all([
        fetch(`${nasUrl}/api/active-backup/devices`, { headers }),
        fetch(`${nasUrl}/api/active-backup/agent/pending`, { headers }),
      ]);

      if (devRes.ok) {
        const data = await devRes.json();
        setDevices(data.devices || []);
      }

      if (pendingRes.ok) {
        const data = await pendingRes.json();
        setPendingAgents(data.pending || []);
      }

      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [fetchData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  const triggerBackup = async (deviceId: string, deviceName: string) => {
    Alert.alert(
      'Iniciar backup',
      `¿Ejecutar backup de ${deviceName} ahora?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Ejecutar',
          onPress: async () => {
            try {
              const nasUrl = await AsyncStorage.getItem('nas_url');
              const sessionId = await AsyncStorage.getItem('session_id');
              const csrfToken = await AsyncStorage.getItem('csrf_token');

              const response = await fetch(
                `${nasUrl}/api/active-backup/devices/${deviceId}/backup`,
                {
                  method: 'POST',
                  headers: {
                    'X-Session-ID': sessionId!,
                    'X-CSRF-Token': csrfToken!,
                  },
                }
              );

              if (response.ok) {
                Alert.alert('✅ Éxito', 'Backup iniciado');
                fetchData();
              } else {
                const data = await response.json();
                Alert.alert('Error', data.error || 'No se pudo iniciar el backup');
              }
            } catch (e: any) {
              Alert.alert('Error', e.message);
            }
          },
        },
      ]
    );
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running': return '🔄';
      case 'error': return '❌';
      default: return '✅';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return '#0078d4';
      case 'error': return '#ff6b6b';
      default: return '#10b981';
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0078d4" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0078d4" />
      }
    >
      {/* Pending Agents */}
      {pendingAgents.length > 0 && (
        <View style={styles.pendingSection}>
          <Text style={styles.sectionTitle}>⏳ Agentes pendientes</Text>
          {pendingAgents.map((agent) => (
            <View key={agent.deviceId} style={styles.pendingCard}>
              <Text style={styles.pendingName}>{agent.hostname || 'Dispositivo'}</Text>
              <Text style={styles.pendingInfo}>{agent.os} • {agent.ip}</Text>
              <Text style={styles.pendingHint}>Aprueba desde el dashboard web</Text>
            </View>
          ))}
        </View>
      )}

      {/* Devices */}
      <Text style={styles.sectionTitle}>🔄 Dispositivos ({devices.length})</Text>

      {error && <Text style={styles.error}>{error}</Text>}

      {devices.map((device) => (
        <TouchableOpacity
          key={device.id}
          style={styles.deviceCard}
          onPress={() => triggerBackup(device.id, device.name)}
          activeOpacity={0.7}
        >
          <View style={styles.deviceHeader}>
            <View style={styles.deviceInfo}>
              <Text style={styles.deviceName}>{device.name}</Text>
              <Text style={styles.deviceMeta}>
                {device.os} • {device.type === 'image' ? '💿 Imagen' : '📁 Archivos'}
              </Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: getStatusColor(device.status) + '20' }]}>
              <Text style={{ color: getStatusColor(device.status) }}>
                {getStatusIcon(device.status)} {device.status}
              </Text>
            </View>
          </View>

          <View style={styles.deviceStats}>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Último</Text>
              <Text style={styles.statValue}>
                {device.lastBackup ? new Date(device.lastBackup).toLocaleDateString() : 'Nunca'}
              </Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Versiones</Text>
              <Text style={styles.statValue}>{device.versions || 0}</Text>
            </View>
          </View>

          <Text style={styles.tapHint}>Toca para ejecutar backup</Text>
        </TouchableOpacity>
      ))}

      {devices.length === 0 && !error && (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No hay dispositivos configurados</Text>
          <Text style={styles.emptyHint}>
            Instala el agente de backup en tus equipos para empezar
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1a',
    padding: 16,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f0f1a',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 12,
    marginTop: 8,
  },
  error: {
    color: '#ff6b6b',
    marginBottom: 16,
  },
  pendingSection: {
    marginBottom: 16,
  },
  pendingCard: {
    backgroundColor: '#2d2a00',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#fbbf24',
  },
  pendingName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fbbf24',
  },
  pendingInfo: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  pendingHint: {
    fontSize: 11,
    color: '#666',
    marginTop: 6,
    fontStyle: 'italic',
  },
  deviceCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  deviceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  deviceMeta: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  deviceStats: {
    flexDirection: 'row',
    gap: 24,
    marginBottom: 8,
  },
  stat: {},
  statLabel: {
    fontSize: 11,
    color: '#666',
  },
  statValue: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '500',
  },
  tapHint: {
    fontSize: 11,
    color: '#0078d4',
    textAlign: 'center',
    marginTop: 4,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    color: '#888',
    fontSize: 16,
  },
  emptyHint: {
    color: '#666',
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },
});
