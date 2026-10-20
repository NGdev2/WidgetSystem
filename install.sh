#!/usr/bin/env bash
# Installs `widgetctl` into ~/.local/bin and starts WidgetSystem at login.
set -euo pipefail
REPO="$(cd "$(dirname "$0")" && pwd)"
mkdir -p ~/.local/bin ~/.config/autostart
ln -sf "$REPO/bin/widgetctl" ~/.local/bin/widgetctl
cat > ~/.config/autostart/widgetsystem.desktop <<DESK
[Desktop Entry]
Type=Application
Name=WidgetSystem
Comment=Desktop widgets
Exec=sh -c 'sleep 3; cd "$REPO" && exec python3 -m widgetsystem'
X-GNOME-Autostart-enabled=true
NoDisplay=true
DESK
echo "Installed. widgetctl is in ~/.local/bin; WidgetSystem starts at login."
echo "Tip: bind a GNOME shortcut (Settings > Keyboard > Custom) to: widgetctl edit"
