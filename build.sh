#!/usr/bin/env bash
# ==============================================================================
# build.sh - Single-command build script for Projectile Motion Calculator WASM
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Building Projectile Motion Physics Core (WebAssembly) ==="

# Check if emcc is on PATH
if ! command -v emcc &> /dev/null; then
    echo "emcc not found in PATH. Checking for Emscripten SDK..."

    EMSDK_DIR=""
    # Check common emsdk locations
    if [ -n "$EMSDK" ] && [ -d "$EMSDK" ]; then
        EMSDK_DIR="$EMSDK"
    elif [ -d "$HOME/emsdk" ]; then
        EMSDK_DIR="$HOME/emsdk"
    elif [ -d "/c/Users/$USER/emsdk" ]; then
        EMSDK_DIR="/c/Users/$USER/emsdk"
    elif [ -d "C:/Users/Aditi Pant/emsdk" ]; then
        EMSDK_DIR="C:/Users/Aditi Pant/emsdk"
    elif [ -d "$SCRIPT_DIR/emsdk" ]; then
        EMSDK_DIR="$SCRIPT_DIR/emsdk"
    fi

    # Install emsdk if not found
    if [ -z "$EMSDK_DIR" ] || [ ! -d "$EMSDK_DIR" ]; then
        echo "Emscripten SDK not found. Installing to $HOME/emsdk..."
        git clone --depth 1 https://github.com/emscripten-core/emsdk.git "$HOME/emsdk"
        EMSDK_DIR="$HOME/emsdk"
        cd "$EMSDK_DIR"
        ./emsdk install latest
        ./emsdk activate latest
        cd "$SCRIPT_DIR"
    fi

    echo "Activating Emscripten environment from $EMSDK_DIR..."
    if [ -f "$EMSDK_DIR/emsdk_env.sh" ]; then
        # shellcheck disable=SC1091
        source "$EMSDK_DIR/emsdk_env.sh"
    elif [ -f "$EMSDK_DIR/emsdk_env.bat" ]; then
        # On Windows git bash
        export PATH="$EMSDK_DIR:$EMSDK_DIR/upstream/emscripten:$EMSDK_DIR/node/current/bin:$PATH"
    fi
fi

# Re-check emcc
if ! command -v emcc &> /dev/null; then
    echo "ERROR: Unable to locate or initialize 'emcc'. Please ensure Emscripten is installed."
    exit 1
fi

echo "Using $(emcc --version | head -n 1)"

# Ensure public output directory exists
mkdir -p public

echo "Compiling src/projectile.c -> public/projectile.js + public/projectile.wasm..."

emcc src/projectile.c -O2 -o public/projectile.js \
  -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","getValue"]' \
  -s EXPORTED_FUNCTIONS='["_compute","_position","_malloc","_free"]' \
  -s MODULARIZE=1 -s EXPORT_NAME=createModule

if [ -f "public/projectile.js" ] && [ -f "public/projectile.wasm" ]; then
    echo "Build SUCCESSFUL!"
    echo "  - Generated public/projectile.js ($(wc -c < public/projectile.js | tr -d ' ') bytes)"
    echo "  - Generated public/projectile.wasm ($(wc -c < public/projectile.wasm | tr -d ' ') bytes)"
else
    echo "ERROR: Build failed - output files were not generated."
    exit 1
fi
