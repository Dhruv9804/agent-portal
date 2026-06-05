import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.dhruv.agents',
  appName: 'Kanika Agents',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
  },
  android: {
    backgroundColor: '#09090b',
  },
  ios: {
    backgroundColor: '#09090b',
    contentInset: 'automatic',
  },
  plugins: {
    // Show push notifications as a banner even while the app is in the foreground (iOS).
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
  },
};

export default config;
