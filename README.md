# Projectile Motion Calculator (C + WebAssembly)

A high-precision, web-deployable projectile motion calculator and physics simulation engine. All kinematics computations are implemented in pure **C** and compiled directly to **WebAssembly** using **Emscripten**. The frontend is built using standard HTML5, CSS3, and modern Vanilla JavaScript without external frontend frameworks or heavy bundlers.

---

## Features

- **Physics Core in WebAssembly (C)**:
  - 100% pure C numerical calculations (`compute`, `position`).
  - No standard I/O overhead (`scanf`/`printf`), returning direct pointers to float64 arrays.
  - Supports initial launch height ($h_0 \ge 0$), non-flat terrain kinematics, variable gravity, and zero air resistance.
  - Validated against standard analytical solutions.
- **Modern Responsive Interface**:
  - Dark/Light theme toggle with persistence.
  - Interactive inputs: initial velocity ($v_0$), angle ($\theta$) with synchronized slider and number input, initial height ($h_0$), and gravitational acceleration ($g$) with celestial presets (Earth $9.81$, Moon $1.62$, Mars $3.71$, Jupiter $24.79$, and custom).
  - Real-time kinematic results: Time to Peak, Max Height, Time of Flight, Range, Impact Speed, and Impact Angle.
- **Dynamic Scale Trajectory Canvas**:
  - Automatically scaled coordinate system with gridlines and units (meters).
  - Explicit markers for Launch point, Apex ($y_{\max}$ and $t_{\text{peak}}$), and Impact point (Range and $\theta_{\text{impact}}$).
  - Interactive trajectory hover scrubber displaying instantaneous $(t, x, y, v)$.
  - 60 FPS projectile animation with Play / Pause / Reset and speed multipliers ($0.25\times$, $0.5\times$, $1\times$, $2\times$).
- **Comparison Mode**:
  - Pin the current trajectory as a ghost baseline (shown in amber).
  - Visual overlay of both curves on the canvas and $\Delta$ differences shown on each stat card.
- **Data Table & CSV Export**:
  - Tabulated $(t, x, y, v_x, v_y, v)$ samples with customizable time intervals.
  - One-click "Download CSV" with simulation metadata.

---

## Project Structure

```
.
├── src/
│   └── projectile.c         # Physics core in pure C (exported via EMSCRIPTEN_KEEPALIVE)
├── public/
│   ├── index.html           # UI layout and structure
│   ├── style.css            # Responsive dark/light theme and CSS design system
│   ├── app.js               # Frontend application and WASM module coordinator
│   ├── projectile.js        # Emscripten glue code (generated)
│   └── projectile.wasm      # WebAssembly binary (generated)
├── .github/
│   └── workflows/
│       └── deploy.yml       # Optional GitHub Actions workflow
├── build.sh                 # One-command build script (Bash / Linux / macOS / Git Bash)
├── build.bat                # One-command build script (Windows CMD / PowerShell)
├── netlify.toml             # Netlify deployment configuration
└── README.md                # Documentation & instructions
```

---

## Prerequisites

1. **Emscripten SDK (`emsdk`)**:
   - `emcc` is used to compile `src/projectile.c` to `public/projectile.js` and `public/projectile.wasm`.
   - If not installed, `build.sh` or `build.bat` will install and activate `emsdk` automatically.
2. **Python 3** (or Node.js `http-server` / any static file server) to serve `/public` locally. WebAssembly files must be served over HTTP/HTTPS (not `file://`) to comply with browser CORS and security policies.

---

## Build Instructions

### One-Command Build (macOS / Linux / Git Bash)

```bash
chmod +x build.sh
./build.sh
```

### One-Command Build (Windows PowerShell / CMD)

```bat
build.bat
```

### Manual Build Command

```bash
emcc src/projectile.c -O2 -o public/projectile.js \
  -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","getValue"]' \
  -s EXPORTED_FUNCTIONS='["_compute","_position","_malloc","_free"]' \
  -s MODULARIZE=1 -s EXPORT_NAME=createModule
```

---

## Running Locally

Once built, serve the `public/` directory with Python:

```bash
cd public
python3 -m http.server 8000
```

*(On Windows, `python -m http.server 8000`)*

Open your browser at:
```
http://localhost:8000
```

---

## Verification & Standard Test Case

To verify calculation accuracy against standard textbook kinematics:

- **Inputs**:
  - $v_0 = 20\text{ m/s}$
  - $\theta = 45^\circ$
  - $h_0 = 0\text{ m}$
  - $g = 9.81\text{ m/s}^2$
- **Expected Analytical Results**:
  - **Range**: $40.775\text{ m}$
  - **Max Height**: $10.194\text{ m}$
  - **Flight Time**: $2.883\text{ s}$
  - **Impact Speed**: $20.000\text{ m/s}$
  - **Impact Angle**: $45.000^\circ$

Click the **"Load 20m/s @ 45°"** button in the UI or leave the default values to confirm that the WebAssembly engine produces these values.

---

## Deployment Instructions

The `public/` folder is a self-contained static site with correct MIME configuration.

### 1. Netlify
- The included [`netlify.toml`](file:///c:/Users/Aditi%20Pant/OneDrive/Desktop/Projectile%20Motion%20calc/netlify.toml) configures `publish = "public"` and sets `Content-Type: application/wasm` headers.
- Connect your GitHub repository to Netlify, or drag-and-drop the `public/` folder into Netlify Drop.

### 2. Vercel
- Import the repository in Vercel.
- Set **Root Directory** to `public` (or set Output Directory to `public`).

### 3. GitHub Pages
- The included GitHub Actions workflow in [`.github/workflows/deploy.yml`](file:///c:/Users/Aditi%20Pant/OneDrive/Desktop/Projectile%20Motion%20calc/.github/workflows/deploy.yml) will automatically compile the C code, generate the WebAssembly artifacts, and deploy to GitHub Pages upon pushing to `main`.
