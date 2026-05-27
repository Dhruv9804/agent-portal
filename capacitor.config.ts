import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kanika.agents',
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
};

export default config;
