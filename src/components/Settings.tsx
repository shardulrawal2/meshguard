import React, { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Bell, Shield, Info, Radio, QrCode, Camera, X } from 'lucide-react';
import { p2pMesh } from '../network/P2pMesh';
// import { bluetoothService } from '../network/BluetoothService';
import { QRCodeSVG } from 'qrcode.react';
import { Html5Qrcode } from 'html5-qrcode';
import LZString from 'lz-string';

interface SettingsProps {
    fallDetectionEnabled: boolean;
    onToggleFallDetection: (val: boolean) => void;
}

export const Settings: React.FC<SettingsProps> = ({ fallDetectionEnabled, onToggleFallDetection }) => {
    // Basic UI State
    const [mySignal, setMySignal] = useState('');
    const [peerCount, setPeerCount] = useState(0);
    const [showQr, setShowQr] = useState(false);
    const [showScanner, setShowScanner] = useState(false);
    const [scanError, setScanError] = useState('');
    const [cameras, setCameras] = useState<Array<{ id: string; label: string }>>([]);
    const [selectedCameraId, setSelectedCameraId] = useState<string>('');
    const [scannerObject, setScannerObject] = useState<Html5Qrcode | null>(null);
    const [isCameraBlocked, setIsCameraBlocked] = useState(false);
    const [connectedPeers, setConnectedPeers] = useState<string[]>([]);

    // Handshake State
    const [connectionStage, setConnectionStage] = useState<'idle' | 'showing-offer' | 'pending-acceptance' | 'showing-answer'>('idle');
    const [pendingOffer, setPendingOffer] = useState<any>(null);

    // Refs for stale closure handling
    const connectionStageRef = React.useRef(connectionStage);
    const deniedSignalsRef = React.useRef<Set<string>>(new Set());

    useEffect(() => {
        connectionStageRef.current = connectionStage;
    }, [connectionStage]);

    // Mesh & Stats Subscriptions
    useEffect(() => {
        p2pMesh.onSignal((signal) => {
            // Minify keys to reduce QR density
            const minified: any = {};
            if (signal.type) minified.t = signal.type;
            if (signal.sdp) minified.s = signal.sdp;
            if (signal.candidate) minified.c = signal.candidate;
            if (signal.sdpMid) minified.m = signal.sdpMid;
            if (signal.sdpMLineIndex !== undefined) minified.i = signal.sdpMLineIndex;

            const compressed = LZString.compressToEncodedURIComponent(JSON.stringify(minified));
            setMySignal(compressed);
        });

        p2pMesh.onPeerCountChanged((count) => {
            setPeerCount(count);
            setConnectedPeers(p2pMesh.getConnectedPeerIds());
        });

        setPeerCount(p2pMesh.getPeerCount());
        setConnectedPeers(p2pMesh.getConnectedPeerIds());
    }, []);

    // Camera list on mount
    useEffect(() => {
        Html5Qrcode.getCameras().then(devices => {
            if (devices && devices.length) {
                setCameras(devices.map(d => ({ id: d.id, label: d.label })));
                const environmentCamera = devices.find(d =>
                    d.label.toLowerCase().includes('back') ||
                    d.label.toLowerCase().includes('environment')
                );
                setSelectedCameraId(environmentCamera ? environmentCamera.id : devices[0].id);
            }
        }).catch(err => {
            console.error('Error getting cameras', err);
            setIsCameraBlocked(true);
        });
    }, []);

    // Auto-start scanning
    useEffect(() => {
        if (showScanner && selectedCameraId && !scannerObject) {
            startScanning();
        }
    }, [showScanner, selectedCameraId]);

    // HANDLERS
    const handleScanResult = (decodedText: string) => {
        try {
            let signalString = decodedText;
            try {
                const decompressed = LZString.decompressFromEncodedURIComponent(decodedText);
                if (decompressed) signalString = decompressed;
            } catch (e) { /* ignore */ }

            let signal = JSON.parse(signalString);

            // Expand minified keys
            if (signal.t) { signal.type = signal.t; delete signal.t; }
            if (signal.s) { signal.sdp = signal.s; delete signal.s; }
            if (signal.c) { signal.candidate = signal.c; delete signal.c; }
            if (signal.m) { signal.sdpMid = signal.m; delete signal.m; }
            if (signal.i !== undefined) { signal.sdpMLineIndex = signal.i; delete signal.i; }

            const currentStage = connectionStageRef.current;
            const sigStr = JSON.stringify(signal);
            if (deniedSignalsRef.current.has(sigStr)) return;

            if (signal.type === 'offer') {
                if (currentStage !== 'idle') return;
                setPendingOffer(signal);
                setConnectionStage('pending-acceptance');
                stopScanning();
            } else if (signal.type === 'answer') {
                if (currentStage !== 'showing-offer') return;
                p2pMesh.completeHandshake(signal);
                stopScanning();
                alert('✅ CONNECTION ESTABLISHED!');
                setConnectionStage('idle');
            } else if (currentStage === 'idle') {
                p2pMesh.receiveConnection(signal);
                stopScanning();
            }
        } catch (err) { /* ignore noise */ }
    };

    const handleAcceptConnection = () => {
        if (pendingOffer) {
            try {
                p2pMesh.receiveConnection(pendingOffer);
                setConnectionStage('showing-answer');
                setPendingOffer(null);
                setShowQr(true);
            } catch (err) {
                alert("Failed to accept connection.");
                setConnectionStage('idle');
                setPendingOffer(null);
            }
        }
    };

    const handleDenyConnection = () => {
        if (pendingOffer) {
            const sigStr = JSON.stringify(pendingOffer);
            deniedSignalsRef.current.add(sigStr);
            setTimeout(() => deniedSignalsRef.current.delete(sigStr), 5000);
        }
        setPendingOffer(null);
        setConnectionStage('idle');
    };

    const handleInititiate = () => {
        p2pMesh.initiateConnection();
        setConnectionStage('showing-offer');
        setShowQr(true);
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const html5QrCode = new Html5Qrcode("reader");
        try {
            const decodedText = await html5QrCode.scanFile(file, true);
            handleScanResult(decodedText);
        } catch (err) {
            setScanError('Failed to read QR from image');
        }
    };

    const startScanning = async () => {
        if (!selectedCameraId) return;
        const html5QrCode = new Html5Qrcode("reader");
        setScannerObject(html5QrCode);
        try {
            await html5QrCode.start(
                selectedCameraId,
                { fps: 30, qrbox: { width: 300, height: 300 }, aspectRatio: 1.0, experimentalFeatures: { useBarCodeDetectorIfSupported: true } } as any,
                handleScanResult,
                () => { }
            );
        } catch (err) {
            setScanError('Failed to start camera.');
        }
    };

    const stopScanning = async () => {
        if (scannerObject) {
            try {
                await scannerObject.stop();
                await scannerObject.clear();
                setScannerObject(null);
            } catch (err) { console.error(err); }
        }
        setShowScanner(false);
    };

    const switchCamera = async () => {
        if (!scannerObject || cameras.length < 2) return;
        const currentIndex = cameras.findIndex(c => c.id === selectedCameraId);
        const nextId = cameras[(currentIndex + 1) % cameras.length].id;
        setSelectedCameraId(nextId);
        await scannerObject.stop();
        startScanning();
    };

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
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

            <div className="bg-slate-900/60 backdrop-blur-xl rounded-[2.5rem] border border-white/5 p-8 space-y-6 shadow-2xl relative overflow-hidden">
                <div className="flex items-center gap-4 mb-2">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center text-indigo-400 border border-indigo-500/20">
                        <QrCode className="w-6 h-6" />
                    </div>
                    <div>
                        <p className="font-bold text-lg text-white">Crisis Connect</p>
                        <p className="text-sm text-slate-500 font-medium font-mono">LINK DEVICES OFFLINE</p>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <button onClick={handleInititiate} className="flex flex-col items-center gap-3 p-6 bg-indigo-600 hover:bg-indigo-500 text-white rounded-3xl transition-all active:scale-95 shadow-lg shadow-indigo-900/20">
                        <QrCode className="w-8 h-8" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-center">My QR</span>
                    </button>
                    <button onClick={() => setShowScanner(true)} className="flex flex-col items-center gap-3 p-6 bg-slate-800 hover:bg-slate-700 text-white rounded-3xl transition-all active:scale-95 border border-white/5">
                        <Camera className="w-8 h-8" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-center">Scan Peer</span>
                    </button>
                </div>

                {peerCount > 0 && (
                    <div className="space-y-3">
                        <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-2xl">
                            <div className="text-[10px] font-black text-green-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                                {peerCount} Active Connections
                            </div>
                            <div className="text-[9px] text-slate-400 space-y-2">
                                {connectedPeers.map((peerId) => (
                                    <div key={peerId} className="flex items-center justify-between bg-slate-900/40 p-2 rounded-lg border border-white/5">
                                        <span className="font-mono text-slate-300">{peerId}</span>
                                        <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${peerId.startsWith('peer-') ? 'bg-blue-500/20 text-blue-300' : 'bg-orange-500/20 text-orange-300'}`}>
                                            {peerId.startsWith('peer-') ? 'LAN' : 'QR'}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* XL QR Modal */}
            {showQr && (
                <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-xl z-[9999] flex items-center justify-center p-4">
                    <div className="bg-white p-6 rounded-[3rem] space-y-6 max-w-lg w-full text-center relative overflow-hidden shadow-2xl">
                        <button onClick={() => { setShowQr(false); setConnectionStage('idle'); }} className="absolute top-6 right-6 p-2 bg-slate-100 rounded-full text-slate-400 hover:text-slate-900 z-10">
                            <X className="w-5 h-5" />
                        </button>

                        <div className="space-y-1 pt-2">
                            <h3 className="text-slate-900 font-black text-2xl uppercase tracking-tighter">
                                {connectionStage === 'showing-answer' ? 'Step 2: Show Back' : 'Step 1: Scan Me'}
                            </h3>
                            <p className="text-slate-500 text-sm font-medium">
                                {connectionStage === 'showing-answer' ? 'Ask peer to scan this back' : 'Ask peer to scan this first'}
                            </p>
                        </div>

                        <div className="bg-white p-2 rounded-xl inline-block border-0 shadow-none">
                            {mySignal ? (
                                <QRCodeSVG value={mySignal} size={380} level="L" includeMargin={false} />
                            ) : (
                                <div className="w-[380px] h-[380px] flex items-center justify-center">
                                    <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                                </div>
                            )}
                        </div>

                        {connectionStage === 'showing-offer' && (
                            <button onClick={() => { setShowQr(false); setShowScanner(true); }} className="w-full py-5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-3xl font-black uppercase tracking-widest flex items-center justify-center gap-2 active:scale-95 transition-transform">
                                <Camera className="w-5 h-5" />
                                <span>Step 2: Scan Response</span>
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Accept Request Modal */}
            {connectionStage === 'pending-acceptance' && (
                <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-xl z-[9999] flex items-center justify-center p-6">
                    <div className="bg-slate-900 border border-white/10 p-8 rounded-[2.5rem] w-full max-w-sm text-center space-y-6 shadow-2xl">
                        <div className="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto text-blue-400 animate-bounce">
                            <Shield className="w-8 h-8" />
                        </div>
                        <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Connect Request</h3>
                        <div className="grid grid-cols-2 gap-4">
                            <button onClick={handleDenyConnection} className="py-4 bg-slate-800 text-slate-300 rounded-2xl font-bold uppercase">Deny</button>
                            <button onClick={handleAcceptConnection} className="py-4 bg-blue-600 text-white rounded-2xl font-black uppercase">Accept</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Fullscreen Scanner */}
            {showScanner && (
                <div className="fixed inset-0 bg-slate-950 z-[100] flex flex-col items-center justify-center p-6">
                    <div className="w-full max-w-md space-y-6">
                        <div className="flex items-center justify-between">
                            <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Scan Peer...</h3>
                            <button onClick={stopScanning} className="p-3 bg-slate-900 rounded-2xl text-slate-400 border border-white/5"><X className="w-6 h-6" /></button>
                        </div>
                        <div className="relative overflow-hidden rounded-[3rem] border-4 border-indigo-500/30 aspect-square shadow-2xl bg-black">
                            <div id="reader" className="w-full h-full" />
                            {isCameraBlocked && (
                                <div className="absolute inset-0 bg-slate-900/95 flex flex-col items-center justify-center p-8 text-center space-y-4">
                                    <p className="font-bold text-red-400">Camera Blocked</p>
                                    <button onClick={() => { setIsCameraBlocked(false); setShowScanner(false); setTimeout(() => setShowScanner(true), 100); }} className="px-6 py-2 bg-red-500/20 text-red-400 rounded-xl border border-red-500/30">Retry</button>
                                </div>
                            )}
                            {cameras.length > 1 && (
                                <button onClick={switchCamera} className="absolute bottom-6 right-6 p-4 bg-black/50 backdrop-blur-md rounded-full text-white border border-white/10 shadow-xl"><Camera className="w-6 h-6" /></button>
                            )}
                        </div>
                        <label className="flex items-center justify-center gap-3 p-6 bg-indigo-600 text-white rounded-[2rem] font-black uppercase tracking-widest cursor-pointer active:scale-95 transition-transform shadow-xl">
                            <QrCode className="w-6 h-6" />
                            <span>Upload QR Photo</span>
                            <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                        </label>
                        {scanError && <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-2xl text-red-400 text-xs font-bold text-center">{scanError}</div>}
                    </div>
                </div>
            )}

            {/* System Info */}
            <div className="bg-slate-900/60 backdrop-blur-xl rounded-[2.5rem] border border-white/5 divide-y divide-white/5 overflow-hidden shadow-2xl">
                <div className="p-8 flex items-center justify-between hover:bg-white/5 transition-colors cursor-pointer" onClick={() => onToggleFallDetection(!fallDetectionEnabled)}>
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-2xl bg-blue-500/10 flex items-center justify-center text-blue-400 border border-blue-500/20"><Shield className="w-7 h-7" /></div>
                        <div>
                            <p className="font-bold text-lg text-white">Fall Detection</p>
                            <p className="text-sm text-slate-500 font-medium whitespace-nowrap">Auto-trigger SOS via Edge AI</p>
                        </div>
                    </div>
                    <div className={`w-14 h-8 rounded-full transition-all relative ${fallDetectionEnabled ? 'bg-blue-600 shadow-[0_0_15px_rgba(37,99,235,0.4)]' : 'bg-slate-800'}`}>
                        <div className={`absolute top-1 left-1 w-6 h-6 bg-white rounded-full transition-transform duration-300 ${fallDetectionEnabled ? 'translate-x-6' : ''}`} />
                    </div>
                </div>

                <div className="p-8 flex items-center justify-between opacity-50 grayscale">
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-2xl bg-slate-800 flex items-center justify-center text-slate-500 border border-white/5"><Bell className="w-7 h-7" /></div>
                        <div><p className="font-bold text-lg text-white">Safety Alerts</p><p className="text-sm text-slate-500 font-medium">Broadcast emergency pings</p></div>
                    </div>
                    <div className="text-[10px] font-black uppercase tracking-widest bg-slate-800 px-3 py-1.5 rounded-lg border border-white/5">DISABLED</div>
                </div>
            </div>

            <div className="bg-blue-600/10 backdrop-blur-lg p-6 rounded-[2rem] border border-blue-500/20 flex gap-4 text-sm text-blue-200/80 leading-relaxed shadow-lg">
                <Info className="w-5 h-5 flex-shrink-0 text-blue-400 mt-1" />
                <p className="font-medium">
                    Mesh networking works by exchanging "signals" via QR. **Step 1:** Scan a peer's QR. **Step 2:** Let them scan your return QR. Done!
                </p>
            </div>
        </div>
    );
};
