import React, { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Bell, Shield, Info, Radio, QrCode, Camera, X, Bluetooth } from 'lucide-react';
import { p2pMesh } from '../network/P2pMesh';
import { bluetoothService } from '../network/BluetoothService';
import { QRCodeSVG } from 'qrcode.react';
import { Html5Qrcode } from 'html5-qrcode';

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
    const [connectionStage, setConnectionStage] = useState<'idle' | 'scanning' | 'bluetooth-connecting' | 'connecting-webrtc'>('idle');
    const [targetPeerId, setTargetPeerId] = useState<string | null>(null);

    // Refs for stale closure handling
    const connectionStageRef = React.useRef(connectionStage);
    const targetPeerIdRef = React.useRef(targetPeerId);

    useEffect(() => {
        connectionStageRef.current = connectionStage;
        targetPeerIdRef.current = targetPeerId;
    }, [connectionStage, targetPeerId]);

    // Mesh & Stats Subscriptions
    useEffect(() => {
        // Generate Minimal QR: mg://ID/Timestamp
        const shortId = p2pMesh.myId.replace('peer-', '').slice(0, 10);
        const qrPayload = `mg://${shortId}/${Date.now()}`;
        setMySignal(qrPayload);

        p2pMesh.onPeerCountChanged((count) => {
            setPeerCount(count);
            setConnectedPeers(p2pMesh.getConnectedPeerIds());
        });

        // Listen for signals via Bluetooth
        bluetoothService.onSignal((senderId, signal) => {
            console.log(`[Handshake] Received Bluetooth signal from ${senderId}`);
            if (signal.type === 'offer') {
                const peer = p2pMesh.receiveConnection(signal, senderId);
                peer.on('signal', (answer: any) => {
                    bluetoothService.sendSignal(senderId, answer);
                });
            } else if (signal.type === 'answer') {
                p2pMesh.completeHandshake(signal);
                setConnectionStage('idle');
            }
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
        }).catch(() => setIsCameraBlocked(true));
    }, []);

    useEffect(() => {
        if (showScanner && selectedCameraId && !scannerObject) {
            startScanning();
        }
    }, [showScanner, selectedCameraId]);

    // HANDLERS
    const stopScanning = async () => {
        if (scannerObject) {
            try { await scannerObject.stop(); await scannerObject.clear(); setScannerObject(null); } catch (e) { }
        }
        setShowScanner(false);
    };

    const handleScanResult = async (decodedText: string) => {
        if (!decodedText.startsWith('mg://')) return;

        try {
            const parts = decodedText.replace('mg://', '').split('/');
            const peerId = parts[0];
            setTargetPeerId(peerId);
            setConnectionStage('bluetooth-connecting');
            stopScanning();

            // Step 1: Establish Bluetooth Connection
            const success = await bluetoothService.scanAndConnect(peerId);
            if (!success) {
                setScanError('Bluetooth handshake failed. Retrying context...');
                setConnectionStage('idle');
                return;
            }

            // Step 2: Initiate WebRTC Handshake via Bluetooth
            setConnectionStage('connecting-webrtc');
            const peer = p2pMesh.initiateConnection(peerId);
            peer.on('signal', (offer: any) => {
                bluetoothService.sendSignal(peerId, offer);
            });
        } catch (err) {
            setScanError('Invalid Handshake Protocol');
        }
    };

    const startScanning = async () => {
        if (!selectedCameraId) return;
        const html5QrCode = new Html5Qrcode("reader");
        setScannerObject(html5QrCode);
        try {
            await html5QrCode.start(
                selectedCameraId,
                { fps: 30, qrbox: { width: 300, height: 300 }, aspectRatio: 1.0 } as any,
                handleScanResult,
                () => { }
            );
        } catch (err) { setScanError('Failed to start camera.'); }
    };

    const handleInititiate = () => {
        setShowQr(true);
        setConnectionStage('idle');
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const html5QrCode = new Html5Qrcode("reader");
        try {
            const decodedText = await html5QrCode.scanFile(file, true);
            handleScanResult(decodedText);
        } catch (err) { setScanError('Failed to read QR photo'); }
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
            {/* Header */}
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

            {/* Link Options Card */}
            <div className="bg-slate-900/60 backdrop-blur-xl rounded-[2.5rem] border border-white/5 p-8 space-y-6 shadow-2xl relative overflow-hidden">
                <div className="flex items-center gap-4 mb-2">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center text-indigo-400 border border-indigo-500/20">
                        <QrCode className="w-6 h-6" />
                    </div>
                    <div>
                        <p className="font-bold text-lg text-white">Crisis Connect v2</p>
                        <p className="text-sm text-slate-500 font-medium font-mono uppercase tracking-tighter">Hybrid BLE-Mesh Handshake</p>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <button onClick={handleInititiate} className="flex flex-col items-center gap-3 p-6 bg-indigo-600 hover:bg-indigo-500 text-white rounded-3xl transition-all active:scale-95 shadow-lg shadow-indigo-900/20">
                        <QrCode className="w-8 h-8" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-center">Show My QR</span>
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
                                            {peerId.startsWith('peer-') ? 'LAN' : 'BLE'}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Hybrid QR Modal */}
            {showQr && (
                <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-xl z-[9999] flex items-center justify-center p-4">
                    <div className="bg-white p-8 rounded-[3.5rem] space-y-6 max-w-lg w-full text-center relative overflow-hidden shadow-2xl">
                        <button onClick={() => setShowQr(false)} className="absolute top-6 right-6 p-2 bg-slate-100 rounded-full text-slate-400 hover:text-slate-900 z-10 transition-colors">
                            <X className="w-5 h-5" />
                        </button>

                        <div className="space-y-1">
                            <div className="flex justify-center mb-2">
                                <div className="px-3 py-1 bg-indigo-100 text-indigo-600 rounded-full text-[10px] font-black uppercase tracking-widest border border-indigo-200">
                                    Ultra-Scannable v2
                                </div>
                            </div>
                            <h3 className="text-slate-900 font-black text-3xl uppercase tracking-tighter">Scan to Link</h3>
                            <p className="text-slate-500 text-sm font-medium px-4">
                                This code only contains your identity. Secure handshake happens over Bluetooth.
                            </p>
                        </div>

                        <div className="bg-white p-4 rounded-[2rem] inline-block border-4 border-slate-50">
                            {mySignal && (
                                <QRCodeSVG
                                    value={mySignal}
                                    size={340}
                                    level="M"
                                    includeMargin={true}
                                />
                            )}
                        </div>

                        <div className="bg-slate-50 p-4 rounded-2xl flex items-center gap-3 text-left">
                            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white">
                                <Bluetooth className="w-5 h-5 animate-pulse" />
                            </div>
                            <div>
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Bluetooth ID</p>
                                <p className="text-sm font-mono font-bold text-slate-900">MeshGuard-{p2pMesh.myId.replace('peer-', '').slice(0, 10)}</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Connection Status Overlay */}
            {connectionStage !== 'idle' && connectionStage !== 'scanning' && (
                <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-xl z-[10000] flex items-center justify-center p-6">
                    <div className="bg-slate-900 border border-white/10 p-10 rounded-[3rem] w-full max-w-sm text-center space-y-8 shadow-2xl animate-in zoom-in-95 duration-300">
                        <div className="relative">
                            <div className="w-24 h-24 bg-indigo-600/20 rounded-full flex items-center justify-center mx-auto text-indigo-400">
                                <Bluetooth className="w-10 h-10 animate-bounce" />
                            </div>
                            <div className="absolute inset-0 w-24 h-24 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mx-auto" />
                        </div>
                        <div className="space-y-3">
                            <h3 className="text-2xl font-black text-white uppercase tracking-tighter">
                                {connectionStage === 'bluetooth-connecting' ? 'BLE Handshake' : 'WebRTC Tunneling'}
                            </h3>
                            <p className="text-slate-400 text-sm font-medium">
                                {connectionStage === 'bluetooth-connecting'
                                    ? `Locating MeshGuard-${targetPeerId}...`
                                    : 'Securing P2P mesh channel...'}
                            </p>
                        </div>
                        <button
                            onClick={() => setConnectionStage('idle')}
                            className="w-full py-4 bg-slate-800 text-slate-400 rounded-2xl font-bold uppercase tracking-widest text-xs border border-white/5 active:scale-95 transition-transform"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Fullscreen Scanner */}
            {showScanner && (
                <div className="fixed inset-0 bg-slate-950 z-[100] flex flex-col items-center justify-center p-6 transition-all">
                    <div className="w-full max-w-md space-y-6">
                        <div className="flex items-center justify-between px-2">
                            <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Locate Peer...</h3>
                            <button onClick={stopScanning} className="p-4 bg-slate-900 rounded-[1.5rem] text-slate-400 border border-white/5 active:scale-90 transition-transform"><X className="w-6 h-6" /></button>
                        </div>
                        <div className="relative overflow-hidden rounded-[4rem] border-4 border-indigo-500/30 aspect-square shadow-2xl bg-black group">
                            <div id="reader" className="w-full h-full" />
                            <div className="absolute inset-0 pointer-events-none border-[40px] border-black/40" />
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 border-2 border-indigo-400/50 rounded-3xl" />
                            {isCameraBlocked && (
                                <div className="absolute inset-0 bg-slate-900/95 flex flex-col items-center justify-center p-8 text-center space-y-4">
                                    <p className="font-bold text-red-400">Camera Access Required</p>
                                    <button onClick={() => { setIsCameraBlocked(false); setShowScanner(false); setTimeout(() => setShowScanner(true), 100); }} className="px-6 py-2 bg-red-500/20 text-red-400 rounded-xl border border-red-500/30">Retry</button>
                                </div>
                            )}
                            {cameras.length > 1 && (
                                <button onClick={switchCamera} className="absolute bottom-10 right-10 p-5 bg-black/60 backdrop-blur-xl rounded-full text-white border border-white/10 shadow-2xl active:scale-90 transition-transform"><Camera className="w-6 h-6" /></button>
                            )}
                        </div>
                        <label className="flex items-center justify-center gap-3 p-8 bg-indigo-600 hover:bg-indigo-500 text-white rounded-[2.5rem] font-black uppercase tracking-widest cursor-pointer active:scale-95 transition-all shadow-2xl shadow-indigo-900/40">
                            <QrCode className="w-6 h-6" />
                            <span>Upload QR Photo</span>
                            <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                        </label>
                        {scanError && <div className="bg-red-500/10 border border-red-500/20 p-5 rounded-3xl text-red-400 text-xs font-bold text-center animate-shake">{scanError}</div>}
                    </div>
                </div>
            )}

            {/* Preferences */}
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

            {/* Footer Summary */}
            <div className="bg-blue-600/10 backdrop-blur-lg p-6 rounded-[2rem] border border-blue-500/20 flex gap-4 text-sm text-blue-200/80 leading-relaxed shadow-lg">
                <div className="flex-shrink-0 mt-1">
                    <Info className="w-5 h-5 text-blue-400" />
                </div>
                <p className="font-medium">
                    This updated system uses **Hybrid Discovery**. Scan the tiny QR to find the peer, then high-speed **Web Bluetooth** secures the link and tunnels the connection.
                </p>
            </div>
        </div>
    );
};
