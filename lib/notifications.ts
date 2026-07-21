import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

/**
 * Requests notification permission, fetches the Expo push token for this
 * device, and upserts it into the `push_tokens` table so the backend job
 * can send to it. Returns the token, or null when push isn't available
 * (simulator/emulator, permission denied).
 */
export async function registerForPushNotifications(): Promise<string | null> {
  // Push tokens only exist on real hardware.
  if (!Device.isDevice) {
    console.warn('Push notifications require a physical device — skipping registration.');
    return null;
  }

  // Android: a channel must exist before any notification can be shown.
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'New job listings',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    console.warn('Notification permission not granted — no push token registered.');
    return null;
  }

  // getExpoPushTokenAsync needs the EAS project id; it is injected into the
  // app config by `npx eas init`.
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) {
    throw new Error('No EAS projectId found in app config — run `npx eas init` once.');
  }

  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  console.log('Expo push token:', token); // paste into https://expo.dev/notifications to test

  const { error } = await supabase.from('push_tokens').upsert(
    {
      token,
      platform: Platform.OS,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'token' }
  );
  if (error) throw error;

  return token;
}
