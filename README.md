# USB Laser Controller - Client Application

A modern web-based interface for controlling laser devices through serial communication. This React application provides real-time control of laser power, brightness adjustment, and device monitoring capabilities.

## Features

- 🔌 **Serial Communication**: Direct USB connection
- ⚡ **Real-time Control**: Instant laser on/off switching and brightness adjustment
- 📊 **Device Monitoring**: Live stats including uptime, memory usage, and firmware version
- 💾 **Persistent Settings**: Brightness values are automatically saved on the device
- 🖥️ **Modern UI**: Clean, responsive interface with real-time feedback
- 📡 **Auto-sync**: Automatic synchronization of device state on connection

## Prerequisites

Before running this application, ensure you have the following installed:

### Node.js
Download and install Node.js from [nodejs.org](https://nodejs.org/)

**Recommended version:** Node.js 22.x or higher

To verify installation:
```bash
node --version
npm --version
```

### Yarn Package Manager
Install Yarn globally using npm:
```bash
npm install -g yarn
```

To verify Yarn installation:
```bash
yarn --version
```

Alternatively, you can install Yarn using other methods:
- **macOS (Homebrew)**: `brew install yarn`
- **Windows (Chocolatey)**: `choco install yarn`
- **Linux (Ubuntu/Debian)**: `curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg | sudo apt-key add - && echo "deb https://dl.yarnpkg.com/debian/ stable main" | sudo tee /etc/apt/sources.list.d/yarn.list && sudo apt update && sudo apt install yarn`

## Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/maxwellwachira/USB_laser_controller.git
   ```

2. **Navigate to the project directory**
   ```bash
   cd USB_laser_controller
   ```

3. **Install dependencies**
   ```bash
   yarn install
   ```

## Usage

### Development Mode
To start the development server:
```bash
yarn start
```

The application will automatically open in your browser at `http://localhost:5173`

### Production Build
To create an optimized production build:
```bash
yarn build
```

The built files will be generated in the `dist/` directory.

### Preview Production Build
To preview the production build locally:
```bash
yarn preview
```

## Browser Compatibility

This application requires a modern browser with **Web Serial API** support:

- ✅ **Chrome 89+** (Recommended)
- ✅ **Edge 89+**
- ✅ **Opera 75+**
- ❌ Firefox (Web Serial API not supported)
- ❌ Safari (Web Serial API not supported)

## Device Connection

1. **Connect your laser controller** via USB to your computer
2. **Open the application** in a supported browser
3. **Click "Connect to Device"** and select your laser controller from the serial port list
4. The application will automatically sync with your device settings

## Troubleshooting

### Connection Issues
- Ensure your laser controller is properly connected via USB
- Try a different USB cable or port
- Verify the device is powered on and functioning
- Check that no other applications are using the serial port

### Browser Compatibility
- Use Chrome 89+ or Edge 89+ for best compatibility
- Enable "Experimental Web Platform features" in Chrome flags if needed
- Some corporate networks may block serial port access

### Permission Issues
- Grant serial port permissions when prompted by the browser
- Some antivirus software may block serial communication

## Development

### Project Structure
```
USB_laser_controller/
├── src/
│   ├── components/          # React components
│   ├── styles/             # CSS modules and styles
│   └── types/              # TypeScript type definitions
├── public/                 # Static assets
├── dist/                   # Production build output
└── package.json           # Project dependencies and scripts
```

### Available Scripts
- `yarn start` - Start development server
- `yarn build` - Create production build
- `yarn preview` - Preview production build
- `yarn lint` - Run code linting

### Technology Stack
- **React 19** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **CSS Modules** - Styling
- **Web Serial API** - Device communication


- [USB Laser Controller Firmware](https://github.com/maxwellwachira/USB_laser_controller_firmware) - ESP32-S3 firmware for the laser controller hardware