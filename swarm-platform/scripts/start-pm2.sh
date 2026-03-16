#!/bin/bash

# start-pm2.sh - Helper script to start the swarm platform with PM2

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_ROOT="$(dirname "$SCRIPT_DIR")"

echo "Starting swarm platform with PM2..."

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo "PM2 is not installed. Install with: npm install -g pm2"
    exit 1
fi

cd "$PLATFORM_ROOT"

# Start the app using the ecosystem config
pm2 start ecosystem.config.cjs

# Enable PM2 startup at system boot (optional)
echo ""
echo "To enable PM2 auto-startup on system reboot, run:"
echo "  pm2 startup"
echo "  pm2 save"
echo ""
echo "To view logs:"
echo "  pm2 logs swarm-platform"
echo ""
echo "To monitor:"
echo "  pm2 monit"
