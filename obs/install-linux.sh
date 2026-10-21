#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ -f nareal-obs/bin/64bit/nareal-obs.so ]; then
  binary=nareal-obs/bin/64bit/nareal-obs.so
else
  if ! command -v cmake >/dev/null; then
    echo 'Instale cmake, compilador C++, libobs-dev e qt6-base-dev antes de continuar.' >&2
    exit 1
  fi
  cmake -S plugin -B build -DCMAKE_BUILD_TYPE=Release
  cmake --build build --parallel 2
  binary=build/nareal-obs.so
fi
destination="${XDG_CONFIG_HOME:-$HOME/.config}/obs-studio/plugins/nareal-obs/bin/64bit"
mkdir -p "$destination"
install -m 755 "$binary" "$destination/nareal-obs.so"
echo "Plugin instalado em $destination. Reinicie o OBS e abra Painéis → Na Real."
