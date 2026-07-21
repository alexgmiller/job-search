import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { fetchUnseenListings, markSeen, type JobListing } from './lib/listings';
import { registerForPushNotifications } from './lib/notifications';

// Show notifications even while the app is foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export default function App() {
  const [listings, setListings] = useState<JobListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setListings(await fetchUnseenListings());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load listings');
    }
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
    registerForPushNotifications().catch((e) =>
      console.warn('Push registration failed:', e)
    );

    // Tapping a notification re-fetches so the new listing is on screen.
    const sub = Notifications.addNotificationResponseReceivedListener(() => load());
    return () => sub.remove();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const dismiss = useCallback(async (id: string) => {
    // Optimistic: remove locally, restore on failure.
    setListings((prev) => prev.filter((l) => l.id !== id));
    try {
      await markSeen(id);
    } catch {
      setError('Could not mark listing as seen — pull to refresh.');
    }
  }, []);

  const openListing = useCallback((listing: JobListing) => {
    if (listing.url) Linking.openURL(listing.url).catch(() => {});
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <Text style={styles.header}>New Listings</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      {loading ? (
        <ActivityIndicator style={styles.spinner} size="large" />
      ) : (
        <FlatList
          data={listings}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListEmptyComponent={
            <Text style={styles.empty}>No unseen listings. Pull to refresh.</Text>
          }
          renderItem={({ item }) => (
            <Pressable style={styles.card} onPress={() => openListing(item)}>
              <View style={styles.cardBody}>
                <Text style={styles.role}>{item.role}</Text>
                <Text style={styles.company}>{item.company}</Text>
                <Text style={styles.meta}>
                  {[item.location, new Date(item.found_at).toLocaleDateString()]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              <Pressable
                style={styles.dismissButton}
                hitSlop={8}
                onPress={() => dismiss(item.id)}
              >
                <Text style={styles.dismissText}>✕</Text>
              </Pressable>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f7f9', paddingTop: 64 },
  header: {
    fontSize: 28,
    fontWeight: '700',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  error: {
    color: '#b00020',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  spinner: { marginTop: 48 },
  empty: { textAlign: 'center', marginTop: 48, color: '#666' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 14,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardBody: { flex: 1 },
  role: { fontSize: 16, fontWeight: '600' },
  company: { fontSize: 14, color: '#333', marginTop: 2 },
  meta: { fontSize: 12, color: '#777', marginTop: 4 },
  dismissButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#eee',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  dismissText: { color: '#555', fontSize: 14 },
});
