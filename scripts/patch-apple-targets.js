const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");
const patches = [
  {
    file: "node_modules/@bacons/apple-targets/build/with-widget.js",
    from: "@expo/prebuild-config/build/plugins/icons/AssetContents",
    to: "../../../../expo-asset/plugin/build/AssetContents",
  },
  {
    file: "node_modules/@bacons/apple-targets/build/icon/withImageAsset.js",
    from: "@expo/prebuild-config/build/plugins/icons/AssetContents",
    to: "../../../../../expo-asset/plugin/build/AssetContents",
  },
];

for (const patch of patches) {
  const filePath = path.join(packageRoot, patch.file);
  if (!fs.existsSync(filePath)) continue;

  const source = fs.readFileSync(filePath, "utf8");
  if (!source.includes(patch.from)) continue;

  fs.writeFileSync(filePath, source.replaceAll(patch.from, patch.to));
  console.log(`Patched ${patch.file} for Expo SDK 53 compatibility.`);
}
