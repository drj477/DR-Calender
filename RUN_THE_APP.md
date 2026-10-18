# Run DR-Calender on a real Android device

This guide gets the current app running as a **native development build**. It is not a production release procedure. DR-Calender includes a local native module for alarms/widgets, so Expo Go alone is not a valid runtime test.

## 1. Install the Android toolchain (Windows)

Install Node.js 24 LTS and Android Studio if they are not already installed:

```powershell
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Google.AndroidStudio -e
```

Close and reopen PowerShell after installation. In Android Studio, open **SDK Manager** and install:
- Android SDK Platform 35 (or the platform required by the Expo prebuild output)
- Android SDK Build-Tools 35.x
- Android SDK Platform-Tools
- Android SDK Command-line Tools

In Android Studio's SDK Manager, note the SDK location. The default is usually `$env:LOCALAPPDATA\Android\Sdk`. Android builds need a compatible JDK; Android Studio bundles a runtime under its `jbr` directory. If Gradle cannot find Java, set `JAVA_HOME` to that bundled JDK and reopen the terminal.

Check the tools:

```powershell
node --version
npm --version
java -version
adb --version
```

Expected: Node 24.x, npm available, Java available, and Android platform tools available. If `adb` is not found, add the Android SDK `platform-tools` directory to PATH.

## 2. Prepare the repository

Open PowerShell in the repository root (the folder containing `package.json`):

```powershell
npm ci
npm run typecheck
npx expo export --platform android
```

The first command installs exactly the lockfile versions. The next two are preflight checks; they do not compile the native app. If either fails, stop and fix that failure before continuing.

## 3. Connect a device or start an emulator

**Physical Android device**
1. Enable Developer options and USB debugging on the phone.
2. Connect it over USB and accept the debugging authorization prompt.
3. Run:

```powershell
adb devices
```

The device should appear with status `device`, not `unauthorized`.

**Emulator**
1. Open Android Studio → Device Manager.
2. Create and start an Android emulator.
3. Run `adb devices` and confirm the emulator is listed.

## 4. Build, install, and launch

From the repository root:

```powershell
npm run android:device
```

This runs Expo's native Android build/install flow and may take several minutes on the first run. It generates the native Android project as needed, compiles the custom native module, installs the debug app, and starts the development server. Keep the terminal open while testing.

If Gradle fails, capture the **first actual error** above the final `BUILD FAILED` summary; later errors are often consequences. Do not delete lockfiles or run forced dependency upgrades as a workaround.

For subsequent Metro sessions after the native development build has been installed, use:

```powershell
npx expo start --dev-client
```

Do not use Expo Go to validate the custom alarm/widget bridge.

## 5. First-run smoke test

Use disposable test data first. Record which checks pass and any error text.

- [ ] App opens without a red screen or crash.
- [ ] Create an event, edit it, move it to another date, then delete it.
- [ ] Create a task, edit its due date/priority/checklist, complete it, and restart the app; verify local data persists.
- [ ] Switch Day / Week / Month views and move between dates.
- [ ] Export a backup to a safe test destination. Restore only a test backup after reading the confirmation; restore replaces local app data.
- [ ] Check the Data tab for unexpected database/foreign-key issues.
- [ ] Grant notification permission and test a reminder scheduled a few minutes ahead.
- [ ] If Android exact-alarm access is offered, test both allowed and denied states. Check alarm cancellation after editing/deleting the event and after app restart.
- [ ] Add the Android widget, if available, and check its snapshot refresh and task/event deep links.
- [ ] Test cold-start and warm-start notification/widget deep links.
- [ ] Test offline create/edit/delete and confirm local data remains available.
- [ ] Test Supabase sync only after a separate staging project is configured and migrations are verified; do not use production data for initial tests.

Passing this checklist is a smoke-test result, not a security audit or store-release certification.

## 6. Optional Supabase sync and invitations

Cloud sync is optional for the first local runtime test. To test it, follow [SUPABASE_SETUP.md](SUPABASE_SETUP.md) and [SUPABASE_SECURITY_REVIEW.md](SUPABASE_SECURITY_REVIEW.md). Use a disposable staging project and the project URL plus publishable/anon key in the app. **Never use a service-role key in the mobile app.** Apply migrations in order and verify permissions before testing invitations or real user data.

Email invitation delivery additionally needs the Supabase Edge Function deployed with its trusted secrets. Without that configuration, use the app's share-sheet fallback.

## 7. iOS boundary

An iOS native build requires macOS, Xcode, CocoaPods, and an Apple Developer Team ID for signed device builds. Set `APPLE_TEAM_ID` in the build environment; do not commit it. Follow the native integration notes in [native/README.md](native/README.md). Android success does not establish iOS compilation or WidgetKit correctness.
