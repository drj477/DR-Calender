const { withAndroidManifest, withEntitlementsPlist } = require("@expo/config-plugins");

const APP_GROUP = "group.com.drj477.drcalender";

function withDRCalenderNative(config) {
  config = withAndroidManifest(config, config => {
    const manifest = config.modResults.manifest;
    manifest["uses-permission"] = manifest["uses-permission"] || [];
    const hasExactAlarm = manifest["uses-permission"].some(
      item => item.$?.["android:name"] === "android.permission.SCHEDULE_EXACT_ALARM"
    );
    if (!hasExactAlarm) {
      manifest["uses-permission"].push({ $: { "android:name": "android.permission.SCHEDULE_EXACT_ALARM" } });
    }
    return config;
  });

  config = withEntitlementsPlist(config, config => {
    const groups = config.modResults["com.apple.security.application-groups"] || [];
    if (!groups.includes(APP_GROUP)) groups.push(APP_GROUP);
    config.modResults["com.apple.security.application-groups"] = groups;
    return config;
  });

  return config;
}

module.exports = withDRCalenderNative;
