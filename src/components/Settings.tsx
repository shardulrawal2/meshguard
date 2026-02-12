import React, { useState, useEffect, useRef } from 'react';
import { Settings as SettingsIcon, Shield, Info, Radio, QrCode, Camera, X, CheckCircle2, RotateCcw } from 'lucide-react';
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

    // Handshake State
    const [handshakeStep, setHandshakeStep] = useState<'idle' | 'generating' | 'showing-offer' | 'scanning-answer' | 'showing-answer'>('idle');
    const [activeSignal, setActiveSignal] = useState('');
    const [statusMessage, setStatusMessage] = useState('');

    // Refs for state coordination
    const handshakeStepRef = useRef(handshakeStep);
    useEffect(() => { handshakeStepRef.current = handshakeStep; }, [handshakeStep]);

    // Responsive QR size
    const [qrSize, setQrSize] = useState(280);
    useEffect(() => {
        const updateSize = () => setQrSize(Math.min(window.innerWidth * 0.8, 400));
        updateSize();
        window.addEventListener('resize', updateSize);
        return () => window.removeEventListener('resize', updateSize);
    }, []);

    // CENTRAL SIGNAL LISTENER
    useEffect(() => {
        p2pMesh.onSignal((signal) => {
            console.log(`[Handshake] Signal received internally: ${signal.length} chars`);
            setActiveSignal(signal);

            // Logic: If we were "generating", we now show the result
            if (handshakeStepRef.current === 'generating' || handshakeStepRef.current === 'idle') {
                // If the signal is an offer (starts with 1 in decoded form), we are likely the initiator
                // But it's safer to check the current step
                if (handshakeStepRef.current === 'generating') {
                    // This is the response to our trigger
                    setHandshakeStep(prev => prev); // dummy for now, state logic below
                }
            }

            // Automatically open modal if a signal is ready
            setShowQrModal(true);
            if (statusMessage === 'Generating Response...') {
                setHandshakeStep('showing-answer');
                setStatusMessage('');
            } else if (handshakeStepRef.current === 'generating') {
                setHandshakeStep('showing-offer');
            }
        });

        p2pMesh.onPeerCountChanged((count) => {
            setPeerCount(count);
            setConnectedPeers(p2pMesh.getConnectedPeerIds());
            if (count > peerCount) setStatusMessage('New Peer Linked!');
        });

        setPeerCount(p2pMesh.getPeerCount());
        setConnectedPeers(p2pMesh.getConnectedPeerIds());
    }, []);

    // Camera setup
    useEffect(() => {
        Html5Qrcode.getCameras().then(devices => {
            if (devices && devices.length) {
                setCameras(devices.map(d => ({ id: d.id, label: d.label })));
                const environmentCamera = devices.find(d => d.label.toLowerCase().includes('back') || d.label.toLowerCase().includes('environment'));
                setSelectedCameraId(environmentCamera ? environmentCamera.id : devices[0].id);
            }
        }).catch(() => setIsCameraBlocked(true));
    }, []);

    useEffect(() => {
        if (showScanner && selectedCameraId && !scannerObject) startScanning();
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
            if (!signal) { setScanError('Invalid MeshGuard Signal'); return; }

            if (handshakeStep === 'idle') {
                // We are responding to an offer
                if (signal.type !== 'offer') { setScanError('Please scan an INITIATOR QR'); return; }
                setStatusMessage('Generating Response...');
                setHandshakeStep('generating');
                stopScanning();
                p2pMesh.receiveConnection(signal);
            } else if (handshakeStep === 'scanning-answer') {
                // We are completing the handshake
                if (signal.type !== 'answer') { setScanError('Please scan the RESPONSE QR'); return; }
                p2pMesh.completeHandshake(signal);
                setHandshakeStep('idle');
                stopScanning();
                setStatusMessage('Connecting...');
                setTimeout(() => setStatusMessage(''), 5000);
            }
        } catch (err) { setScanError('Handshake Logic Error'); }
    };

    // ACTION HANDLERS
    const handleStartInitiation = () => {
        setHandshakeStep('generating');
        setStatusMessage('Creating Link...');
        p2pMesh.initiateConnection();
    };

    const handleReset = () => {
        setHandshakeStep('idle');
        setStatusMessage('');
        setActiveSignal('');
        setShowQrModal(false);
        setShowScanner(false);
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
        <div className="space-y-6 md:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-24">
            {/* Header */}
            <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-blue-500/10 rounded-2xl border border-blue-500/10">
                        <SettingsIcon className="w-6 h-6 text-blue-400" />
                    </div>
                    <h2 className="text-2xl font-black tracking-tight text-white uppercase">Mesh System</h2>
                </div>
                <div className="flex items-center gap-2 border border-white/5 bg-slate-900/60 px-3 py-1.5 rounded-full shadow-inner">
                    <Radio className={`w-3.5 h-3.5 ${peerCount > 0 ? 'text-green-400 animate-pulse' : 'text-slate-500'}`} />
                    <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">{peerCount} PEERS</span>
                </div>
            </div>

            {/* MicroLink Card */}
            <div className="bg-slate-900/60 backdrop-blur-3xl rounded-[2.5rem] border border-white/10 p-8 space-y-8 shadow-2xl relative overflow-hidden ring-1 ring-white/5">
                <div className="flex items-center gap-5">
                    <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 flex items-center justify-center text-indigo-400 border border-indigo-500/20">
                        <QrCode className="w-7 h-7" />
                    </div>
                    <div>
                        <p className="font-black text-xl text-white uppercase tracking-tighter">MicroLink Handshake</p>
                        <p className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em]">Full Offline Mesh v4.1</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-4">
                    <button
                        onClick={handleStartInitiation}
                        disabled={handshakeStep === 'generating'}
                        className="flex items-center justify-center gap-4 p-7 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-3xl transition-all active:scale-95 shadow-xl shadow-indigo-900/40 font-black uppercase tracking-widest"
                    >
                        <QrCode className="w-7 h-7" />
                        <span>Generate Link</span>
                    </button>

                    <button
                        onClick={() => { setHandshakeStep('idle'); setShowScanner(true); }}
                        className="flex items-center justify-center gap-4 p-7 bg-slate-800 hover:bg-slate-700 text-white rounded-3xl transition-all active:scale-95 border border-white/5 font-black uppercase tracking-widest"
                    >
                        <Camera className="w-7 h-7 text-slate-400" />
                        <span>Scan Peer</span>
                    </button>
                </div>

                {statusMessage && (
                    <div className="flex items-center justify-center gap-2 text-indigo-400 font-bold uppercase tracking-widest text-[10px] animate-pulse py-3 bg-indigo-500/5 rounded-2xl border border-indigo-500/10">
                        <div className="w-2 h-2 bg-indigo-400 rounded-full animate-ping" />
                        {statusMessage}
                    </div>
                )}
            </div>

            {/* Peer Nodes */}
            {peerCount > 0 && (
                <div className="bg-slate-900/40 rounded-[2.5rem] border border-white/5 p-8 space-y-4 shadow-inner">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-2">Active Nodes</p>
                    <div className="grid gap-3">
                        {connectedPeers.map((id) => (
                            <div key={id} className="flex items-center justify-between bg-slate-950 p-4 rounded-2xl border border-white/5 shadow-sm">
                                <div className="flex items-center gap-3">
                                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(34,197,94,0.4)]" />
                                    <span className="font-mono text-xs font-bold text-slate-300">{id}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-600">Secure</span>
                                    <CheckCircle2 className="w-3 h-3 text-green-500" />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* QR MODAL */}
            {showQrModal && (
                <div className="fixed inset-0 bg-slate-950/98 backdrop-blur-3xl z-[9999] flex flex-col items-center justify-center p-6 pt-12 overflow-y-auto">
                    <div className="bg-white p-8 md:p-12 rounded-[3.5rem] space-y-8 max-w-[90vw] md:max-w-xl w-full text-center relative shadow-3xl">
                        <button onClick={() => setShowQrModal(false)} className="absolute top-6 right-6 p-2 bg-slate-100 rounded-full text-slate-400 active:scale-90 transition-all">
                            <X className="w-6 h-6" />
                        </button>

                        <div className="space-y-2">
                            <div className="inline-block px-4 py-1.5 bg-indigo-600 text-white rounded-full text-[10px] font-black uppercase tracking-widest mb-2">
                                {handshakeStep === 'showing-offer' ? 'Step 1: Offer' : 'Step 2: Answer'}
                            </div>
                            <h3 className="text-slate-900 font-black text-3xl uppercase tracking-tighter leading-none">
                                {handshakeStep === 'showing-offer' ? 'Share Signal' : 'Finalize Link'}
                            </h3>
                            <p className="text-slate-500 text-xs font-bold opacity-70 max-w-[240px] mx-auto uppercase tracking-tighter">
                                {handshakeStep === 'showing-offer' ? 'Let your peer scan this code' : 'Scan this to complete the tunnel'}
                            </p>
                        </div>

                        <div className="bg-white p-6 rounded-[3rem] inline-block border-[10px] border-slate-50 shadow-inner">
                            {activeSignal ? (
                                <QRCodeCanvas value={activeSignal} size={qrSize} level="L" includeMargin={true} />
                            ) : (
                                <div className="flex flex-col items-center justify-center gap-4" style={{ width: qrSize, height: qrSize }}>
                                    <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                                    <p className="text-slate-400 font-bold uppercase text-[10px] tracking-widest">Generating...</p>
                                </div>
                            )}
                        </div>

                        {handshakeStep === 'showing-offer' && (
                            <div className="space-y-4">
                                <button
                                    onClick={() => { setShowQrModal(false); setHandshakeStep('scanning-answer'); setShowScanner(true); }}
                                    className="w-full p-6 bg-indigo-600 text-white rounded-3xl font-black uppercase tracking-widest text-sm shadow-xl shadow-indigo-500/30 flex items-center justify-center gap-3 transition-all active:scale-95"
                                >
                                    <Camera className="w-6 h-6" />
                                    <span>Scan Response</span>
                                </button>
                                <button onClick={handleReset} className="flex items-center gap-2 text-slate-400 font-bold uppercase text-[10px] tracking-widest mx-auto opacity-50 hover:opacity-100 transition-opacity">
                                    <RotateCcw className="w-3 h-3" />
                                    Reset Handshake
                                </button>
                            </div>
                        )}

                        {handshakeStep === 'showing-answer' && (
                            <div className="space-y-4">
                                <p className="text-indigo-600 font-black uppercase tracking-widest text-[9px] animate-pulse">
                                    Awaiting peer confirmation...
                                </p>
                                <button onClick={handleReset} className="p-4 bg-slate-50 rounded-2xl w-full text-slate-400 font-black uppercase text-[10px] tracking-widest">Cancel</button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* SCANNER */}
            {showScanner && (
                <div className="fixed inset-0 bg-black z-[10000] flex flex-col items-center justify-center p-6">
                    <div className="w-full max-w-sm space-y-6">
                        <div className="flex items-center justify-between px-2">
                            <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Locate Signal</h3>
                            <button onClick={stopScanning} className="p-4 bg-white/10 rounded-2xl text-white border border-white/10 active:scale-90 transition-all"><X className="w-6 h-6" /></button>
                        </div>

                        <div className="relative overflow-hidden rounded-[3.5rem] border-4 border-indigo-500 aspect-square bg-slate-900 shadow-3xl shadow-indigo-500/20">
                            <div id="reader" className="w-full h-full" />
                            <div className="absolute inset-0 pointer-events-none border-[50px] border-black/60" />
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-56 h-56 border-2 border-indigo-400/30 rounded-[2.5rem]" />
                            <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-56 h-0.5 bg-indigo-500 shadow-[0_0_20px_rgba(79,70,229,1)] animate-scan-move pointer-events-none" />

                            {isCameraBlocked && (
                                <div className="absolute inset-0 bg-slate-950 flex flex-col items-center justify-center p-8 text-center space-y-6">
                                    <Camera className="w-12 h-12 text-red-500" />
                                    <p className="font-black text-white uppercase text-sm">Camera Disabled</p>
                                    <button onClick={() => { setIsCameraBlocked(false); setShowScanner(false); setTimeout(() => setShowScanner(true), 100); }} className="px-8 py-3 bg-white text-black font-black uppercase rounded-xl text-xs">Authorize</button>
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <label className="flex flex-col items-center justify-center gap-2 p-5 bg-white/5 text-white rounded-2xl font-black uppercase tracking-widest cursor-pointer border border-white/10 active:scale-95 transition-all text-[9px]">
                                <QrCode className="w-5 h-5 text-indigo-400" />
                                <span>Gallery</span>
                                <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                            </label>

                            {cameras.length > 1 && (
                                <button onClick={switchCamera} className="flex flex-col items-center justify-center gap-2 p-5 bg-white/5 text-white rounded-2xl font-black uppercase tracking-widest active:scale-95 transition-all text-[9px] border border-white/10">
                                    <Camera className="w-5 h-5" />
                                    <span>Swap</span>
                                </button>
                            )}
                        </div>

                        {scanError && (
                            <div className="bg-red-600 p-4 rounded-xl text-white text-[9px] font-black text-center uppercase tracking-widest animate-shake">
                                {scanError}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* AI Preferences */}
            <div className="bg-slate-900/60 backdrop-blur-3xl rounded-[2.5rem] border border-white/5 overflow-hidden shadow-2xl shadow-black/40">
                <div className="p-8 flex items-center justify-between hover:bg-white/5 transition-all cursor-pointer group" onClick={() => onToggleFallDetection(!fallDetectionEnabled)}>
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-2xl bg-blue-500/10 flex items-center justify-center text-blue-400 border border-blue-500/20 group-hover:bg-blue-500/20 transition-all"><Shield className="w-7 h-7" /></div>
                        <div>
                            <p className="font-extrabold text-lg text-white">Edge AI Guard</p>
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest opacity-60">Neural Fall Analytics</p>
                        </div>
                    </div>
                    <div className={`w-14 h-8 rounded-full transition-all relative ${fallDetectionEnabled ? 'bg-blue-600 shadow-[0_0_15px_rgba(37,99,235,0.4)]' : 'bg-slate-800'}`}>
                        <div className={`absolute top-1 left-1 w-6 h-6 bg-white rounded-full transition-transform duration-300 ${fallDetectionEnabled ? 'translate-x-6' : ''}`} />
                    </div>
                </div>
            </div>

            <div className="bg-blue-600/5 backdrop-blur-lg p-6 rounded-[2rem] border border-blue-500/20 flex gap-4 items-start mx-2 shadow-inner">
                <div className="p-2.5 bg-blue-500/10 rounded-xl">
                    <Info className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                    <p className="font-black text-blue-400 uppercase tracking-widest text-[9px] mb-0.5">Stability Update 4.2</p>
                    <p className="text-blue-100/60 font-medium leading-relaxed text-[11px] italic">
                        "Race conditions in handshake have been resolved. Use manual Reset if a tunnel fails to stabilize."
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
