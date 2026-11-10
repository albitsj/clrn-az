#!/usr/bin/env bash
# 远端清单获取和镜像下载分别限时；重试不能被第一次 --licenses 永久阻塞。
set -euo pipefail

sdk_dir="${ANDROID_HOME:?ANDROID_HOME is required}"
sdk_manager="$sdk_dir/cmdline-tools/latest/bin/sdkmanager"
image_dir="$sdk_dir/system-images/android-35/google_apis/x86_64"

prepare_image() {
  (yes || true) | timeout --kill-after=10s 120s "$sdk_manager" --licenses > /dev/null || return "$?"
  sdk_install_failed=1
  timeout --kill-after=10s 600s "$sdk_manager" --install 'system-images;android-35;google_apis;x86_64' &&
    test -f "$image_dir/system.img"
}

for attempt in 1 2 3; do
  printf 'Android SDK preparation attempt %s/3\n' "$attempt"
  sdk_install_failed=0
  if prepare_image; then exit 0; else status=$?; fi
  printf 'Android SDK preparation failed: attempt=%s status=%s\n' "$attempt" "$status" >&2
  if [ "$attempt" = 3 ]; then exit "$status"; fi
  # 只有已进入安装的失败才删除未完成镜像；授权获取失败不破坏已安装镜像。
  if [ "$sdk_install_failed" = 1 ]; then rm -rf "$image_dir"; fi
  rm -rf "$sdk_dir/.temp" "${ANDROID_USER_HOME:-$HOME/.android}/cache"
  sleep 5
done
