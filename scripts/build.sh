#!/bin/bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$root/build}"
mkdir -p "$out"
out="$(cd "$out" && pwd)"
app="$out/mailboxd.app"
stage="$(mktemp -d "${TMPDIR:-/tmp}/mailboxd-build.XXXXXX")"
trap 'rm -rf "$stage"' EXIT

host="$stage/mailboxd.app/Contents"
extension="$host/PlugIns/mailboxd-extension.appex/Contents"
mkdir -p "$host/MacOS" "$host/Resources" "$extension/MacOS" "$extension/Resources"
cp "$root/native/App-Info.plist" "$host/Info.plist"
cp "$root/native/Extension-Info.plist" "$extension/Info.plist"
cp "$root/native/read-mail.js" "$host/Resources/"
cp -R "$root/extension/." "$extension/Resources/"

target="$(uname -m)-apple-macos14.0"
export CLANG_MODULE_CACHE_PATH="$out/ModuleCache.noindex"
sign_args=(--force --sign "${MAILBOXD_SIGN_IDENTITY:--}")
if [[ "${MAILBOXD_SIGN_IDENTITY:--}" != "-" ]]; then sign_args+=(--options runtime); fi
xcrun swiftc -target "$target" -module-name Mailboxd -O \
  "$root/native/App.swift" "$root/native/Feed.swift" -o "$host/MacOS/mailboxd"
xcrun swiftc -target "$target" -module-name MailboxdExtension -O -application-extension \
  "$root/native/ExtensionMain.swift" "$root/native/SafariWebExtensionHandler.swift" \
  "$root/native/Feed.swift" -o "$extension/MacOS/mailboxd-extension"

xattr -cr "${host%/Contents}"
codesign "${sign_args[@]}" --entitlements "$root/native/Extension.entitlements" "${extension%/Contents}"
xattr -cr "${host%/Contents}"
codesign "${sign_args[@]}" --entitlements "$root/native/App.entitlements" "${host%/Contents}"
codesign --verify --deep --strict "${host%/Contents}"

if [[ -e "$app" ]]; then mv "$app" "$stage/previous.app"; fi
mv "${host%/Contents}" "$app"
xattr -cr "$app"
codesign --verify --deep --strict "$app"
printf '%s\n' "$app"
