# Updater release procedure

Quantum Leap uses Tauri's updater signature in addition to the operating-system code signature. The updater private key must never be committed or included in a release asset.

## One-time setup

1. Keep the updater private key in a protected location outside the repository and maintain an offline backup. Losing it prevents existing installations from accepting future updates.
2. Add the complete private-key content as the repository Actions secret `TAURI_SIGNING_PRIVATE_KEY`.
3. The matching public key is stored in `src-tauri/tauri.conf.json` and is safe to distribute.

## Build release artifacts

For Linux, manually dispatch the **Cross-platform desktop builds** workflow from the release tag and enable `release_build`. The workflow signs the updater artifacts and includes each `.sig` file in its uploaded build artifact. The Windows job always produces an unsigned portable ZIP; Windows updates open the GitHub Release page instead of using Tauri's installer updater.

Build the Universal 2 macOS release in a logged-in GUI session with the updater key available outside the repository. The resulting application contains both `arm64` and `x86_64` executables:

```sh
TAURI_SIGNING_PRIVATE_KEY=~/.tauri/quantum-leap.key \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
  npm run tauri:build:macos-universal -- --bundles app,dmg --config src-tauri/tauri.updater.conf.json
```

This preserves the custom DMG layout and also creates the signed `.app.tar.gz` updater artifact. Before assembling the release, verify the app's main executable with `lipo -archs` and require both `x86_64` and `arm64`; then complete the normal DMG, metadata, code-signature, and notarization checks.

## Assemble `latest.json`

Place the final, renamed updater artifacts and matching `.sig` files in one directory. The required names for version `X.Y.Z` are:

```text
Quantum-Leap_X.Y.Z_macOS_universal.app.tar.gz
Quantum-Leap_X.Y.Z_macOS_universal.app.tar.gz.sig
Quantum-Leap_X.Y.Z_Linux_x86_64.AppImage
Quantum-Leap_X.Y.Z_Linux_x86_64.AppImage.sig
Quantum-Leap_X.Y.Z_Linux_aarch64.AppImage
Quantum-Leap_X.Y.Z_Linux_aarch64.AppImage.sig
```

Generate the manifest after synchronizing the version in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`:

```sh
npm run release:updater-manifest -- \
  --version X.Y.Z \
  --assets release \
  --notes docs/release-notes/vX.Y.Z.md
```

The manifest publishes the same Universal 2 updater artifact for both Tauri targets, `darwin-aarch64` and `darwin-x86_64`, so existing Apple Silicon installations and Intel Macs follow the same signed update channel.

Upload `latest.json`, updater artifacts, signatures, distribution packages (including `Quantum-Leap_X.Y.Z_Windows_x64_portable.zip`), and SHA-256 manifests to the same draft GitHub Release. Publish only after verifying that every URL in `latest.json` is publicly downloadable.

The first release containing the updater is a bootstrap release and must still be installed manually. In-app installation works for later macOS and Linux AppImage releases. Windows portable and Linux DEB builds intentionally open the Release page instead of replacing files directly.
