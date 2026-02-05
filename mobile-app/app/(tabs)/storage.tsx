import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface Disk {
  id: string;
  model: string;
  size: string;
  type: string;
  temp: number;
  serial: string;
  usage: number;
}

export default function Storage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [disks, setDisks] = useState<Disk[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const nasUrl = await AsyncStorage.getItem('nas_url');
      const sessionId = await AsyncStorage.getItem('session_id');

      if (!nasUrl || !sessionId) {
        setError('No conectado');
        return;
      }

      const response = await fetch(`${nasUrl}/api/storage/disks`, {
        headers: { 'X-Session-ID': sessionId },
      });

      if (response.ok) {
        const data = await response.json();
        setDisks(data);
        setError(null);
      } else {
        setError('Error al cargar discos');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  const getTempColor = (temp: number) => {
    if (temp > 50) return '#ff6b6b';
    if (temp > 40) return '#fbbf24';
    return '#10b981';
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
      <Text style={styles.title}>💾 Discos ({disks.length})</Text>

      {error && <Text style={styles.error}>{error}</Text>}

      {disks.map((disk) => (
        <View key={disk.id} style={styles.diskCard}>
          <View style={styles.diskHeader}>
            <View>
              <Text style={styles.diskModel}>{disk.model || 'Unknown'}</Text>
              <Text style={styles.diskInfo}>
                {disk.id} • {disk.type} • {disk.size}
              </Text>
            </View>
            <View style={[styles.tempBadge, { backgroundColor: getTempColor(disk.temp || 0) + '20' }]}>
              <Text style={[styles.tempText, { color: getTempColor(disk.temp || 0) }]}>
                🌡️ {disk.temp || 0}°C
              </Text>
            </View>
          </View>

          {/* Usage bar */}
          <View style={styles.usageContainer}>
            <View style={styles.usageBar}>
              <View
                style={[
                  styles.usageFill,
                  { width: `${disk.usage || 0}%` },
                  (disk.usage || 0) > 90 && styles.usageHigh,
                ]}
              />
            </View>
            <Text style={styles.usageText}>{disk.usage || 0}% usado</Text>
          </View>

          <Text style={styles.serial}>SN: {disk.serial || 'N/A'}</Text>
        </View>
      ))}

      {disks.length === 0 && !error && (
        <Text style={styles.empty}>No hay discos configurados</Text>
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
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 16,
  },
  error: {
    color: '#ff6b6b',
    marginBottom: 16,
  },
  diskCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  diskHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  diskModel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  diskInfo: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  tempBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  tempText: {
    fontSize: 12,
    fontWeight: '500',
  },
  usageContainer: {
    marginBottom: 8,
  },
  usageBar: {
    height: 6,
    backgroundColor: '#333',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 4,
  },
  usageFill: {
    height: '100%',
    backgroundColor: '#0078d4',
    borderRadius: 3,
  },
  usageHigh: {
    backgroundColor: '#ff6b6b',
  },
  usageText: {
    fontSize: 12,
    color: '#888',
  },
  serial: {
    fontSize: 11,
    color: '#666',
    fontFamily: 'monospace',
  },
  empty: {
    color: '#666',
    textAlign: 'center',
    marginTop: 40,
  },
});
