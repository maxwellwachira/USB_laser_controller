import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronDown, ChevronUp, BarChart, Zap } from 'lucide-react';
import styles from './LaserController.module.css';

interface SerialPort {
    open(options: SerialOptions): Promise<void>;
    close(): Promise<void>;
    readable?: ReadableStream<Uint8Array>;
    writable?: WritableStream<Uint8Array>;
    getInfo(): SerialPortInfo;
}

interface SerialOptions {
    baudRate: number;
    dataBits?: number;
    stopBits?: number;
    parity?: 'none' | 'even' | 'odd';
    flowControl?: 'none' | 'hardware';
}

interface SerialPortInfo {
    usbVendorId?: number;
    usbProductId?: number;
}

interface Serial {
    requestPort(): Promise<SerialPort>;
}

interface SerialError extends Error {
    name: string;
    message: string;
}

declare global {
    interface Navigator {
        serial?: Serial;
    }
}

// Component interfaces
interface DeviceStats {
    uptime: number;
    freeHeap: number;
    firmwareVersion: string;
}

interface ConsoleEntry {
    timestamp: Date;
    message: string;
    type: 'info' | 'success' | 'warning' | 'error' | 'json';
}

interface SerialData {
    type?: string;
    uptime_ms?: number;
    free_heap_bytes?: number;
    version?: string;
    laser_state?: boolean;
    laser_brightness?: number;
    [key: string]: unknown;
}

// Debounce utility function
function debounce<T extends (...args: any[]) => any>(
    func: T,
    wait: number
): (...args: Parameters<T>) => void {
    let timeout: ReturnType<typeof setTimeout>;
    return (...args: Parameters<T>) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}

