/**
 * Android local/EAS build stability patches.
 *
 * react-native-reanimated 4.1.7 links react-native-worklets by hard-coding
 * worklets' old AGP intermediate CMake output path. On some Gradle/AGP runs,
 * worklets only publishes the shared library through Prefab, so reanimated's
 * ninja graph sees libworklets.so as a missing external input.
 *
 * Reanimated 4.3.x fixes this upstream by using the worklets Prefab CMake
 * package. Keep the same narrow patch here until we can upgrade the pair.
 */

const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

function patchReanimatedCMake(cmakePath) {
  if (!fs.existsSync(cmakePath)) {
    const packageRoot = path.dirname(path.dirname(cmakePath));
    const packageHint = fs.existsSync(packageRoot)
      ? 'react-native-reanimated is installed, but android/CMakeLists.txt was not found'
      : 'react-native-reanimated is not installed';
    throw new Error(`[withAndroidBuildStability] ${packageHint}: ${cmakePath}`);
  }

  const source = fs.readFileSync(cmakePath, 'utf8');
  let patched = source;

  if (!patched.includes('find_package(react-native-worklets REQUIRED CONFIG)')) {
    patched = patched.replace(
      'find_package(ReactAndroid REQUIRED CONFIG)\n',
      'find_package(ReactAndroid REQUIRED CONFIG)\nfind_package(react-native-worklets REQUIRED CONFIG)\n',
    );
  }

  patched = patched.replace(
    /\nadd_library\(worklets SHARED IMPORTED\)\n\nset_target_properties\(\n  worklets\n  PROPERTIES\n    IMPORTED_LOCATION\n    "\$\{REACT_NATIVE_WORKLETS_DIR\}\/android\/build\/intermediates\/cmake\/\$\{BUILD_TYPE\}\/obj\/\$\{ANDROID_ABI\}\/libworklets\.so"\n\)\n/,
    '\n',
  );

  patched = patched.replace(
    'target_link_libraries(reanimated log ReactAndroid::jsi fbjni::fbjni android\n                      worklets)',
    'target_link_libraries(reanimated log ReactAndroid::jsi fbjni::fbjni android\n                      react-native-worklets::worklets)',
  );

  const hasPrefabPackage = patched.includes('find_package(react-native-worklets REQUIRED CONFIG)');
  const hasPrefabLink = patched.includes('react-native-worklets::worklets');
  const hasLegacyImport = patched.includes('add_library(worklets SHARED IMPORTED)') ||
    patched.includes('/android/build/intermediates/cmake/${BUILD_TYPE}/obj/${ANDROID_ABI}/libworklets.so');

  if (!hasPrefabPackage || !hasPrefabLink || hasLegacyImport) {
    throw new Error('[withAndroidBuildStability] Failed to patch react-native-reanimated CMakeLists.txt');
  }

  if (patched !== source) {
    fs.writeFileSync(cmakePath, patched);
  }
}

module.exports = function withAndroidBuildStability(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      patchReanimatedCMake(
        path.join(
          cfg.modRequest.projectRoot,
          'node_modules/react-native-reanimated/android/CMakeLists.txt',
        ),
      );
      return cfg;
    },
  ]);
};
