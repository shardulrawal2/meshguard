import React, { useState, useEffect, useRef } from 'react';
import { Settings as SettingsIcon, Shield, Info, Radio, QrCode, Camera, X, CheckCircle2, RotateCcw, AlertTriangle } from 'lucide-react';
import { p2pMesh } from '../network/P2pMesh';
import { QRCodeCanvas } from 'qrcode.react';
import { Html5Qrcode } from 'html5-qrcode';

interface SettingsProps {
    fallDetectionEnabled: boolean;
    onToggleFallDetection: (val: boolean) => void;
}

// Handshake Stages for v5
type HandshakeState =
    | 'IDLE'
    | 'GENERATING_OFFER'
    | 'SHOWING_OFFER'
    | 'SCANNING_ANSWER'
    | 'PROCESSING_SCAN'
    | 'SHOWING_ANSWER'
    | 'CONNECTING';

export const Settings: React.FC<SettingsProps> = ({ fallDetectionEnabled, onToggleFallDetection }) => {
    // UI & Peer State
    const [peerCount, setPeerCount] = useState(0);
    const [connectedPeers, setConnectedPeers] = useState<string[]>([]);

    // Handshake State Machine
    const [state, setState] = useState<HandshakeState>('IDLE');
    const [activeSignal, setActiveSignal] = useState('');
    const [statusMessage, setStatusMessage] = useState('');
    const [showModal, setShowModal] = useState(false);

    // Scanner State
    const [showScanner, setShowScanner] = useState(false);
    const [scanError, setScanError] = useState('');
    const [cameras, setCameras] = useState<Array<{ id: string; label: string }>>([]);
    const [selectedCameraId, setSelectedCameraId] = useState<string>('');
    const [scannerObject, setScannerObject] = useState<Html5Qrcode | null>(null);
    const [isCameraBlocked, setIsCameraBlocked] = useState(false);

    // Refs for persistent state in callbacks
    const stateRef = useRef<HandshakeState>('IDLE');
    useEffect(() => { stateRef.current = state; }, [state]);

    // Responsive QR size
    const [qrSize, setQrSize] = useState(280);
    useEffect(() => {
        const updateSize = () => setQrSize(Math.min(window.innerWidth * 0.75, 400));
        updateSize();
        window.addEventListener('resize', updateSize);
        return () => window.removeEventListener('resize', updateSize);
    }, []);

    // 1. Initial Listeners
    useEffect(() => {
        // Sync peer count
        const updatePeers = () => {
            setPeerCount(p2pMesh.getPeerCount());
            setConnectedPeers(p2pMesh.getConnectedPeerIds());
        };
        p2pMesh.onPeerCountChanged(updatePeers);
        updatePeers();

        // Global signal listener - v5 uses a stable ref-based approach
        p2pMesh.onSignal((signal) => {
            console.log(`[Handshake v5] Internal Signal: ${signal.length} chars (State: ${stateRef.current})`);
            setActiveSignal(signal);

            if (stateRef.current === 'GENERATING_OFFER') {
                setState('SHOWING_OFFER');
                setShowModal(true);
            } else if (stateRef.current === 'PROCESSING_SCAN') {
                setState('SHOWING_ANSWER');
                setShowModal(true);
            }
        });
    }, []);

    // 2. Camera Discovery
    useEffect(() => {
        Html5Qrcode.getCameras().then(devices => {
            if (devices && devices.length) {
                setCameras(devices.map(d => ({ id: d.id, label: d.label })));
                const environmentCamera = devices.find(d => d.label.toLowerCase().includes('back') || d.label.toLowerCase().includes('environment'));
                setSelectedCameraId(environmentCamera ? environmentCamera.id : devices[0].id);
            }
        }).catch(() => setIsCameraBlocked(true));
    }, []);

    // 3. Scanner Management
    useEffect(() => {
        if (showScanner && selectedCameraId && !scannerObject) {
            startScanning();
        }
    }, [showScanner, selectedCameraId]);

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
        } catch (err) { setScanError('Camera Init Failed'); }
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
            if (!signal) { setScanError('Corrupt Signal'); return; }

            if (state === 'IDLE') {
                // Device B: Receiving Offer -> Becoming Responder
                if (signal.type !== 'offer') { setScanError('Scan the INITIATOR first'); return; }
                setState('PROCESSING_SCAN');
                setStatusMessage('Decrypting & Responding...');
                stopScanning();
                p2pMesh.receiveConnection(signal);
            } else if (state === 'SCANNING_ANSWER') {
                // Device A: Receiving Answer -> Finalizing Tunnel
                if (signal.type !== 'answer') { setScanError('Scan the RESPONSE QR'); return; }
                p2pMesh.completeHandshake(signal);
                setState('CONNECTING');
                setStatusMessage('Establishing Tunnel...');
                stopScanning();
                setTimeout(() => { if (stateRef.current === 'CONNECTING') handleReset(); }, 8000);
            }
        } catch (err) { setScanError('Handshake Logic Failure'); }
    };

    // 4. Action Handlers
    const handleStartInitiation = () => {
        handleReset();
        setState('GENERATING_OFFER');
        setStatusMessage('Creating Encrypted Tunnel...');
        p2pMesh.initiateConnection();
    };

    const handleReset = () => {
        setState('IDLE');
        setStatusMessage('');
        setActiveSignal('');
        setShowModal(false);
        setScanError('');
        stopScanning();
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const html5QrCode = new Html5Qrcode("reader");
        try {
            const decodedText = await html5QrCode.scanFile(file, true);
            handleScanResult(decodedText);
        } catch (err) { setScanError('Could not process image'); }
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
        <div className="space-y-6 md:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-24 px-4 overflow-x-hidden">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-indigo-500/10 rounded-2xl border border-indigo-500/10">
                        <Radio className={`w-6 h-6 ${peerCount > 0 ? 'text-green-400 animate-pulse' : 'text-slate-500'}`} />
                    </div>
                    <h2 className="text-2xl font-black text-white uppercase tracking-tighter">Status</h2>
                </div>
                <div className="bg-slate-900 shadow-xl px-4 py-2 rounded-full border border-white/5 flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${peerCount > 0 ? 'bg-green-500' : 'bg-slate-600'}`} />
                    <span className="text-[10px] font-black text-white tracking-widest uppercase">{peerCount} MESH NODES</span>
                </div>
            </div>

            {/* Main Handshake Card */}
            <div className="bg-slate-900/80 backdrop-blur-2xl rounded-[2.5rem] border border-white/10 p-8 space-y-8 shadow-2xl relative overflow-hidden group hover:border-indigo-500/30 transition-all duration-500">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-indigo-500/20 rounded-2xl flex items-center justify-center text-indigo-400">
                        <QrCode className="w-6 h-6" />
                    </div>
                    <div>
                        <p className="font-black text-lg text-white uppercase tracking-tighter leading-none">MicroLink v5</p>
                        <p className="text-[9px] text-slate-500 font-bold uppercase tracking-[0.3em] mt-1">High-Reliability Handshake</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <button
                        onClick={handleStartInitiation}
                        className="p-6 bg-indigo-600 hover:bg-indigo-500 text-white rounded-3xl transition-all active:scale-95 shadow-lg shadow-indigo-900/40 font-black uppercase tracking-widest flex items-center justify-center gap-4 text-sm"
                    >
                        <QrCode className="w-5 h-5" />
                        Generate Link
                    </button>
                    <button
                        onClick={() => { handleReset(); setShowScanner(true); }}
                        className="p-6 bg-slate-800 hover:bg-slate-700 text-white rounded-3xl transition-all active:scale-95 border border-white/5 font-black uppercase tracking-widest flex items-center justify-center gap-4 text-sm"
                    >
                        <Camera className="w-5 h-5 text-slate-400" />
                        Scan Peer
                    </button>
                </div>

                {statusMessage && (
                    <div className="py-3 px-6 bg-indigo-500/5 rounded-2xl border border-indigo-500/10 flex items-center justify-center gap-3">
                        <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-ping" />
                        <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">{statusMessage}</span>
                    </div>
                )}
            </div>

            {/* Connected Nodes List */}
            {peerCount > 0 && (
                <div className="animate-in slide-in-from-bottom-2 duration-500">
                    <div className="bg-slate-900/40 border border-white/5 rounded-[2.5rem] p-6 space-y-4">
                        <p className="px-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">Connected Identities</p>
                        <div className="grid gap-2">
                            {connectedPeers.map(id => (
                                <div key={id} className="bg-slate-950/50 p-4 rounded-2xl border border-white/5 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.3)]" />
                                        <span className="font-mono text-xs font-bold text-slate-300">{id}</span>
                                    </div>
                                    <div className="flex items-center gap-2 bg-green-500/10 px-2 py-1 rounded-full border border-green-500/20">
                                        <span className="text-[8px] font-black text-green-400 uppercase tracking-tighter">Verified Link</span>
                                        <CheckCircle2 className="w-2.5 h-2.5 text-green-400" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* QR MODAL (Offer/Answer Display) */}
            {showModal && (
                <div className="fixed inset-0 bg-slate-950/98 backdrop-blur-3xl z-[9999] flex items-center justify-center p-6 overflow-y-auto">
                    <div className="bg-white p-8 md:p-12 rounded-[3.5rem] w-full max-w-lg text-center space-y-8 relative animate-in zoom-in-95 duration-300 shadow-3xl">
                        <button onClick={handleReset} className="absolute top-6 right-6 p-2 text-slate-300 hover:text-slate-900 transition-colors"><X className="w-6 h-6" /></button>

                        <div className="space-y-2">
                            <span className="inline-block px-4 py-1.5 bg-indigo-600 text-white rounded-full text-[10px] font-black uppercase tracking-widest mb-3 shadow-lg shadow-indigo-200">
                                {state === 'SHOWING_OFFER' ? 'Step 1: Invite Peer' : 'Step 2: Confirm Link'}
                            </span>
                            <h3 className="text-3xl font-black text-slate-900 uppercase tracking-tighter">
                                {state === 'SHOWING_OFFER' ? 'Broadcast Signal' : 'Response Ready'}
                            </h3>
                            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest max-w-[200px] mx-auto opacity-60">
                                {state === 'SHOWING_OFFER' ? 'Let your peer scan this to begin' : 'Scan this to finish the secure tunnel'}
                            </p>
                        </div>

                        <div className="inline-block p-6 bg-slate-50 rounded-[3.5rem] border-[10px] border-white shadow-inner relative">
                            {activeSignal ? (
                                <QRCodeCanvas value={activeSignal} size={qrSize} level="L" includeMargin={true} />
                            ) : (
                                <div className="flex flex-col items-center justify-center gap-4" style={{ width: qrSize, height: qrSize }}>
                                    <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                                    <p className="text-slate-400 text-[10px] font-black uppercase tracking-[0.2em]">Computing...</p>
                                </div>
                            )}
                        </div>

                        <div className="space-y-4">
                            {state === 'SHOWING_OFFER' ? (
                                <button
                                    onClick={() => { setShowModal(false); setState('SCANNING_ANSWER'); setShowScanner(true); }}
                                    className="w-full p-6 bg-indigo-600 text-white rounded-3xl font-black uppercase tracking-widest text-sm shadow-xl shadow-indigo-300 flex items-center justify-center gap-3 active:scale-95 transition-all"
                                >
                                    <Camera className="w-5 h-5" />
                                    Scan Response
                                </button>
                            ) : (
                                <div className="p-4 bg-indigo-50 rounded-2xl border border-indigo-100 flex items-center justify-center gap-3">
                                    <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-ping" />
                                    <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Awaiting Confirmation...</span>
                                </div>
                            )}
                            <button onClick={handleReset} className="flex items-center gap-2 mx-auto text-[10px] font-black text-slate-400 uppercase tracking-widest opacity-50 hover:opacity-100 transition-all">
                                <RotateCcw className="w-3 h-3" />
                                Cancel Handshake
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* SCANNER OVERLAY */}
            {showScanner && (
                <div className="fixed inset-0 bg-black z-[10000] flex flex-col items-center justify-center p-6 animate-in slide-in-from-top duration-500">
                    <div className="w-full max-w-sm space-y-6">
                        <div className="flex items-center justify-between px-2">
                            <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Locating Link</h3>
                            <button onClick={handleReset} className="p-3 bg-white/10 rounded-2xl text-white border border-white/10"><X className="w-6 h-6" /></button>
                        </div>

                        <div className="relative aspect-square rounded-[3.5rem] overflow-hidden border-4 border-indigo-600 shadow-[0_0_80px_rgba(79,70,229,0.3)] bg-slate-900">
                            <div id="reader" className="w-full h-full" />
                            <div className="absolute inset-0 border-[60px] border-black/40 pointer-events-none" />
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 border-2 border-indigo-400/20 rounded-[2.5rem] pointer-events-none" />
                            <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-48 h-0.5 bg-indigo-500 shadow-[0_0_20px_rgba(79,70,229,1)] animate-sweep pointer-events-none" />

                            {isCameraBlocked && (
                                <div className="absolute inset-0 bg-slate-950 flex flex-col items-center justify-center p-8 text-center space-y-6">
                                    <AlertTriangle className="w-10 h-10 text-red-500" />
                                    <p className="text-white font-black uppercase text-xs">Camera Access Blocked</p>
                                    <button onClick={() => window.location.reload()} className="px-6 py-3 bg-white text-black font-black uppercase text-[10px] rounded-xl shadow-lg shadow-white/10">Reload App</button>
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <label className="flex flex-col items-center p-5 bg-white/5 border border-white/10 rounded-2xl text-[9px] font-black text-white uppercase tracking-widest cursor-pointer active:scale-95 transition-all">
                                <QrCode className="w-5 h-5 text-indigo-400 mb-2" />
                                Gallery
                                <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                            </label>
                            {cameras.length > 1 && (
                                <button onClick={switchCamera} className="flex flex-col items-center p-5 bg-white/5 border border-white/10 rounded-2xl text-[9px] font-black text-white uppercase tracking-widest active:scale-95 transition-all">
                                    <Camera className="w-5 h-5 text-slate-400 mb-2" />
                                    Swap Cam
                                </button>
                            )}
                        </div>

                        {scanError && (
                            <div className="bg-red-500 text-white p-4 rounded-2xl text-[10px] font-black text-center uppercase tracking-widest animate-shake ring-4 ring-red-500/20">
                                {scanError}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Edge AI Analytics Card */}
            <div className="bg-slate-900/60 rounded-[2.5rem] border border-white/10 overflow-hidden shadow-2xl">
                <div className="p-8 flex items-center justify-between group cursor-pointer" onClick={() => onToggleFallDetection(!fallDetectionEnabled)}>
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 bg-indigo-500/10 rounded-[1.5rem] flex items-center justify-center text-indigo-400 group-hover:bg-indigo-500/20 transition-all">
                            <Shield className="w-7 h-7" />
                        </div>
                        <div>
                            <p className="text-lg font-black text-white uppercase tracking-tighter">AI Guard System</p>
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest opacity-60">Real-time Kinematics</p>
                        </div>
                    </div>
                    <div className={`w-14 h-8 rounded-full transition-all duration-300 relative ${fallDetectionEnabled ? 'bg-indigo-600 shadow-[0_0_20px_rgba(79,70,229,0.4)]' : 'bg-slate-800'}`}>
                        <div className={`absolute top-1 left-1 w-6 h-6 bg-white rounded-full transition-all duration-300 ${fallDetectionEnabled ? 'translate-x-6' : ''}`} />
                    </div>
                </div>
            </div>

            <div className="mx-2 p-6 bg-indigo-600/5 rounded-[2.5rem] border border-indigo-500/20 flex gap-4 items-start shadow-inner">
                <Info className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
                <div>
                    <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1 leading-none">Safety Protocol 5.0</p>
                    <p className="text-[11px] text-indigo-100/60 font-medium leading-relaxed italic">
                        "Handshake signals are now encrypted and multi-path optimized. If a link hangs, use the Reset button to refresh the tunnel state."
                    </p>
                </div>
            </div>

            <style>{`
                @keyframes sweep {
                    0% { top: 25%; opacity: 0; }
                    15% { opacity: 1; }
                    85% { opacity: 1; }
                    100% { top: 75%; opacity: 0; }
                }
                .animate-sweep { animation: sweep 2.5s infinite ease-in-out; }
                @keyframes shake {
                    0%, 100% { transform: translateX(0); }
                    20% { transform: translateX(-4px); }
                    80% { transform: translateX(4px); }
                }
                .animate-shake { animation: shake 0.3s ease-in-out; }
            `}</style>
        </div>
    );
};
