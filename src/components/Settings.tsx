import React, { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Shield, Info, Radio, QrCode, Camera, X, CheckCircle2 } from 'lucide-react';
import { p2pMesh } from '../network/P2pMesh';
import { QRCodeCanvas } from 'qrcode.react';
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

    // Responsive QR size calculation
    const [qrSize, setQrSize] = useState(280);
    useEffect(() => {
        const updateSize = () => {
            const size = Math.min(window.innerWidth * 0.75, 400);
            setQrSize(size);
        };
        updateSize();
        window.addEventListener('resize', updateSize);
        return () => window.removeEventListener('resize', updateSize);
    }, []);

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
                { fps: 60, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 } as any,
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
                if (signal.type !== 'offer') {
                    setScanError('Scan an Initiator QR first');
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
                if (signal.type !== 'answer') {
                    setScanError('Scan the Response QR');
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
        <div className="space-y-6 md:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-20">
            {/* Header */}
            <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2 md:gap-3">
                    <div className="p-2 bg-blue-500/10 rounded-xl">
                        <SettingsIcon className="w-5 h-5 md:w-6 md:h-6 text-blue-400" />
                    </div>
                    <h2 className="text-xl md:text-2xl font-bold tracking-tight">Mesh Settings</h2>
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-500/10 rounded-full border border-blue-500/20">
                    <Radio className={`w-3 h-3 ${peerCount > 0 ? 'text-green-400 animate-pulse' : 'text-slate-500'}`} />
                    <span className="text-[9px] md:text-[10px] font-black text-blue-400 uppercase tracking-widest">{peerCount} PEERS</span>
                </div>
            </div>

            {/* Macroscopic Link Card */}
            <div className="bg-slate-900/60 backdrop-blur-xl rounded-[2rem] md:rounded-[3rem] border border-white/10 p-6 md:p-10 space-y-6 md:space-y-8 shadow-2xl relative overflow-hidden">
                <div className="flex items-center gap-4 md:gap-5">
                    <div className="w-12 h-12 md:w-16 md:h-16 rounded-xl md:rounded-[1.5rem] bg-indigo-500/10 flex items-center justify-center text-indigo-400 border border-indigo-500/20">
                        <QrCode className="w-6 h-6 md:w-8 md:h-8" />
                    </div>
                    <div>
                        <p className="font-black text-xl md:text-2xl text-white uppercase tracking-tighter">MicroLink v4</p>
                        <p className="text-[10px] md:text-sm text-slate-500 font-bold uppercase tracking-widest opacity-60">Ultra-Low-Density QR</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-3 md:gap-4">
                    <button
                        onClick={handleStartInitiation}
                        className="flex items-center justify-center gap-3 md:gap-4 p-6 md:p-8 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl md:rounded-[2rem] transition-all active:scale-95 shadow-xl shadow-indigo-900/40"
                    >
                        <QrCode className="w-6 h-6 md:w-8 md:h-8" />
                        <span className="font-black uppercase tracking-widest text-sm md:text-lg">Generate Link</span>
                    </button>

                    <button
                        onClick={() => { setHandshakeStep('idle'); setShowScanner(true); }}
                        className="flex items-center justify-center gap-3 md:gap-4 p-6 md:p-8 bg-slate-800 hover:bg-slate-700 text-white rounded-2xl md:rounded-[2rem] transition-all active:scale-95 border border-white/5"
                    >
                        <Camera className="w-6 h-6 md:w-8 md:h-8 text-slate-400" />
                        <span className="font-black uppercase tracking-widest text-sm md:text-lg">Scan Peer</span>
                    </button>
                </div>

                {statusMessage && (
                    <div className="flex items-center justify-center gap-2 text-green-400 font-black uppercase tracking-widest text-[10px] animate-bounce bg-green-500/10 py-2.5 rounded-xl border border-green-500/20">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {statusMessage}
                    </div>
                )}
            </div>

            {/* Peer List */}
            {peerCount > 0 && (
                <div className="bg-slate-900/40 rounded-[2rem] border border-white/5 p-6 md:p-8 space-y-4">
                    <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest px-1">Active Nodes</p>
                    <div className="grid gap-2">
                        {connectedPeers.map((id) => (
                            <div key={id} className="flex items-center justify-between bg-slate-900 p-3.5 rounded-xl border border-white/5">
                                <div className="flex items-center gap-2.5">
                                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
                                    <span className="font-mono text-xs font-bold text-slate-300">{id}</span>
                                </div>
                                <span className="text-[8px] font-black uppercase tracking-widest bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full border border-blue-500/10">ON</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* MACROSCOPIC QR MODAL */}
            {showQrModal && (
                <div className="fixed inset-0 bg-slate-950/98 backdrop-blur-3xl z-[9999] flex flex-col items-center justify-center p-4">
                    <div className="bg-white p-6 md:p-10 rounded-[2.5rem] md:rounded-[4rem] space-y-6 md:space-y-8 max-w-[90vw] md:max-w-xl w-full text-center relative shadow-2xl">
                        <button onClick={() => setShowQrModal(false)} className="absolute top-4 right-4 md:top-8 md:right-8 p-2 bg-slate-100 rounded-full text-slate-400 active:scale-90 transition-all">
                            <X className="w-5 h-5 md:w-6 md:h-6" />
                        </button>

                        <div className="space-y-1.5">
                            <div className="inline-block px-3 py-1 bg-indigo-100 text-indigo-700 rounded-full text-[9px] font-black uppercase tracking-widest border border-indigo-200">
                                {handshakeStep === 'showing-offer' ? 'Step 1' : 'Step 2'}
                            </div>
                            <h3 className="text-slate-900 font-black text-2xl md:text-3xl uppercase tracking-tighter leading-none">
                                {handshakeStep === 'showing-offer' ? 'Show to Peer' : 'Finalize'}
                            </h3>
                            <p className="text-slate-500 text-[10px] md:text-sm font-bold opacity-70">
                                Macroscopic dots for instant focus
                            </p>
                        </div>

                        <div className="bg-white p-4 rounded-[2rem] inline-block border-[8px] border-slate-50 shadow-inner">
                            {activeSignal && (
                                <QRCodeCanvas
                                    value={activeSignal}
                                    size={qrSize}
                                    level="L"
                                    includeMargin={true}
                                />
                            )}
                        </div>

                        {handshakeStep === 'showing-offer' && (
                            <button
                                onClick={handleSwitchToScanAnswer}
                                className="w-full p-6 bg-indigo-600 text-white rounded-2xl md:rounded-[2.5rem] font-black uppercase tracking-widest text-sm md:text-lg shadow-xl shadow-indigo-500/40 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-3"
                            >
                                <Camera className="w-6 h-6" />
                                <span>Scan Their Response</span>
                            </button>
                        )}

                        {handshakeStep === 'showing-answer' && (
                            <p className="text-indigo-600 font-black uppercase tracking-widest text-[10px] animate-pulse py-2">
                                Waiting for link stabilization...
                            </p>
                        )}
                    </div>
                </div>
            )}

            {/* FULLSCREEN SCANNER */}
            {showScanner && (
                <div className="fixed inset-0 bg-black z-[10000] flex flex-col items-center justify-center p-4">
                    <div className="w-full max-w-sm space-y-6">
                        <div className="flex items-center justify-between px-2">
                            <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Scanning...</h3>
                            <button onClick={stopScanning} className="p-4 bg-white/10 rounded-2xl text-white border border-white/10 active:scale-90 transition-all"><X className="w-6 h-6" /></button>
                        </div>

                        <div className="relative overflow-hidden rounded-[3rem] border-4 border-indigo-500 aspect-square bg-black">
                            <div id="reader" className="w-full h-full" />
                            <div className="absolute inset-0 pointer-events-none border-[40px] border-black/60" />
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 border-2 border-indigo-400/50 rounded-3xl" />

                            {/* Scanning Animation */}
                            <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-48 h-0.5 bg-indigo-500 shadow-[0_0_15px_rgba(79,70,229,1)] animate-scan-move pointer-events-none" />

                            {isCameraBlocked && (
                                <div className="absolute inset-0 bg-slate-950 flex flex-col items-center justify-center p-6 text-center space-y-4">
                                    <p className="font-black text-white uppercase">Camera Access Required</p>
                                    <button onClick={() => { setIsCameraBlocked(false); setShowScanner(false); setTimeout(() => setShowScanner(true), 100); }} className="px-6 py-3 bg-indigo-600 text-white font-black uppercase rounded-xl">Retry</button>
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-1 gap-3">
                            <label className="flex items-center justify-center gap-3 p-6 bg-white/5 text-white rounded-2xl font-black uppercase tracking-widest cursor-pointer border border-white/10 active:scale-95 transition-all">
                                <QrCode className="w-5 h-5 text-indigo-400" />
                                <span className="text-xs">Upload From Library</span>
                                <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                            </label>

                            {cameras.length > 1 && (
                                <button onClick={switchCamera} className="p-6 bg-white text-black rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-3 active:scale-95 transition-all text-xs">
                                    <Camera className="w-5 h-5" />
                                    <span>Swap Camera</span>
                                </button>
                            )}
                        </div>

                        {scanError && (
                            <div className="bg-red-500 p-4 rounded-xl text-white text-[10px] font-black text-center uppercase tracking-widest animate-shake">
                                {scanError}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Safety Preferences */}
            <div className="bg-slate-900/60 backdrop-blur-xl rounded-[2rem] md:rounded-[3rem] border border-white/5 overflow-hidden shadow-2xl">
                <div className="p-6 md:p-10 flex items-center justify-between hover:bg-white/5 transition-all cursor-pointer" onClick={() => onToggleFallDetection(!fallDetectionEnabled)}>
                    <div className="flex items-center gap-4 md:gap-5">
                        <div className="w-12 h-12 md:w-16 md:h-16 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-400 border border-blue-500/20"><Shield className="w-6 h-6 md:w-8 md:h-8" /></div>
                        <div>
                            <p className="font-extrabold text-lg md:text-xl text-white">Fall Detection</p>
                            <p className="text-[10px] md:text-sm text-slate-500 font-bold uppercase tracking-widest opacity-60">Edge AI Protection</p>
                        </div>
                    </div>
                    <div className={`w-14 h-8 md:w-16 md:h-9 rounded-full transition-all relative ${fallDetectionEnabled ? 'bg-blue-600 shadow-lg shadow-blue-900/40' : 'bg-slate-800'}`}>
                        <div className={`absolute top-1 left-1 md:top-1.5 md:left-1.5 w-6 h-6 bg-white rounded-full transition-transform duration-300 ${fallDetectionEnabled ? 'translate-x-6 md:translate-x-7' : ''}`} />
                    </div>
                </div>
            </div>

            <div className="bg-blue-600/10 backdrop-blur-lg p-6 md:p-8 rounded-[2rem] border border-blue-500/30 flex gap-4 md:gap-6 items-start shadow-2xl">
                <div className="p-2.5 bg-blue-500/20 rounded-xl">
                    <Info className="w-5 h-5 md:w-6 md:h-6 text-blue-400" />
                </div>
                <div>
                    <p className="font-black text-blue-400 uppercase tracking-widest text-[10px] mb-0.5">Mobile Tip</p>
                    <p className="text-blue-100 font-bold leading-relaxed text-xs md:text-sm opacity-80 italic">
                        "Handshake v4 is 100% responsive. Use 'Swap Camera' if your phone fails to autofocus."
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
