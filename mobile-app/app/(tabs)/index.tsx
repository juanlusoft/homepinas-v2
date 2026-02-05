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

interface SystemInfo {
  hostname: string;
  uptime: string;
  cpu: number;
  memory: { used: number; total: number; percent: number };
  temp: number;
}

interface PoolStatus {
  configured: boolean;
  running: boolean;
  poolSize: string;
  poolUsed: string;
  poolFree: string;
}

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [pool, setPool] = useState<PoolStatus | null>(null);
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

      const [sysRes, poolRes] = await Promise.all([
        fetch(`${nasUrl}/api/system/resources`, { headers }),
        fetch(`${nasUrl}/api/storage/pool/status`, { headers }),
      ]);

      if (sysRes.ok) {
        const sysData = await sysRes.json();
        setSystem(sysData);
      }

      if (poolRes.ok) {
        const poolData = await poolRes.json();
        setPool(poolData);
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
    const interval = setInterval(fetchData, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, [fetchData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0078d4" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>⚠️ {error}</Text>
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
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.hostname}>{system?.hostname || 'HomePiNAS'}</Text>
        <Text style={styles.uptime}>⏱️ {system?.uptime || 'N/A'}</Text>
      </View>

      {/* System Stats */}
      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Text style={styles.statIcon}>🖥️</Text>
          <Text style={styles.statValue}>{system?.cpu?.toFixed(1) || 0}%</Text>
          <Text style={styles.statLabel}>CPU</Text>
        </View>

        <View style={styles.statCard}>
          <Text style={styles.statIcon}>🧠</Text>
          <Text style={styles.statValue}>{system?.memory?.percent?.toFixed(0) || 0}%</Text>
          <Text style={styles.statLabel}>RAM</Text>
        </View>

        <View style={styles.statCard}>
          <Text style={styles.statIcon}>🌡️</Text>
          <Text style={[styles.statValue, (system?.temp || 0) > 60 && styles.hot]}>
            {system?.temp?.toFixed(0) || 0}°C
          </Text>
          <Text style={styles.statLabel}>Temp</Text>
        </View>
      </View>

      {/* Storage Pool */}
      {pool && pool.configured && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>💾 Storage Pool</Text>
          <View style={styles.poolInfo}>
            <View style={styles.poolRow}>
              <Text style={styles.poolLabel}>Usado</Text>
              <Text style={styles.poolValue}>{pool.poolUsed}</Text>
            </View>
            <View style={styles.poolRow}>
              <Text style={styles.poolLabel}>Libre</Text>
              <Text style={[styles.poolValue, styles.green]}>{pool.poolFree}</Text>
            </View>
            <View style={styles.poolRow}>
              <Text style={styles.poolLabel}>Total</Text>
              <Text style={styles.poolValue}>{pool.poolSize}</Text>
            </View>
          </View>
          <View style={styles.statusBadge}>
            <Text style={styles.statusText}>
              {pool.running ? '🟢 Online' : '🔴 Offline'}
            </Text>
          </View>
        </View>
      )}

      {/* Quick Actions */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>⚡ Acciones rápidas</Text>
        <Text style={styles.comingSoon}>Próximamente: reiniciar, apagar, sync...</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1a',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f0f1a',
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 16,
  },
  header: {
    padding: 20,
    paddingBottom: 10,
  },
  hostname: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  uptime: {
    fontSize: 14,
    color: '#888',
    marginTop: 4,
  },
  statsGrid: {
    flexDirection: 'row',
    padding: 10,
    gap: 10,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  statIcon: {
    fontSize: 24,
    marginBottom: 8,
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  statLabel: {
    fontSize: 12,
    color: '#888',
    marginTop: 4,
  },
  hot: {
    color: '#ff6b6b',
  },
  card: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    margin: 10,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 12,
  },
  poolInfo: {
    gap: 8,
  },
  poolRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  poolLabel: {
    color: '#888',
    fontSize: 14,
  },
  poolValue: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  green: {
    color: '#10b981',
  },
  statusBadge: {
    marginTop: 12,
    alignSelf: 'flex-start',
  },
  statusText: {
    color: '#fff',
    fontSize: 14,
  },
  comingSoon: {
    color: '#666',
    fontStyle: 'italic',
  },
});