const LaserController: React.FC = () => {
    const [port, setPort] = useState<SerialPort | null>(null);
    const [isConnected, setIsConnected] = useState<boolean>(false);
    const [reader, setReader] = useState<ReadableStreamDefaultReader<Uint8Array> | null>(null);
    const [writer, setWriter] = useState<WritableStreamDefaultWriter<Uint8Array> | null>(null);
    const isConnectedRef = useRef<boolean>(false);

    // Device states
    const [laserOn, setLaserOn] = useState<boolean>(false);
    const [laserBrightness, setLaserBrightness] = useState<number>(50);
    const [brightnessInitialized, setBrightnessInitialized] = useState<boolean>(false);
    const [showAdvanced, setShowAdvanced] = useState<boolean>(false);

    // Device stats
    const [deviceStats, setDeviceStats] = useState<DeviceStats>({
        uptime: 0,
        freeHeap: 45600,
        firmwareVersion: "Unknown"
    });

    // Console
    const [consoleData, setConsoleData] = useState<ConsoleEntry[]>([
        { timestamp: new Date(), message: "Laser Controller v1.0 Ready", type: "success" },
        { timestamp: new Date(), message: "Connect your Laser device to start communication...", type: "info" }
    ]);

    // Send command function
    const sendCommand = async (
        command: string,
        currentWriter: WritableStreamDefaultWriter<Uint8Array> | null = writer
    ): Promise<void> => {
        if (!currentWriter || !isConnectedRef.current) {
            logMessage('No connection available', 'error');
            return;
        }

        try {
            const encoder = new TextEncoder();
            const data = encoder.encode(command + '\n');

            await currentWriter.write(data);
            logMessage(`Sent: ${command}`, 'warning');

        } catch (error) {
            const serialError = error as SerialError;
            logMessage(`Send error: ${serialError.message}`, 'error');
        }
    };

    // Debounced brightness change
    const debouncedSendBrightness = useCallback(
        debounce((brightness: number) => {
            sendCommand(`SET_LASER_PWM:${brightness}`);
        }, 50),
        [writer, isConnected]
    );

    // Update isConnectedRef when isConnected changes
    useEffect(() => {
        isConnectedRef.current = isConnected;
        
        // Reset brightness initialization when disconnected
        if (!isConnected) {
            setBrightnessInitialized(false);
        }
    }, [isConnected]);

    // Auto-send brightness when changed (only if brightness is already initialized)
    useEffect(() => {
        if (laserOn && isConnected && brightnessInitialized) {
            debouncedSendBrightness(laserBrightness);
        }
    }, [laserBrightness, laserOn, isConnected, brightnessInitialized, debouncedSendBrightness]);

    const formatUptime = (seconds: number): string => {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        let uptimeText = '';
        if (days > 0) uptimeText += `${days}d `;
        if (hours > 0 || days > 0) uptimeText += `${hours}h `;
        if (minutes > 0 || hours > 0 || days > 0) uptimeText += `${minutes}m `;
        uptimeText += `${secs}s`;
        return uptimeText;
    };

    const logMessage = (message: string, type: ConsoleEntry['type'] = 'info'): void => {
        const newEntry: ConsoleEntry = {
            timestamp: new Date(),
            message,
            type
        };
        setConsoleData(prev => [...prev.slice(-99), newEntry]); // Keep last 100 entries
    };

    const connect = async (): Promise<void> => {
        try {
            if (!('serial' in navigator)) {
                logMessage('Web Serial API not supported. Please use Chrome 89+ or Edge 89+', 'error');
                return;
            }

            logMessage('Requesting serial port access...', 'warning');

            const selectedPort = await navigator.serial!.requestPort();

            await selectedPort.open({
                baudRate: 115200,
                dataBits: 8,
                stopBits: 1,
                parity: 'none',
                flowControl: 'none'
            });

            const newReader = selectedPort.readable?.getReader();
            const newWriter = selectedPort.writable?.getWriter();

            if (!newReader || !newWriter) {
                throw new Error('Failed to get reader/writer from serial port');
            }

            setPort(selectedPort);
            setReader(newReader);
            setWriter(newWriter);
            setIsConnected(true);

            logMessage('Successfully connected to laser device!', 'success');

            // Start reading data - the firmware will automatically send initial state
            sendCommand('GET_INITIAL_STATE');
            startReading(newReader);

        } catch (error: any) {
            logMessage(`Connection failed: ${error.message}`, 'error');
        }
    };

    const disconnect = async (): Promise<void> => {
        if (reader) {
            try {
                await reader.cancel();
                reader.releaseLock();
            } catch (error) {
                console.error('Reader release error:', error);
            }
        }

        if (writer) {
            try {
                await writer.close();
            } catch (error) {
                console.error('Writer close error:', error);
            }
        }

        if (port) {
            try {
                await port.close();
                logMessage('Serial connection closed', 'warning');
            } catch (error: any) {
                logMessage(`Port close error: ${error.message}`, 'error');
            }
        }

        setPort(null);
        setReader(null);
        setWriter(null);
        setIsConnected(false);
        setBrightnessInitialized(false);
        setDeviceStats(prev => ({ ...prev, firmwareVersion: "Unknown" }));
    };

    const startReading = async (currentReader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> => {
        try {
            let buffer = '';
            console.log('📖 Starting continuous data reading...', 'success')
            while (currentReader) {
                console.log("inside while loop")
                try {
                    const { value, done } = await currentReader.read();

                    if (done) {
                        console.log('📡 Reading stream ended', 'warning');
                        break;
                    }

                    if (value) {

                        console.log({ value })
                        const decoder = new TextDecoder();
                        buffer += decoder.decode(value);

                        const lines = buffer.split('\n');
                        buffer = lines.pop() || '';

                        for (const line of lines) {
                            const trimmed = line.trim();
                            if (trimmed) {
                                processReceivedData(trimmed);
                            }
                        }
                    }
                } catch (readError: any) {
                    if (readError.name === 'NetworkError' || readError.name === 'NotFoundError') {
                        logMessage('Device disconnected unexpectedly', 'warning');
                        disconnect();
                        break;
                    }
                }
            }
        } catch (error: any) {
            logMessage(`Reading error: ${error.message}`, 'error');
        }
    };

    const processReceivedData = (data: string): void => {
        console.log('Received data:', data); // Debug log

        try {
            const jsonData: SerialData = JSON.parse(data);
            console.log('Parsed JSON data:', jsonData); // Debug log
            
            // Handle initial_state message - this is automatically sent by firmware on connection
            if (jsonData.type === 'initial_state') {
                logMessage('Received initial device state from firmware', 'success');
                
                // Set laser state
                if (jsonData.hasOwnProperty('laser_state')) {
                    setLaserOn(!!jsonData.laser_state);
                }
                
                // Set brightness from firmware
                if (jsonData.hasOwnProperty('laser_brightness')) {
                    const deviceBrightness = jsonData.laser_brightness || 50;
                    setLaserBrightness(deviceBrightness);
                    setBrightnessInitialized(true);
                    logMessage(`Brightness synced from device: ${deviceBrightness}%`, 'info');
                }
                
                // Set firmware version
                if (jsonData.version) {
                    //@ts-expect-error
                    setDeviceStats(prev => ({ ...prev, firmwareVersion: jsonData.version }));
                }
                
                // Update other stats
                if (jsonData.uptime_ms) {
                    setDeviceStats(prev => ({ 
                        ...prev, 
                        //@ts-ignore
                        uptime: Math.floor(jsonData.uptime_ms / 1000)
                    }));
                }
                if (jsonData.free_heap_bytes) {
                    //@ts-expect-error
                    setDeviceStats(prev => ({ 
                        ...prev, 
                        freeHeap: jsonData.free_heap_bytes
                    }));
                }
            } else {
                // Handle other JSON data types (status, heartbeat, etc.)
                updateDeviceStats(jsonData);
            }
            
            logMessage(JSON.stringify(jsonData, null, 2), 'json');
        } catch (e) {
            logMessage(data, 'success');

            // Check for firmware version in plain text - updated for v5.1
            if (data.includes('Firmware Version:') || data.includes('ESP32-S3') || data.includes('v5.') || data.includes('Ready')) {
                const versionMatch = data.match(/v?(\d+\.\d+)/);
                if (versionMatch) {
                    setDeviceStats(prev => ({ ...prev, firmwareVersion: versionMatch[1] }));
                } else if (data.includes('v5.1') || data.includes('5.1') || data.includes('Ready')) {
                    setDeviceStats(prev => ({ ...prev, firmwareVersion: '5.1' }));
                } else if (data.includes('v5.0') || data.includes('5.0')) {
                    setDeviceStats(prev => ({ ...prev, firmwareVersion: '5.0' }));
                }
            }

            // Check for brightness loading message - this is the saved brightness from preferences
            if (data.includes('Loaded brightness:')) {
                const brightnessMatch = data.match(/Loaded brightness:\s*(\d+)%/);
                if (brightnessMatch) {
                    const loadedBrightness = parseInt(brightnessMatch[1]);
                    setLaserBrightness(loadedBrightness);
                    setBrightnessInitialized(true);
                    logMessage(`Device brightness restored from preferences: ${loadedBrightness}%`, 'info');
                }
            }

            // Check for device initialization message
            if (data.includes('Device initialized')) {
                const brightnessMatch = data.match(/Brightness:\s*(\d+)%/);
                const laserMatch = data.match(/Laser:\s*(ON|OFF)/);
                
                if (brightnessMatch) {
                    const deviceBrightness = parseInt(brightnessMatch[1]);
                    setLaserBrightness(deviceBrightness);
                    setBrightnessInitialized(true);
                    logMessage(`Brightness initialized: ${deviceBrightness}%`, 'info');
                }
                
                if (laserMatch) {
                    setLaserOn(laserMatch[1] === 'ON');
                }
            }

            // Check for connection detection message
            if (data.includes('Connection detected')) {
                logMessage('Firmware detected UI connection', 'info');
            }

            // Parse laser status response (if manually requested)
            if (data.includes('Laser State:') && data.includes('Laser Brightness:')) {
                const stateMatch = data.match(/Laser State:\s*(ON|OFF)/);
                if (stateMatch) {
                    setLaserOn(stateMatch[1] === 'ON');
                }

                const brightnessMatch = data.match(/Laser Brightness:\s*(\d+)%/);
                if (brightnessMatch) {
                    const deviceBrightness = parseInt(brightnessMatch[1]);
                    setLaserBrightness(deviceBrightness);
                    setBrightnessInitialized(true);
                    logMessage(`Manual brightness sync: ${deviceBrightness}%`, 'info');
                }
            }
        }
    };

    const updateDeviceStats = (data: SerialData): void => {
        if (data.type === 'status' || data.type === 'heartbeat') {
            setDeviceStats(prev => ({
                ...prev,
                uptime: data.uptime_ms ? Math.floor(data.uptime_ms / 1000) : prev.uptime,
                freeHeap: data.free_heap_bytes || (prev.freeHeap),
                firmwareVersion: data.version || prev.firmwareVersion
            }));

            // Update laser state from firmware
            if (data.hasOwnProperty('laser_state')) {
                setLaserOn(!!data.laser_state);
            }

            // Update laser brightness from firmware
            if (data.hasOwnProperty('laser_brightness')) {
                const firmwareBrightness = data.laser_brightness || 0;
                
                // If brightness hasn't been initialized yet, use the firmware value
                if (!brightnessInitialized) {
                    setLaserBrightness(firmwareBrightness);
                    setBrightnessInitialized(true);
                    logMessage(`Brightness sync from heartbeat: ${firmwareBrightness}%`, 'info');
                } else {
                    // Only update if significantly different to avoid fighting with user input
                    if (Math.abs(firmwareBrightness - laserBrightness) > 2) {
                        setLaserBrightness(firmwareBrightness);
                    }
                }
            }
        }
    };

    const handleLaserToggle = (): void => {
        const newState = !laserOn;
        setLaserOn(newState);
        sendCommand(newState ? 'LASER_ON' : 'LASER_OFF');
    };

    const handleBrightnessChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
        const newBrightness = parseInt(e.target.value);
        setLaserBrightness(newBrightness);
    };

    const clearConsole = (): void => {
        setConsoleData([{ timestamp: new Date(), message: 'Console cleared', type: 'success' }]);
    };

    return (
        <div className={styles.container}>
            <div className={styles.center}>
                <div className={styles.wrapper}>
                    {/* Logo */}
                    <div className={styles.logoContainer}>
                        <img src='/logo.png' width="250px" height="auto" alt="unknown labs logo" />
                    </div>

                    {/* Title */}
                    <h3 className={styles.title}>Vex Laser Controller</h3>

                    {/* Status Section */}
                    <div className={styles.statusSection}>
                        <div className={styles.statusIndicator}>
                            <div className={styles.statusInfo}>
                                <div className={`${styles.statusDot} ${isConnected ? styles.connected : styles.disconnected}`}></div>
                                <div>
                                    <div className={styles.statusText}>
                                        {isConnected ? 'Connected to Laser' : 'Not connected'}
                                    </div>
                                    <div className={styles.statusSubtext}>
                                        {isConnected ? `Firmware v${deviceStats.firmwareVersion}` : 'Click connect to establish communication'}
                                    </div>
                                </div>
                            </div>

                            {isConnected ? (
                                <div className={styles.buttonGroup}>
                                    <button onClick={disconnect} className={styles.button}>
                                        Disconnect
                                    </button>
                                </div>
                            ) : (
                                <button onClick={connect} className={`${styles.button} ${styles.clearBtn}`}>
                                    Connect to Device
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Laser Control Card */}
                    <div className={`${styles.card} ${laserOn ? styles.cardActive : ''}`}>
                        <div className={styles.cardHeader}>
                            <h2 className={styles.cardTitle}>
                                <Zap size={20} />
                                <div className={`${laserOn ? styles.laserActive : ''}`}></div>
                                LASER-5V
                            </h2>

                            <button
                                onClick={handleLaserToggle}
                                disabled={!isConnected}
                                className={`${styles.switch} ${laserOn ? styles.switchOn : styles.switchOff} ${!isConnected ? styles.disabled : ''}`}
                            >
                                <div className={styles.switchThumb}></div>
                            </button>
                        </div>

                        {/* Brightness Slider */}
                        <div className={styles.sliderContainer}>
                            <div className={styles.sliderHeader}>
                                <span className={styles.sliderLabel}>
                                    Brightness Level {!brightnessInitialized && isConnected ? '(syncing...)' : ''}
                                </span>
                                <span className={styles.brightnessValue}>{laserBrightness}%</span>
                            </div>

                            <input
                                type="range"
                                min="0"
                                max="100"
                                value={laserBrightness}
                                onChange={handleBrightnessChange}
                                disabled={!isConnected || !laserOn}
                                className={`${styles.slider} ${laserOn && isConnected ? styles.sliderActive : ''}`}
                                style={{
                                    background: laserOn && isConnected
                                        ? `linear-gradient(to right, #ec4899 0%, #ec4899 ${laserBrightness}%, #e5e7eb ${laserBrightness}%, #e5e7eb 100%)`
                                        : '#e5e7eb'
                                }}
                            />
                        </div>
                    </div>

                    {/* Advanced Settings Card */}
                    <div className={styles.advancedCard}>
                        <div className={styles.advancedHeader}>
                            <button
                                onClick={() => setShowAdvanced(!showAdvanced)}
                                className={styles.advancedToggleBtn}
                            >
                                <div className={styles.toggleContent}>
                                    <div className={styles.toggleIconContainer}>
                                        <BarChart className={styles.laserIcon} size={20} />
                                    </div>
                                    <div className={styles.toggleText}>
                                        <span className={styles.toggleLabel}>Device Statistics</span>
                                        <span className={styles.toggleSubtext}>
                                            {showAdvanced ? 'Hide diagnostics and console' : 'Show device stats and data console'}
                                        </span>
                                    </div>
                                    <div className={`${styles.chevronIcon} ${showAdvanced ? styles.chevronUp : styles.chevronDown}`}>
                                        {showAdvanced ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                                    </div>
                                </div>
                            </button>
                        </div>

                        {/* Advanced Content */}
                        {showAdvanced && (
                            <div className={styles.advancedContent}>
                                {/* Stats Panel */}
                                <div className={styles.statsCard}>
                                    <div className={styles.statsHeader}>
                                        <h2 className={styles.sectionTitle}>Device Statistics</h2>
                                    </div>
                                    <div className={styles.statsGrid}>
                                        <div className={styles.statItem}>
                                            <div className={styles.statContent}>
                                                <span className={styles.statLabel}>Uptime</span>
                                                <span className={styles.statValue}>{formatUptime(deviceStats.uptime)}</span>
                                            </div>
                                        </div>
                                        <div className={styles.statItem}>
                                            <div className={styles.statContent}>
                                                <span className={styles.statLabel}>Free Heap Memory</span>
                                                <span className={styles.statValue}>{(deviceStats.freeHeap / 1024).toLocaleString()} kB</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Console Section */}
                                <div className={styles.consoleSection}>
                                    <div className={styles.consoleHeader}>
                                        <div className={styles.consoleTitleContainer}>
                                            <h2 className={styles.sectionTitle}>Data Console</h2>
                                            <span className={`${styles.consoleBadge} ${isConnected ? styles.consoleBadgeOnline : styles.consoleBadgeOffline}`}>
                                                {isConnected ? 'ONLINE' : 'OFFLINE'}
                                            </span>
                                        </div>
                                        <button
                                            onClick={clearConsole}
                                            className={`${styles.button} ${styles.clearBtn}`}
                                        >
                                            Clear Console
                                        </button>
                                    </div>

                                    <div className={styles.console}>
                                        {consoleData.map((entry, index) => (
                                            <div key={index} className={styles.consoleEntry}>
                                                <span className={styles.timestamp}>
                                                    [{entry.timestamp.toLocaleTimeString()}]
                                                </span>{' '}
                                                <span className={styles[entry.type]}>
                                                    {entry.message}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LaserController;