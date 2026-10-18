const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");
const targetsRoot = path.join(
  packageRoot,
  "node_modules",
  "@bacons",
  "apple-targets",
  "build"
);
const assetContentsPath = path.join(
  packageRoot,
  "node_modules",
  "expo-asset",
  "plugin",
  "build",
  "AssetContents"
);

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(entryPath);
    return entry.isFile() && entry.name.endsWith(".js") ? [entryPath] : [];
  });
}

if (!fs.existsSync(assetContentsPath + ".js") && !fs.existsSync(assetContentsPath + ".cjs")) {
  console.warn("Expo SDK 53 AssetContents module was not found; Apple Targets patch skipped.");
  process.exit(0);
}

for (const filePath of walk(targetsRoot)) {
  let source = fs.readFileSync(filePath, "utf8");
  const oldModule = "@expo/prebuild-config/build/plugins/icons/AssetContents";
  if (!source.includes(oldModule) && !source.includes("expo-asset/plugin/build/AssetContents")) {
    continue;
  }

  const relativeModule = path.relative(path.dirname(filePath), assetContentsPath).split(path.sep).join("/");
  const normalizedRelativeModule = relativeModule.startsWith(".") ? relativeModule : "./" + relativeModule;
  const nextSource = source
    .replaceAll(oldModule, normalizedRelativeModule)
    .replaceAll("../../../../expo-asset/plugin/build/AssetContents", normalizedRelativeModule)
    .replaceAll("../../../../../expo-asset/plugin/build/AssetContents", normalizedRelativeModule)
    .replaceAll("../../../expo-asset/plugin/build/AssetContents", normalizedRelativeModule);

  if (nextSource !== source) {
    fs.writeFileSync(filePath, nextSource);
    console.log(`Patched ${path.relative(packageRoot, filePath)} for Expo SDK 53 compatibility.`);
  }
}
