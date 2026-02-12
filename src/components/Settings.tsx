import React, { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Bell, Shield, Info, Radio, QrCode, Camera, X, Bluetooth } from 'lucide-react';
import { p2pMesh } from '../network/P2pMesh';
// import { bluetoothService } from '../network/BluetoothService';
import { QRCodeSVG } from 'qrcode.react';
import { Html5Qrcode } from 'html5-qrcode';

interface SettingsProps {
    fallDetectionEnabled: boolean;
    onToggleFallDetection: (val: boolean) => void;
}

export const Settings: React.FC<SettingsProps> = ({ fallDetectionEnabled, onToggleFallDetection }) => {
    const [mySignal, setMySignal] = useState('');
    const [peerCount, setPeerCount] = useState(0);
    const [showQr, setShowQr] = useState(false);
    const [showScanner, setShowScanner] = useState(false);
    const [scanError, setScanError] = useState('');
    const [cameras, setCameras] = useState<Array<{ id: string; label: string }>>([]);
    const [selectedCameraId, setSelectedCameraId] = useState<string>('');
    const [scannerObject, setScannerObject] = useState<Html5Qrcode | null>(null);

    const [isCameraBlocked, setIsCameraBlocked] = useState(false);
    const [isReconnecting, setIsReconnecting] = useState(false);
    const [connectedPeers, setConnectedPeers] = useState<string[]>([]);

    useEffect(() => {
        // Listen for signal generation
        p2pMesh.onSignal((signal) => {
            setMySignal(JSON.stringify(signal));
        });

        // Listen for peer count changes
        p2pMesh.onPeerCountChanged((count) => {
            setPeerCount(count);
            setConnectedPeers(p2pMesh.getConnectedPeerIds());
        });

        // Initial peer count
        setPeerCount(p2pMesh.getPeerCount());
        setConnectedPeers(p2pMesh.getConnectedPeerIds());
    }, []);

    // Fetch cameras on mount
    useEffect(() => {
        Html5Qrcode.getCameras().then(devices => {
            if (devices && devices.length) {
                setCameras(devices.map(d => ({ id: d.id, label: d.label })));
                // Default to back camera if available, otherwise first one
                const backCamera = devices.find(d => d.label.toLowerCase().includes('back') || d.label.toLowerCase().includes('environment'));
                setSelectedCameraId(backCamera ? backCamera.id : devices[0].id);
            }
        }).catch(err => {
            console.error('Error getting cameras', err);
            setIsCameraBlocked(true);
        });
    }, []);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const html5QrCode = new Html5Qrcode("reader");
        try {
            const decodedText = await html5QrCode.scanFile(file, true);
            const signal = JSON.parse(decodedText);
            p2pMesh.receiveConnection(signal);
            setShowScanner(false);
            alert('Peer Linked successfully!');
        } catch (err) {
            setScanError('Failed to read QR from image');
        }
    };

    const handleInititiate = () => {
        p2pMesh.initiateConnection();
        setShowQr(true);
    };

    const startScanning = async () => {
        if (!selectedCameraId) return;

        const html5QrCode = new Html5Qrcode("reader");
        setScannerObject(html5QrCode);

        try {
            await html5QrCode.start(
                selectedCameraId,
                {
                    fps: 15, // Higher FPS for faster scanning
                    qrbox: { width: 300, height: 300 }, // Larger scanning area
                    aspectRatio: 1.0
                },
                (decodedText) => {
                    // Success callback
                    try {
                        const signal = JSON.parse(decodedText);
                        p2pMesh.receiveConnection(signal);

                        // Stop scanning immediately on success
                        html5QrCode.stop().then(() => {
                            html5QrCode.clear();
                            setScannerObject(null);
                            setShowScanner(false);
                            alert('⚡ INSTANT CONNECT: Peer Linked!');
                        });
                        setScanError('');
                    } catch (err) {
                        // Ignore non-JSON QR codes (likely not ours)
                    }
                },
                () => {
                    // Ignore scan errors as they happen every frame
                }
            );
        } catch (err) {
            console.error("Error starting scanner", err);
            setScanError('Failed to start camera. ensuring HTTPS?');
        }
    };

    const stopScanning = async () => {
        if (scannerObject) {
            try {
                await scannerObject.stop();
                await scannerObject.clear();
                setScannerObject(null);
            } catch (err) {
                console.error("Error stopping scanner", err);
            }
        }
        setShowScanner(false);
    };

    const switchCamera = async () => {
        if (!scannerObject || cameras.length < 2) return;

        // Find next camera index
        const currentIndex = cameras.findIndex(c => c.id === selectedCameraId);
        const nextIndex = (currentIndex + 1) % cameras.length;
        const nextCameraId = cameras[nextIndex].id;

        setSelectedCameraId(nextCameraId);

        // Restart scanner with new camera
        await scannerObject.stop();
        await scannerObject.start(
            nextCameraId,
            {
                fps: 15,
                qrbox: { width: 300, height: 300 },
                aspectRatio: 1.0
            },
            (decodedText) => {
                try {
                    const signal = JSON.parse(decodedText);
                    p2pMesh.receiveConnection(signal);
                    scannerObject.stop().then(() => {
                        scannerObject.clear();
                        setScannerObject(null);
                        setShowScanner(false);
                        alert('⚡ INSTANT CONNECT: Peer Linked!');
                    });
                } catch (err) { }
            },
            () => { }
        );
    };

    // Auto-start scanning when modal opens
    useEffect(() => {
        if (showScanner && selectedCameraId && !scannerObject) {
            startScanning();
        }
    }, [showScanner, selectedCameraId]);


    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* ... header code ... */}
            <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-500/10 rounded-xl">
                        <SettingsIcon className="w-6 h-6 text-blue-400" />
                    </div>
                    <h2 className="text-2xl font-bold tracking-tight">System Settings</h2>
                </div>
                <div className="flex items-center gap-2 px-3 py-1 bg-blue-500/10 rounded-full border border-blue-500/20">
                    <Radio className={`w-3.5 h-3.5 ${peerCount > 0 ? 'text-green-400 animate-pulse' : 'text-slate-500'}`} />
                    <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">{peerCount} PEERS</span>
                </div>
            </div>

            {/* Mesh Networking Section */}
            <div className="bg-slate-900/60 backdrop-blur-xl rounded-[2.5rem] border border-white/5 p-8 space-y-6 shadow-2xl relative overflow-hidden">
                <div className="flex items-center gap-4 mb-2">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center text-indigo-400 border border-indigo-500/20">
                        <QrCode className="w-6 h-6" />
                    </div>
                    <div>
                        <p className="font-bold text-lg text-white">Crisis Connect</p>
                        <p className="text-sm text-slate-500 font-medium whitespace-nowrap">Link devices with zero internet</p>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <button
                        onClick={handleInititiate}
                        className="flex flex-col items-center gap-3 p-6 bg-indigo-600 hover:bg-indigo-500 text-white rounded-3xl transition-all active:scale-95 shadow-lg shadow-indigo-900/20"
                    >
                        <QrCode className="w-8 h-8" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-center">Show My Connect QR</span>
                    </button>

                    <button
                        onClick={() => setShowScanner(true)}
                        className="flex flex-col items-center gap-3 p-6 bg-slate-800 hover:bg-slate-700 text-white rounded-3xl transition-all active:scale-95 border border-white/5"
                    >
                        <Camera className="w-8 h-8" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-center">Scan Nearby Peer</span>
                    </button>
                </div>

                {/* Connection Status */}
                {peerCount > 0 && (
                    <div className="space-y-3">
                        <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-2xl">
                            <div className="flex items-center gap-2 mb-2">
                                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                                <span className="text-[10px] font-black text-green-400 uppercase tracking-widest">
                                    {peerCount} {peerCount === 1 ? 'Peer' : 'Peers'} Connected
                                </span>
                            </div>
                            <div className="text-[9px] text-slate-400 space-y-2">
                                {connectedPeers.map((peerId) => {
                                    const isAuto = peerId.startsWith('peer-');
                                    return (
                                        <div key={peerId} className="flex items-center justify-between bg-slate-900/40 p-2 rounded-lg border border-white/5">
                                            <div className="flex items-center gap-2">
                                                <Radio className={`w-3 h-3 ${isAuto ? 'text-blue-400' : 'text-orange-400'}`} />
                                                <span className="font-mono text-slate-300">{peerId}</span>
                                            </div>
                                            <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${isAuto ? 'bg-blue-500/20 text-blue-300' : 'bg-orange-500/20 text-orange-300'}`}>
                                                {isAuto ? 'TAB SYNC' : 'QR SCAN'}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}

                {/* Auto-Reconnect Button */}
                <button
                    onClick={async () => {
                        setIsReconnecting(true);
                        await p2pMesh.reconnectToSavedPeers();
                        setIsReconnecting(false);
                    }}
                    disabled={isReconnecting}
                    className="w-full flex items-center justify-center gap-2 py-3 bg-slate-800/50 hover:bg-slate-700/50 disabled:opacity-50 text-slate-300 rounded-2xl transition-all border border-white/5"
                >
                    <Radio className={`w-4 h-4 ${isReconnecting ? 'animate-spin' : ''}`} />
                    <span className="text-[10px] font-bold uppercase tracking-wider">
                        {isReconnecting ? 'Reconnecting...' : 'Auto-Reconnect to Saved Peers'}
                    </span>
                </button>
            </div>

            {/* Bluetooth Mesh Section */}
            <div className="bg-slate-900/60 backdrop-blur-xl rounded-[2.5rem] border border-white/5 p-8 space-y-6 shadow-2xl relative overflow-hidden">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-orange-500/10 flex items-center justify-center text-orange-400 border border-orange-500/20">
                            <Bluetooth className="w-6 h-6" />
                        </div>
                        <div>
                            <p className="font-bold text-lg text-white">Bluetooth Discovery</p>
                            <p className="text-sm text-slate-500 font-medium whitespace-nowrap">⚠️ Browser Limitation</p>
                        </div>
                    </div>
                </div>

                <div className="p-6 bg-orange-500/10 border border-orange-500/20 rounded-3xl space-y-3">
                    <div className="flex items-center gap-2 text-orange-400">
                        <Info className="w-4 h-4" />
                        <span className="text-[10px] font-black uppercase tracking-widest">⚠️ Web Bluetooth Limitation</span>
                    </div>
                    <div className="space-y-2 text-[10px] text-slate-300 leading-relaxed">
                        <p><strong>Browsers cannot connect to other browsers via Bluetooth.</strong></p>
                        <p>Web Bluetooth can only connect to <strong>physical Bluetooth devices</strong> (like smart watches, IoT sensors), not other phones/laptops running web apps.</p>
                    </div>
                    <div className="bg-slate-900/50 p-4 rounded-2xl border border-white/5">
                        <p className="text-[10px] text-indigo-300 font-bold mb-2">✅ Use QR Code Sync Instead:</p>
                        <p className="text-[9px] text-slate-400">
                            The <strong>"Crisis Connect"</strong> section above uses WebRTC and works perfectly for phone ↔ laptop connections. Use the <strong>"Upload QR Photo"</strong> method for best results!
                        </p>
                    </div>
                </div>
            </div>

            {/* QR Modal */}
            {showQr && (
                <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-xl z-[9999] flex items-center justify-center p-6 transition-all duration-300">
                    <div className="bg-white p-8 rounded-[3rem] space-y-6 max-w-sm w-full text-center relative overflow-hidden">
                        <button
                            onClick={() => setShowQr(false)}
                            className="absolute top-6 right-6 p-2 bg-slate-100 rounded-full text-slate-400 hover:text-slate-900 transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>

                        <div className="space-y-2 pt-4">
                            <h3 className="text-slate-900 font-black text-xl uppercase tracking-tighter">Your Sync Key</h3>
                            <p className="text-slate-500 text-xs font-medium">Scan this with your phone camera</p>
                            <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-3 mt-3">
                                <p className="text-[10px] text-yellow-800 font-medium leading-relaxed">
                                    💡 <strong>Screen Scan Tips:</strong> Increase screen brightness, hold phone 6-8 inches away, avoid glare
                                </p>
                            </div>
                        </div>

                        <div className="bg-white p-8 rounded-3xl inline-block border-4 border-slate-200 shadow-inner">
                            {mySignal ? (
                                <QRCodeSVG
                                    value={mySignal}
                                    size={280}
                                    level="H"
                                    includeMargin={true}
                                    bgColor="#ffffff"
                                    fgColor="#000000"
                                />
                            ) : (
                                <div className="w-[280px] h-[280px] flex items-center justify-center">
                                    <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                                </div>
                            )}
                        </div>

                        <p className="text-[10px] font-black text-indigo-600 uppercase tracking-[0.2em]">MESHGUARD DISASTER PROTOCOL</p>
                    </div>
                </div>
            )}

            {/* Scanner Modal */}
            {showScanner && (
                <div className="fixed inset-0 bg-slate-950 z-[100] flex flex-col items-center justify-center p-6 animate-in slide-in-from-bottom-4 duration-500">
                    <div className="w-full max-w-md space-y-6">
                        <div className="flex items-center justify-between">
                            <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Scanning...</h3>
                            <button
                                onClick={stopScanning}
                                className="p-3 bg-slate-900 rounded-2xl text-slate-400 border border-white/5 active:scale-95 transition-transform"
                            >
                                <X className="w-6 h-6" />
                            </button>
                        </div>

                        <div className="relative overflow-hidden rounded-[2.5rem] border-4 border-indigo-500/30 shadow-2xl shadow-indigo-500/10 bg-slate-900/50 aspect-square flex items-center justify-center group">
                            <div id="reader" className="w-full h-full object-cover" />

                            {/* Scanner Reticle Overlay */}
                            <div className="absolute inset-0 pointer-events-none">
                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 border-2 border-indigo-400/50 rounded-3xl">
                                    <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-indigo-500 rounded-tl-xl" />
                                    <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-indigo-500 rounded-tr-xl" />
                                    <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-indigo-500 rounded-bl-xl" />
                                    <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-indigo-500 rounded-br-xl" />
                                    <div className="absolute inset-0 bg-indigo-500/5 animate-pulse" />
                                </div>
                            </div>

                            {/* Camera Switch Button - Visible only if multiple cameras */}
                            {cameras.length > 1 && (
                                <button
                                    onClick={switchCamera}
                                    className="absolute bottom-6 right-6 p-4 bg-slate-900/80 backdrop-blur-md text-white rounded-full border border-white/10 shadow-lg active:scale-90 transition-transform z-10"
                                >
                                    <Camera className="w-6 h-6" />
                                </button>
                            )}

                            {isCameraBlocked && (
                                <div className="absolute inset-0 flex items-center justify-center bg-slate-900/90 backdrop-blur-sm z-20">
                                    <div className="p-8 text-center space-y-4">
                                        <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto text-red-500">
                                            <Camera className="w-8 h-8" />
                                        </div>
                                        <div className="space-y-1">
                                            <p className="font-bold text-red-400">Camera Access Blocked</p>
                                            <p className="text-xs text-slate-500 leading-relaxed px-4">
                                                Browsers block camera on local IPs. Use "Upload QR Photo" below.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-1 gap-4">
                            <label className="flex items-center justify-center gap-3 p-5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-3xl transition-all cursor-pointer active:scale-95 shadow-lg shadow-indigo-900/20">
                                <QrCode className="w-6 h-6" />
                                <div className="text-left">
                                    <span className="block text-xs font-black uppercase tracking-widest">Upload QR Photo</span>
                                </div>
                                <input
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={handleFileUpload}
                                />
                            </label>
                        </div>

                        {scanError && <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-2xl text-red-500 text-xs font-bold text-center animate-bounce">{scanError}</div>}
                    </div>
                </div>
            )}

            <div className="bg-slate-900/60 backdrop-blur-xl rounded-[2.5rem] border border-white/5 divide-y divide-white/5 overflow-hidden shadow-2xl">
                <div className="p-8 flex items-center justify-between hover:bg-white/5 transition-colors cursor-pointer group">
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-2xl bg-blue-500/10 flex items-center justify-center text-blue-400 border border-blue-500/20 group-hover:scale-110 transition-transform">
                            <Shield className="w-7 h-7" />
                        </div>
                        <div>
                            <p className="font-bold text-lg">Fall Detection</p>
                            <p className="text-sm text-slate-500 font-medium">Auto-trigger SOS via Edge AI</p>
                        </div>
                    </div>
                    <button
                        onClick={() => onToggleFallDetection(!fallDetectionEnabled)}
                        className={`w-14 h-8 rounded-full transition-all relative ${fallDetectionEnabled ? 'bg-blue-600 shadow-[0_0_15px_rgba(37,99,235,0.4)]' : 'bg-slate-800'}`}
                    >
                        <div className={`absolute top-1 left-1 w-6 h-6 bg-white rounded-full shadow-lg transition-transform duration-300 ease-spring ${fallDetectionEnabled ? 'translate-x-6' : ''}`} />
                    </button>
                </div>

                <div className="p-8 flex items-center justify-between opacity-40 grayscale group">
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-2xl bg-slate-800 flex items-center justify-center text-slate-500 border border-white/5">
                            <Bell className="w-7 h-7" />
                        </div>
                        <div>
                            <p className="font-bold text-lg">Safety Alerts</p>
                            <p className="text-sm text-slate-500 font-medium">Nearby emergency notifications</p>
                        </div>
                    </div>
                    <div className="text-[10px] font-black uppercase tracking-widest bg-slate-800 px-3 py-1.5 rounded-lg border border-white/5">PRIORITY</div>
                </div>
            </div>

            <div className="bg-blue-600/10 backdrop-blur-lg p-6 rounded-[2rem] border border-blue-500/20 flex gap-4 text-sm text-blue-200/80 leading-relaxed shadow-lg">
                <div className="p-2 bg-blue-500/10 rounded-xl h-fit">
                    <Info className="w-5 h-5 flex-shrink-0 text-blue-400" />
                </div>
                <p className="font-medium px-1">
                    Mesh networking works by exchanging "signals" via QR. **Step 1:** Scan a peer's QR. **Step 2:** Let them scan your return QR. Done!
                </p>
            </div>
        </div>
    );
};
