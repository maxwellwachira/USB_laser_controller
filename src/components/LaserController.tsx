import React, { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronUp, BarChart } from 'lucide-react';
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
    [key: string]: unknown;
}

// Debounce utility function
function debounce<T extends (...args: any[]) => any>(
    func: T,
    wait: number
): (...args: Parameters<T>) => void {
    //@ts-expect-error
    let timeout: NodeJS.Timeout;
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

    // Device states
    const [laserOn, setLaserOn] = useState<boolean>(false);
    const [laserBrightness, setLaserBrightness] = useState<number>(50);
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
        if (!currentWriter || !isConnected) {
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
        }, 300),
        [writer, isConnected]
    );

    // Simulate uptime
    useEffect(() => {
        const interval = setInterval(() => {
            setDeviceStats(prev => ({
                ...prev,
                uptime: prev.uptime + 1,
                freeHeap: prev.freeHeap + Math.floor(Math.random() * 200 - 100)
            }));
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    // Auto-send brightness when changed
    useEffect(() => {
        if (laserOn && isConnected) {
            debouncedSendBrightness(laserBrightness);
        }
    }, [laserBrightness, laserOn, isConnected, debouncedSendBrightness]);

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

            //@ts-expect-error
            const selectedPort = await navigator.serial.requestPort();

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

            // Start reading data
            startReading(newReader);

            // Request initial status
            setTimeout(() => {
                sendCommand('STATUS', newWriter);
            }, 1000);

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
        setDeviceStats(prev => ({ ...prev, firmwareVersion: "Unknown" }));
    };

    const startReading = async (currentReader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> => {
        try {
            let buffer = '';

            while (isConnected && currentReader) {
                try {
                    const { value, done } = await currentReader.read();

                    if (done) break;

                    if (value) {
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
        try {
            const jsonData: SerialData = JSON.parse(data);
            updateDeviceStats(jsonData);
            logMessage(JSON.stringify(jsonData, null, 2), 'json');
        } catch (e) {
            logMessage(data, 'success');

            // Check for firmware version in plain text
            if (data.includes('Firmware Version:') || data.includes('ESP32-S3')) {
                const versionMatch = data.match(/v?(\d+\.\d+)/);
                if (versionMatch) {
                    setDeviceStats(prev => ({ ...prev, firmwareVersion: versionMatch[1] }));
                }
            }
        }
    };

    const updateDeviceStats = (data: SerialData): void => {
        if (data.type === 'status' || data.type === 'heartbeat') {
            setDeviceStats(prev => ({
                ...prev,
                uptime: data.uptime_ms ? Math.floor(data.uptime_ms / 1000) : prev.uptime,
                freeHeap: data.free_heap_bytes || prev.freeHeap,
                firmwareVersion: data.version || prev.firmwareVersion
            }));

            if (data.hasOwnProperty('laser_state')) {
                setLaserOn(data.laser_state!);
            }
        }
    };

    const handleLaserToggle = (): void => {
        const newState = !laserOn;
        setLaserOn(newState);
        sendCommand(newState ? 'LASER_ON' : 'LASER_OFF');
    };

    const handleBrightnessChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
        setLaserBrightness(parseInt(e.target.value));
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
                                <button onClick={disconnect} className={styles.button}>
                                    Disconnect
                                </button>
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
                                <div className={`${styles.laserDot} ${laserOn ? styles.laserActive : ''}`}></div>
                                Laser (Pin 6)
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
                                <span className={styles.sliderLabel}>Brightness Level</span>
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
                                                <span className={styles.statLabel}>Free Heap</span>
                                                <span className={styles.statValue}>{deviceStats.freeHeap.toLocaleString()} bytes</span>
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