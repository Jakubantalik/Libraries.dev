import './errorHandler';
import { registerRootComponent } from 'expo';

import App from './App';

// Surface early JS errors with their stack in the native log (Release
// builds only print the message). Harmless in development.
const ErrorUtils = (global as unknown as { ErrorUtils?: { getGlobalHandler?: () => ((e: Error, fatal?: boolean) => void) | undefined; setGlobalHandler?: (h: (e: Error, fatal?: boolean) => void) => void } }).ErrorUtils;
const previous = ErrorUtils?.getGlobalHandler?.();
ErrorUtils?.setGlobalHandler?.((e, fatal) => {
  console.log(`MFX_ERR fatal=${fatal} ${e?.message}\n${e?.stack}`);
  previous?.(e, fatal);
});

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
