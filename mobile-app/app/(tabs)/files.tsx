import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface FileItem {
  name: string;
  type: 'file' | 'directory';
  size: number;
  modified: string;
}

export default function Files() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [currentPath, setCurrentPath] = useState('/');
  const [error, setError] = useState<string | null>(null);

  const fetchFiles = useCallback(async (path: string = '/') => {
    try {
      const nasUrl = await AsyncStorage.getItem('nas_url');
      const sessionId = await AsyncStorage.getItem('session_id');

      if (!nasUrl || !sessionId) {
        setError('No conectado');
        return;
      }

      const response = await fetch(
        `${nasUrl}/api/files/list?path=${encodeURIComponent(path)}`,
        { headers: { 'X-Session-ID': sessionId } }
      );

      if (response.ok) {
        const data = await response.json();
        setFiles(data.files || []);
        setCurrentPath(path);
        setError(null);
      } else {
        setError('Error al cargar archivos');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchFiles('/');
  }, [fetchFiles]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchFiles(currentPath);
  }, [fetchFiles, currentPath]);

  const navigateTo = (item: FileItem) => {
    if (item.type === 'directory') {
      const newPath = currentPath === '/' 
        ? `/${item.name}` 
        : `${currentPath}/${item.name}`;
      setLoading(true);
      fetchFiles(newPath);
    }
  };

  const goUp = () => {
    if (currentPath === '/') return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    const parentPath = '/' + parts.join('/');
    setLoading(true);
    fetchFiles(parentPath || '/');
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0078d4" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Path bar */}
      <View style={styles.pathBar}>
        <TouchableOpacity onPress={goUp} disabled={currentPath === '/'}>
          <Text style={[styles.pathButton, currentPath === '/' && styles.disabled]}>
            ⬆️ Subir
          </Text>
        </TouchableOpacity>
        <Text style={styles.currentPath} numberOfLines={1}>
          📁 {currentPath}
        </Text>
      </View>

      <ScrollView
        style={styles.fileList}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0078d4" />
        }
      >
        {error && <Text style={styles.error}>{error}</Text>}

        {files.map((item, index) => (
          <TouchableOpacity
            key={`${item.name}-${index}`}
            style={styles.fileItem}
            onPress={() => navigateTo(item)}
            activeOpacity={0.7}
          >
            <Text style={styles.fileIcon}>
              {item.type === 'directory' ? '📁' : '📄'}
            </Text>
            <View style={styles.fileInfo}>
              <Text style={styles.fileName} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.fileMeta}>
                {item.type === 'file' ? formatSize(item.size) : 'Carpeta'}
              </Text>
            </View>
            {item.type === 'directory' && (
              <Text style={styles.chevron}>›</Text>
            )}
          </TouchableOpacity>
        ))}

        {files.length === 0 && !error && (
          <Text style={styles.empty}>Carpeta vacía</Text>
        )}
      </ScrollView>
    </View>
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
  pathBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#1a1a2e',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  pathButton: {
    color: '#0078d4',
    fontSize: 14,
    marginRight: 12,
  },
  disabled: {
    color: '#666',
  },
  currentPath: {
    flex: 1,
    color: '#888',
    fontSize: 13,
  },
  fileList: {
    flex: 1,
  },
  error: {
    color: '#ff6b6b',
    padding: 16,
  },
  fileItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  fileIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  fileInfo: {
    flex: 1,
  },
  fileName: {
    color: '#fff',
    fontSize: 15,
  },
  fileMeta: {
    color: '#666',
    fontSize: 12,
    marginTop: 2,
  },
  chevron: {
    color: '#666',
    fontSize: 20,
  },
  empty: {
    color: '#666',
    textAlign: 'center',
    padding: 40,
  },
});
