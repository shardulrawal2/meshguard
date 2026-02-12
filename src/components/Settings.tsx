import React, { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Shield, Info, Radio, QrCode, Camera, X, CheckCircle2 } from 'lucide-react';
import { p2pMesh } from '../network/P2pMesh';
import { QRCodeSVG } from 'qrcode.react';
import { Html5Qrcode } from 'html5-qrcode';

interface SettingsProps {
    fallDetectionEnabled: boolean;
    onToggleFallDetection: (val: boolean) => void;
}

export const Settings: React.FC<SettingsProps> = ({ fallDetectionEnabled, onToggleFallDetection }) => {
    // Basic UI State
    const [peerCount, setPeerCount] = useState(0);
    const [showQrModal, setShowQrModal] = useState(false);
    const [showScanner, setShowScanner] = useState(false);
    const [scanError, setScanError] = useState('');
    const [cameras, setCameras] = useState<Array<{ id: string; label: string }>>([]);
    const [selectedCameraId, setSelectedCameraId] = useState<string>('');
    const [scannerObject, setScannerObject] = useState<Html5Qrcode | null>(null);
    const [isCameraBlocked, setIsCameraBlocked] = useState(false);
    const [connectedPeers, setConnectedPeers] = useState<string[]>([]);

    // Macroscopic Handshake State
    const [handshakeStep, setHandshakeStep] = useState<'idle' | 'showing-offer' | 'scanning-answer' | 'showing-answer'>('idle');
    const [activeSignal, setActiveSignal] = useState('');
    const [statusMessage, setStatusMessage] = useState('');

    // Mesh Subscriptions
    useEffect(() => {
        p2pMesh.onPeerCountChanged((count) => {
            setPeerCount(count);
            setConnectedPeers(p2pMesh.getConnectedPeerIds());
        });
        setPeerCount(p2pMesh.getPeerCount());
        setConnectedPeers(p2pMesh.getConnectedPeerIds());
    }, []);

    // Camera setup
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

    // SCANNER LOGIC
    const startScanning = async () => {
        if (!selectedCameraId) return;
        const html5QrCode = new Html5Qrcode("reader");
        setScannerObject(html5QrCode);
        try {
            await html5QrCode.start(
                selectedCameraId,
                { fps: 60, qrbox: { width: 320, height: 320 }, aspectRatio: 1.0 } as any,
                handleScanResult,
                () => { }
            );
        } catch (err) { setScanError('Failed to start camera.'); }
    };

    const stopScanning = async () => {
        if (scannerObject) {
            try { await scannerObject.stop(); await scannerObject.clear(); setScannerObject(null); } catch (e) { }
        }
        setShowScanner(false);
    };

    const handleScanResult = async (decodedText: string) => {
        setScanError('');
        try {
            const signal = p2pMesh.expandSignal(decodedText);
            if (!signal) {
                setScanError('Invalid MeshGuard Signal');
                return;
            }

            if (handshakeStep === 'idle') {
                // We are the receiver of an OFFER
                if (signal.type !== 'offer') {
                    setScanError('Please scan an Initiator QR first');
                    return;
                }
                setStatusMessage('Generating Response...');
                stopScanning();

                const peer = p2pMesh.receiveConnection(signal);
                peer.on('signal', (data: any) => {
                    const minified = (p2pMesh as any).minifySignal(data);
                    setActiveSignal(minified);
                    setHandshakeStep('showing-answer');
                    setShowQrModal(true);
                });
            } else if (handshakeStep === 'scanning-answer') {
                // We are the initiator receiving an ANSWER
                if (signal.type !== 'answer') {
                    setScanError('Please scan the Response QR');
                    return;
                }
                p2pMesh.completeHandshake(signal);
                setHandshakeStep('idle');
                stopScanning();
                setStatusMessage('Connected!');
                setTimeout(() => setStatusMessage(''), 3000);
            }
        } catch (err) {
            setScanError('Handshake Failed');
        }
    };

    // ACTION HANDLERS
    const handleStartInitiation = () => {
        setHandshakeStep('showing-offer');
        const peer = p2pMesh.initiateConnection();
        peer.on('signal', (data: any) => {
            const minified = (p2pMesh as any).minifySignal(data);
            setActiveSignal(minified);
            setShowQrModal(true);
        });
    };

    const handleSwitchToScanAnswer = () => {
        setShowQrModal(false);
        setHandshakeStep('scanning-answer');
        setShowScanner(true);
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
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-20">
            {/* Header */}
            <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-500/10 rounded-xl">
                        <SettingsIcon className="w-6 h-6 text-blue-400" />
                    </div>
                    <h2 className="text-2xl font-bold tracking-tight">Mesh Settings</h2>
                </div>
                <div className="flex items-center gap-2 px-3 py-1 bg-blue-500/10 rounded-full border border-blue-500/20">
                    <Radio className={`w-3.5 h-3.5 ${peerCount > 0 ? 'text-green-400 animate-pulse' : 'text-slate-500'}`} />
                    <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">{peerCount} PEERS ONLINE</span>
                </div>
            </div>

            {/* Macroscopic Link Card */}
            <div className="bg-slate-900/60 backdrop-blur-xl rounded-[3rem] border border-white/10 p-10 space-y-8 shadow-2xl relative overflow-hidden group">
                <div className="flex items-center gap-5">
                    <div className="w-16 h-16 rounded-[1.5rem] bg-indigo-500/10 flex items-center justify-center text-indigo-400 border border-indigo-500/20 shadow-inner">
                        <QrCode className="w-8 h-8" />
                    </div>
                    <div>
                        <p className="font-black text-2xl text-white uppercase tracking-tighter">Handshake v3</p>
                        <p className="text-sm text-slate-500 font-bold uppercase tracking-widest opacity-60">Pure Offline P2P Link</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-4">
                    <button
                        onClick={handleStartInitiation}
                        className="flex items-center justify-center gap-4 p-8 bg-indigo-600 hover:bg-indigo-500 text-white rounded-[2rem] transition-all active:scale-95 shadow-xl shadow-indigo-900/40 relative overflow-hidden"
                    >
                        <QrCode className="w-8 h-8" />
                        <span className="font-black uppercase tracking-widest text-lg">Generate My Link</span>
                        <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>

                    <button
                        onClick={() => { setHandshakeStep('idle'); setShowScanner(true); }}
                        className="flex items-center justify-center gap-4 p-8 bg-slate-800 hover:bg-slate-700 text-white rounded-[2rem] transition-all active:scale-95 border border-white/5"
                    >
                        <Camera className="w-8 h-8 text-slate-400" />
                        <span className="font-black uppercase tracking-widest text-lg">Scan a Peer</span>
                    </button>
                </div>

                {statusMessage && (
                    <div className="flex items-center justify-center gap-2 text-green-400 font-black uppercase tracking-widest text-xs animate-bounce bg-green-500/10 py-3 rounded-2xl border border-green-500/20">
                        <CheckCircle2 className="w-4 h-4" />
                        {statusMessage}
                    </div>
                )}
            </div>

            {/* Peer List */}
            {peerCount > 0 && (
                <div className="bg-slate-900/40 rounded-[2.5rem] border border-white/5 p-8 space-y-4">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-2">Active Mesh Nodes</p>
                    <div className="grid gap-3">
                        {connectedPeers.map((id) => (
                            <div key={id} className="flex items-center justify-between bg-slate-900 p-4 rounded-2xl border border-white/5">
                                <div className="flex items-center gap-3">
                                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
                                    <span className="font-mono text-sm font-bold text-slate-300">{id}</span>
                                </div>
                                <span className="text-[9px] font-black uppercase tracking-widest bg-blue-500/10 text-blue-400 px-3 py-1 rounded-full border border-blue-500/10">Connected</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* MACROSCOPIC QR MODAL */}
            {showQrModal && (
                <div className="fixed inset-0 bg-slate-950/98 backdrop-blur-3xl z-[9999] flex flex-col items-center justify-center p-4 overflow-y-auto">
                    <div className="bg-white p-10 rounded-[4rem] space-y-8 max-w-xl w-full text-center relative shadow-[0_0_100px_rgba(79,70,229,0.3)]">
                        <button onClick={() => setShowQrModal(false)} className="absolute top-8 right-8 p-3 bg-slate-100 rounded-full text-slate-400 hover:text-slate-900 transition-all active:scale-90">
                            <X className="w-6 h-6" />
                        </button>

                        <div className="space-y-2">
                            <div className="inline-block px-4 py-2 bg-indigo-100 text-indigo-700 rounded-full text-xs font-black uppercase tracking-widest border border-indigo-200 mb-2">
                                {handshakeStep === 'showing-offer' ? 'Step 1: Initiation' : 'Step 2: Response'}
                            </div>
                            <h3 className="text-slate-900 font-extrabold text-4xl uppercase tracking-tighter leading-none">
                                {handshakeStep === 'showing-offer' ? 'Peer Discovery' : 'Finalize Link'}
                            </h3>
                            <p className="text-slate-500 text-base font-bold px-6">
                                {handshakeStep === 'showing-offer'
                                    ? 'Show this to the peer who wants to connect.'
                                    : 'A peer has scanned you. Show them this response.'}
                            </p>
                        </div>

                        <div className="bg-white p-6 rounded-[3rem] inline-block border-[12px] border-slate-50 shadow-inner">
                            {activeSignal && (
                                <QRCodeSVG
                                    value={activeSignal}
                                    size={400}
                                    level="L"
                                    includeMargin={false}
                                />
                            )}
                        </div>

                        {handshakeStep === 'showing-offer' && (
                            <button
                                onClick={handleSwitchToScanAnswer}
                                className="w-full p-8 bg-indigo-600 hover:bg-indigo-700 text-white rounded-[2.5rem] font-black uppercase tracking-widest text-xl shadow-2xl shadow-indigo-500/40 animate-pulse hover:animate-none transition-all flex items-center justify-center gap-4"
                            >
                                <Camera className="w-8 h-8" />
                                <span>Scan Their Response</span>
                            </button>
                        )}

                        {handshakeStep === 'showing-answer' && (
                            <p className="text-indigo-600 font-black uppercase tracking-widest text-sm animate-pulse py-4 italic">
                                Once they scan this, you will be linked...
                            </p>
                        )}
                    </div>
                </div>
            )}

            {/* FULLSCREEN SCANNER */}
            {showScanner && (
                <div className="fixed inset-0 bg-black z-[10000] flex flex-col items-center justify-center p-6 transition-all">
                    <div className="w-full max-w-md space-y-8">
                        <div className="flex items-center justify-between px-4">
                            <h3 className="text-3xl font-black text-white uppercase tracking-tighter">
                                {handshakeStep === 'scanning-answer' ? 'Scan Response' : 'Scan Peer'}
                            </h3>
                            <button onClick={stopScanning} className="p-5 bg-white/10 rounded-[2rem] text-white backdrop-blur-xl border border-white/10 active:scale-90 transition-all"><X className="w-7 h-7" /></button>
                        </div>

                        <div className="relative overflow-hidden rounded-[5rem] border-8 border-indigo-500 aspect-square shadow-[0_0_80px_rgba(79,70,229,0.5)] bg-black">
                            <div id="reader" className="w-full h-full" />
                            <div className="absolute inset-0 pointer-events-none border-[60px] border-black/60" />
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 border-4 border-indigo-400 rounded-[3rem] shadow-[0_0_30px_rgba(255,255,255,0.2)]" />

                            {/* Scanning Animation */}
                            <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-64 h-1 bg-indigo-500 shadow-[0_0_15px_rgba(79,70,229,1)] animate-scan-move pointer-events-none" />

                            {isCameraBlocked && (
                                <div className="absolute inset-0 bg-slate-900/95 flex flex-col items-center justify-center p-10 text-center space-y-6">
                                    <Camera className="w-16 h-16 text-red-500 mb-2" />
                                    <p className="font-black text-2xl text-white uppercase">Camera Prohibited</p>
                                    <button onClick={() => { setIsCameraBlocked(false); setShowScanner(false); setTimeout(() => setShowScanner(true), 100); }} className="px-10 py-4 bg-indigo-600 text-white font-black uppercase tracking-widest rounded-2xl shadow-xl shadow-indigo-900/40">Request Access</button>
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-1 gap-4">
                            <label className="flex items-center justify-center gap-4 p-8 bg-white/5 hover:bg-white/10 text-white rounded-[2.5rem] font-black uppercase tracking-widest cursor-pointer backdrop-blur-xl border border-white/10 transition-all group">
                                <QrCode className="w-7 h-7 text-indigo-400" />
                                <span>Upload Photo</span>
                                <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                            </label>

                            {cameras.length > 1 && (
                                <button onClick={switchCamera} className="p-8 bg-white text-black rounded-[2.5rem] font-black uppercase tracking-widest flex items-center justify-center gap-4 shadow-xl active:scale-95 transition-all">
                                    <Camera className="w-7 h-7" />
                                    <span>Switch Camera</span>
                                </button>
                            )}
                        </div>

                        {scanError && (
                            <div className="bg-red-500 border-2 border-red-400 p-6 rounded-[2rem] text-white text-sm font-black text-center uppercase tracking-widest animate-shake shadow-2xl">
                                {scanError}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Safety Preferences */}
            <div className="bg-slate-900/60 backdrop-blur-xl rounded-[3rem] border border-white/5 divide-y divide-white/5 overflow-hidden shadow-2xl">
                <div className="p-10 flex items-center justify-between hover:bg-white/5 transition-all cursor-pointer group" onClick={() => onToggleFallDetection(!fallDetectionEnabled)}>
                    <div className="flex items-center gap-5">
                        <div className="w-16 h-16 rounded-2xl bg-blue-500/10 flex items-center justify-center text-blue-400 border border-blue-500/20 group-hover:scale-110 transition-transform"><Shield className="w-8 h-8" /></div>
                        <div>
                            <p className="font-extrabold text-xl text-white">Fall Detection</p>
                            <p className="text-sm text-slate-500 font-bold uppercase tracking-widest opacity-60">Edge AI Protection</p>
                        </div>
                    </div>
                    <div className={`w-16 h-9 rounded-full transition-all relative ${fallDetectionEnabled ? 'bg-blue-600 shadow-[0_0_20px_rgba(37,99,235,0.5)]' : 'bg-slate-800'}`}>
                        <div className={`absolute top-1.5 left-1.5 w-6 h-6 bg-white rounded-full transition-transform duration-300 ${fallDetectionEnabled ? 'translate-x-7' : ''}`} />
                    </div>
                </div>
            </div>

            <div className="bg-blue-600/10 backdrop-blur-lg p-8 rounded-[2.5rem] border border-blue-500/30 flex gap-6 items-start shadow-2xl">
                <div className="p-3 bg-blue-500/20 rounded-2xl">
                    <Info className="w-6 h-6 text-blue-400" />
                </div>
                <div>
                    <p className="font-black text-blue-400 uppercase tracking-widest text-xs mb-1">Peer Safety Tip</p>
                    <p className="text-blue-100 font-bold leading-relaxed opacity-80 italic">
                        "Handshake v3 used macroscopic modules optimized for low-light scanning. No Bluetooth required."
                    </p>
                </div>
            </div>

            <style>{`
                @keyframes scan-move {
                    0% { top: 25%; opacity: 0; }
                    10% { opacity: 1; }
                    90% { opacity: 1; }
                    100% { top: 75%; opacity: 0; }
                }
                .animate-scan-move {
                    animation: scan-move 2s infinite ease-in-out;
                }
                @keyframes shake {
                    0%, 100% { transform: translateX(0); }
                    25% { transform: translateX(-5px); }
                    75% { transform: translateX(5px); }
                }
                .animate-shake {
                    animation: shake 0.4s ease-in-out;
                }
            `}</style>
        </div>
    );
};
