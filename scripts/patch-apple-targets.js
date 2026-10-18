const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");
const patches = [
  {
    file: "node_modules/@bacons/apple-targets/build/with-widget.js",
    replacements: [
      [
        "@expo/prebuild-config/build/plugins/icons/AssetContents",
        "../../../expo-asset/plugin/build/AssetContents",
      ],
      [
        "../../../../expo-asset/plugin/build/AssetContents",
        "../../../expo-asset/plugin/build/AssetContents",
      ],
    ],
  },
  {
    file: "node_modules/@bacons/apple-targets/build/icon/with-image-asset.js",
    replacements: [
      [
        "@expo/prebuild-config/build/plugins/icons/AssetContents",
        "../../../../expo-asset/plugin/build/AssetContents",
      ],
      [
        "../../../../../expo-asset/plugin/build/AssetContents",
        "../../../../expo-asset/plugin/build/AssetContents",
      ],
    ],
  },
];

for (const patch of patches) {
  const filePath = path.join(packageRoot, patch.file);
  if (!fs.existsSync(filePath)) continue;

  let source = fs.readFileSync(filePath, "utf8");
  let changed = false;

  for (const [from, to] of patch.replacements) {
    if (source.includes(from)) {
      source = source.replaceAll(from, to);
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, source);
    console.log(`Patched ${patch.file} for Expo SDK 53 compatibility.`);
  }
}
