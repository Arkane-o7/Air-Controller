#!/bin/bash
# AIR Controller - Server Setup & Launch Script

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$SCRIPT_DIR/server"

echo ""
echo "=================================="
echo "   AIR Controller - Setup"
echo "=================================="
echo ""

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "ERROR: Python 3 is required but not installed."
    echo "Install from: https://www.python.org/downloads/"
    exit 1
fi

PYTHON_VERSION=$(python3 --version 2>&1)
echo "Found: $PYTHON_VERSION"

# Create virtual environment if needed
if [ ! -d "$SERVER_DIR/venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv "$SERVER_DIR/venv"
fi

# Activate virtual environment
source "$SERVER_DIR/venv/bin/activate"

# Install dependencies
echo "Installing dependencies..."
pip install -r "$SERVER_DIR/requirements.txt" --quiet

echo ""
echo "Setup complete! Starting server..."
echo ""

# Run server
python3 "$SERVER_DIR/server.py"
