import React, { useState, useEffect, useRef } from 'react';
import { Shield, Info, Radio, QrCode, Camera, X, CheckCircle2, RotateCcw, AlertTriangle, Copy, Terminal, Monitor, RefreshCw } from 'lucide-react';
import { p2pMesh } from '../network/P2pMesh';
import { QRCodeCanvas } from 'qrcode.react';
import { Html5Qrcode } from 'html5-qrcode';
import type { SOSMessage } from '../types/sos';

interface SettingsProps {
    fallDetectionEnabled: boolean;
    onToggleFallDetection: (val: boolean) => void;
    onSendTestMessage?: () => Promise<SOSMessage>;
    initialAction?: 'generate' | 'scan' | null;
    onActionHandled?: () => void;
}

type HandshakeState = 'IDLE' | 'GENERATING' | 'SHOWING_OFFER' | 'SCANNING_ANSWER' | 'PROCESSING_SCAN' | 'SHOWING_ANSWER' | 'CONNECTING';

export const Settings: React.FC<SettingsProps> = ({
    fallDetectionEnabled,
    onToggleFallDetection,
    onSendTestMessage,
    initialAction,
    onActionHandled
}) => {
    // Peer & UI State
    const [peerCount, setPeerCount] = useState(0);
    const [connectedPeers, setConnectedPeers] = useState<string[]>([]);
    const [state, setState] = useState<HandshakeState>('IDLE');
    const [activeSignal, setActiveSignal] = useState('');
    const [statusMessage, setStatusMessage] = useState('');
    const [showModal, setShowModal] = useState(false);

    // Manual Pairing Fallback
    const [manualMode, setManualMode] = useState(false);
    const [manualInput, setManualInput] = useState('');
    const [logs, setLogs] = useState<string[]>([]);

    // Scanner
    const [showScanner, setShowScanner] = useState(false);
    const [scanError, setScanError] = useState('');
    const [cameras, setCameras] = useState<Array<{ id: string; label: string }>>([]);
    const [selectedCameraId, setSelectedCameraId] = useState<string>('');
    const [scannerObject, setScannerObject] = useState<Html5Qrcode | null>(null);
    const [isCameraBlocked, setIsCameraBlocked] = useState(false);

    const stateRef = useRef<HandshakeState>('IDLE');
    useEffect(() => { stateRef.current = state; }, [state]);

    const [qrSize, setQrSize] = useState(280);
    useEffect(() => {
        const updateSize = () => setQrSize(Math.min(window.innerWidth * 0.7, 350));
        updateSize();
        window.addEventListener('resize', updateSize);
        return () => window.removeEventListener('resize', updateSize);
    }, []);

    const addLog = (msg: string) => {
        setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 10));
    };

    const stopScanning = async () => {
        if (scannerObject) { try { await scannerObject.stop(); await scannerObject.clear(); setScannerObject(null); } catch (e) { } }
        setShowScanner(false);
    };

    const handleReset = () => {
        setState('IDLE');
        setStatusMessage('');
        setActiveSignal('');
        setShowModal(false);
        setScanError('');
        setManualMode(false);
        stopScanning();
        addLog('Handshake Reset');
    };

    const handleStartInitiation = () => {
        handleReset();
        setState('GENERATING');
        setStatusMessage('Gathering Paths...');
        addLog('Searching for Local IP Paths...');
        p2pMesh.initiateConnection();
    };

    const processSignal = (text: string) => {
        try {
            const signal = p2pMesh.expandSignal(text);
            if (!signal) {
                addLog('Error: QR Expansion Failed (Corrupt?)');
                setScanError('Invalid QR Code Format');
                return;
            }

            const currentState = stateRef.current;
            addLog(`Handshake: Received ${signal.type.toUpperCase()} in ${currentState}`);

            if (signal.type === 'offer') {
                if (currentState === 'IDLE' || currentState === 'PROCESSING_SCAN' || currentState === 'SHOWING_ANSWER') {
                    if (currentState === 'PROCESSING_SCAN' || currentState === 'SHOWING_ANSWER') {
                        addLog('Info: Continuing with existing response');
                        return;
                    }

                    addLog('Offer valid. Generating secure answer...');
                    setState('PROCESSING_SCAN');
                    setStatusMessage('Generating Response...');
                    stopScanning();

                    setTimeout(() => {
                        addLog('Mesh: Creating responder instance...');
                        p2pMesh.receiveConnection(signal);
                    }, 100);
                } else {
                    addLog('Note: Initiator ignored secondary offer');
                    setScanError('Peer must scan YOUR offer first');
                }
            } else if (signal.type === 'answer') {
                if (currentState === 'SCANNING_ANSWER' || currentState === 'SHOWING_OFFER' || currentState === 'IDLE') {
                    addLog('Answer valid. Finalizing tunnel...');
                    p2pMesh.completeHandshake(signal);
                    setState('CONNECTING');
                    setStatusMessage('Establishing Tunnel...');
                    stopScanning();

                    // Increased safety timeout for mobile radio wakeup
                    setTimeout(() => {
                        if (stateRef.current === 'CONNECTING') {
                            addLog('Warning: Handshake timed out after 30s');
                            handleReset();
                            setScanError('Connection Timeout');
                        }
                    }, 30000);
                } else {
                    addLog('Note: Ignoring peer answer (expected offer)');
                    setScanError('Please scan the Initiator code first');
                }
            }
        } catch (err) {
            console.error('[Settings] Signal processing error:', err);
            addLog('Critical: Handshake logic failed');
            setScanError('Connection Failed');
            handleReset();
        }
    };

    const handleScanResult = async (decodedText: string) => {
        if (showModal || stateRef.current === 'CONNECTING' || stateRef.current === 'SHOWING_ANSWER') return;
        addLog(`QR Decoded (${decodedText.length} chars)`);
        processSignal(decodedText);
    };

    const handleManualSubmit = () => {
        if (!manualInput) return;
        processSignal(manualInput);
        setManualInput('');
        setManualMode(false);
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        addLog('Copied to clipboard');
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const html5QrCode = new Html5Qrcode("reader");
        try {
            const decodedText = await html5QrCode.scanFile(file, true);
            handleScanResult(decodedText);
        } catch (err) { setScanError('File Error'); }
    };

    const switchCamera = async () => {
        if (!scannerObject || cameras.length < 2) return;
        const currentIndex = cameras.findIndex(c => c.id === selectedCameraId);
        const nextId = cameras[(currentIndex + 1) % cameras.length].id;
        setSelectedCameraId(nextId);
        await scannerObject.stop();
        startScanning();
    };

    // 1. Initial Listeners
    useEffect(() => {
        p2pMesh.onPeerCountChanged(() => {
            setPeerCount(p2pMesh.getPeerCount());
            setConnectedPeers(p2pMesh.getConnectedPeerIds());
            if (p2pMesh.getPeerCount() > 0) {
                addLog('Pairing Successful!');
                setStatusMessage('Connected!');
                setTimeout(() => {
                    setStatusMessage('');
                    handleReset();
                }, 3000);
            }
        });

        p2pMesh.onPeerError((err) => {
            addLog(`Error: ${err}`);
            setScanError(err);
        });

        p2pMesh.onSignal((compressed) => {
            const expanded = p2pMesh.expandSignal(compressed);
            if (!expanded) {
                addLog('Warning: Failed to expand own signal');
                return;
            }

            const isOffer = expanded.type === 'offer';
            addLog(`Signal generated: ${isOffer ? 'OFFER' : 'ANSWER'} (${compressed.length} chars)`);
            setActiveSignal(compressed);

            const currentState = stateRef.current;
            if (isOffer && currentState === 'GENERATING') {
                setState('SHOWING_OFFER');
                setStatusMessage('Scan this QR with peer device');
                setShowModal(true);
                addLog('Offer QR ready for scanning');
            } else if (!isOffer && currentState === 'PROCESSING_SCAN') {
                setState('SHOWING_ANSWER');
                setStatusMessage('Show this QR to initiator');
                setShowModal(true);
                addLog('Answer QR ready for scanning');
            } else {
                addLog(`Signal generated in unexpected state: ${currentState}`);
            }
        });

        setPeerCount(p2pMesh.getPeerCount());
        setConnectedPeers(p2pMesh.getConnectedPeerIds());

        // Handle initial actions from dashboard
        if (initialAction === 'generate') {
            handleStartInitiation();
            if (onActionHandled) onActionHandled();
        } else if (initialAction === 'scan') {
            handleReset();
            setShowScanner(true);
            if (onActionHandled) onActionHandled();
        }
    }, [initialAction, onActionHandled]);

    // 2. Camera Discovery
    useEffect(() => {
        Html5Qrcode.getCameras().then(devices => {
            if (devices?.length) {
                setCameras(devices.map(d => ({ id: d.id, label: d.label })));
                const environmentCamera = devices.find(d => d.label.toLowerCase().includes('back') || d.label.toLowerCase().includes('environment'));
                setSelectedCameraId(environmentCamera ? environmentCamera.id : devices[0].id);
            }
        }).catch(() => setIsCameraBlocked(true));
    }, []);

    useEffect(() => {
        if (showScanner && selectedCameraId && !scannerObject) startScanning();
    }, [showScanner, selectedCameraId]);

    const startScanning = async () => {
        const html5QrCode = new Html5Qrcode("reader");
        setScannerObject(html5QrCode);
        try {
            await html5QrCode.start(selectedCameraId, { fps: 60, qrbox: { width: 250, height: 250 } } as any, handleScanResult, () => { });
            addLog('Scanner Active');
        } catch (err) { setScanError('Camera Init Failure'); }
    };

    return (
        <div className="space-y-6 md:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-24 px-4 overflow-x-hidden">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-indigo-500/10 rounded-2xl border border-indigo-500/10">
                        <Radio className={`w-6 h-6 ${peerCount > 0 ? 'text-green-400 animate-pulse' : 'text-slate-500'}`} />
                    </div>
                    <h2 className="text-2xl font-black text-white uppercase tracking-tighter">Mesh Guard</h2>
                </div>
                <div className="flex flex-col items-end gap-1">
                    <div className="bg-slate-900 border border-white/5 px-4 py-2 rounded-full flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${peerCount > 0 ? 'bg-green-500 animate-pulse' : 'bg-slate-600'}`} />
                        <span className="text-[10px] font-black text-white tracking-widest uppercase">{peerCount} ACTIVE</span>
                    </div>
                    {!navigator.onLine && (
                        <div className="bg-green-500/10 border border-green-500/20 px-3 py-1 rounded-full flex items-center gap-1.5">
                            <Shield className="w-3 h-3 text-green-500" />
                            <span className="text-[8px] font-black text-green-500 tracking-widest uppercase">Pure Offline Mode</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Networking Tip */}
            {peerCount === 0 && (
                <div className="mx-2 p-4 bg-amber-500/10 rounded-3xl border border-amber-500/20 flex gap-4 animate-in fade-in slide-in-from-top-4 duration-500">
                    <div className="w-10 h-10 bg-amber-500/20 rounded-2xl flex items-center justify-center text-amber-500 shrink-0">
                        <Radio className="w-5 h-5" />
                    </div>
                    <div>
                        <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest leading-none mb-1">Offline Mesh Tip</p>
                        <p className="text-[11px] text-slate-300 font-medium leading-relaxed">
                            For 100% offline use, Phone A must have **Hotspot ON** and Phone B must **Join it**. Toggling WiFi OFF will cut the mesh.
                        </p>
                    </div>
                </div>
            )}
            <div className="bg-slate-900/80 backdrop-blur-2xl rounded-[2.5rem] border border-white/10 p-8 space-y-8 shadow-2xl relative overflow-hidden group hover:border-indigo-500/30 transition-all duration-500">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-indigo-500/20 rounded-2xl flex items-center justify-center text-indigo-400"><Monitor className="w-6 h-6" /></div>
                        <div>
                            <p className="font-black text-lg text-white uppercase tracking-tighter leading-none">Safety Link v6.0</p>
                            <p className="text-[9px] text-slate-500 font-bold uppercase tracking-[0.3em] mt-1">100% Zero-Internet Tunnel</p>
                        </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border ${navigator.onLine ? 'border-amber-500/20 bg-amber-500/5' : 'border-green-500/20 bg-green-500/5'}`}>
                            <Info className={`w-3.5 h-3.5 ${navigator.onLine ? 'text-amber-500' : 'text-green-500'}`} />
                            <span className={`text-[9px] font-black uppercase tracking-widest ${navigator.onLine ? 'text-amber-500' : 'text-green-500'}`}>
                                {navigator.onLine ? 'Cloud Bypass Active' : 'Total Airload Mode'}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <button onClick={handleStartInitiation} className="p-6 bg-indigo-600 hover:bg-indigo-500 text-white rounded-3xl transition-all active:scale-95 shadow-lg shadow-indigo-900/40 font-black uppercase tracking-widest flex items-center justify-center gap-4 text-sm">
                        <QrCode className="w-5 h-5" /> Generate Link
                    </button>
                    <button onClick={() => { handleReset(); setShowScanner(true); }} className="p-6 bg-slate-800 hover:bg-slate-700 text-white rounded-3xl transition-all active:scale-95 border border-white/5 font-black uppercase tracking-widest flex items-center justify-center gap-4 text-sm">
                        <Camera className="w-5 h-5 text-slate-400" /> Scan Peer
                    </button>
                    {peerCount > 0 && onSendTestMessage && (
                        <button onClick={onSendTestMessage} className="p-6 bg-green-600 hover:bg-green-500 text-white rounded-3xl transition-all active:scale-95 shadow-lg shadow-green-900/40 font-black uppercase tracking-widest flex items-center justify-center gap-4 text-sm">
                            <Radio className="w-5 h-5" /> Test Message
                        </button>
                    )}
                </div>

                {statusMessage && (
                    <div className="py-4 bg-indigo-500/5 rounded-2xl border border-indigo-500/10 flex items-center justify-center gap-3 animate-pulse">
                        <span className="w-2 h-2 bg-indigo-500 rounded-full animate-ping" />
                        <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">{statusMessage}</span>
                    </div>
                )}
            </div>

            {/* Connected Nodes List (Restored for v5.1) */}
            {peerCount > 0 && connectedPeers.length > 0 && (
                <div className="animate-in slide-in-from-bottom-2 duration-500">
                    <div className="bg-slate-900/40 border border-white/5 rounded-[2.5rem] p-6 space-y-4 shadow-xl">
                        <p className="px-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">Linked Identifiers</p>
                        <div className="grid gap-2">
                            {connectedPeers.map(id => (
                                <div key={id} className="bg-slate-950/50 p-4 rounded-2xl border border-white/5 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.3)]" />
                                        <span className="font-mono text-[9px] font-bold text-slate-300">{id}</span>
                                    </div>
                                    <div className="flex items-center gap-2 bg-green-500/10 px-2 py-1 rounded-full border border-green-500/20">
                                        <span className="text-[7px] font-black text-green-400 uppercase tracking-tighter">SECURE</span>
                                        <CheckCircle2 className="w-2.5 h-2.5 text-green-400" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Debug Logs */}
            <div className="bg-slate-950/80 rounded-[2rem] border border-white/5 p-6 font-mono text-[9px] space-y-2 text-slate-500 overflow-hidden">
                <div className="flex items-center justify-between opacity-50 mb-2">
                    <span className="flex items-center gap-2"><Terminal className="w-3 h-3" /> PAIRING LOGS</span>
                    <button onClick={() => setLogs([])} className="hover:text-white transition-colors">CLEAR</button>
                </div>
                <div className="space-y-1 h-24 overflow-y-auto custom-scrollbar">
                    {logs.length > 0 ? logs.map((log, i) => (
                        <div key={i} className={`${i === 0 ? 'text-indigo-400' : ''}`}>{log}</div>
                    )) : <div className="italic opacity-30">Awaiting handshake events...</div>}
                </div>
            </div>

            {/* QR MODAL */}
            {showModal && (
                <div className="fixed inset-0 bg-slate-950/98 backdrop-blur-3xl z-[9999] flex items-center justify-center p-6 pt-12">
                    <div className="bg-white p-8 md:p-12 rounded-[3.5rem] w-full max-w-lg text-center space-y-8 relative animate-in zoom-in-95 duration-300 shadow-3xl">
                        <button onClick={handleReset} className="absolute top-6 right-6 p-2 text-slate-300 hover:text-slate-900"><X className="w-6 h-6" /></button>

                        <div className="space-y-2">
                            <span className="inline-block px-4 py-1.5 bg-indigo-600 text-white rounded-full text-[10px] font-black uppercase tracking-widest mb-3 shadow-lg">{state === 'SHOWING_OFFER' ? 'Step 1: Offer' : 'Step 2: Answer'}</span>
                            <h3 className="text-2xl font-black text-slate-900 uppercase">Pairing Code</h3>
                            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest opacity-60">Scan with other device or copy code</p>
                        </div>

                        <div className="inline-block p-4 bg-slate-50 rounded-[3rem] border-[8px] border-white shadow-inner relative">
                            {activeSignal ? <QRCodeCanvas value={activeSignal} size={qrSize} level="L" includeMargin={true} /> : <div className="p-20 text-slate-300"><RefreshCw className="w-8 h-8 animate-spin" /></div>}
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <button onClick={() => copyToClipboard(activeSignal)} className="p-4 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl font-black uppercase text-[10px] tracking-widest flex items-center justify-center gap-2 transition-all">
                                <Copy className="w-4 h-4" /> Copy Signal
                            </button>
                            {state === 'SHOWING_OFFER' ? (
                                <button onClick={() => { setShowModal(false); setState('SCANNING_ANSWER'); setShowScanner(true); }} className="p-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest flex items-center justify-center gap-2 shadow-lg shadow-indigo-200">
                                    <Camera className="w-4 h-4" /> Next Step
                                </button>
                            ) : (
                                <button onClick={() => { setShowModal(false); }} className="p-4 bg-green-600 hover:bg-green-500 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest flex items-center justify-center gap-2 shadow-lg shadow-green-200">
                                    <CheckCircle2 className="w-4 h-4" /> Ready & Waiting
                                </button>
                            )}
                            <button onClick={handleReset} className="col-span-2 flex items-center gap-2 mx-auto text-[10px] font-black text-slate-400 uppercase tracking-widest opacity-50 hover:opacity-100 transition-all">
                                <RotateCcw className="w-3 h-3" /> Reset Handshake
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* SCANNER OVERLAY */}
            {showScanner && (
                <div className="fixed inset-0 bg-black z-[10000] flex flex-col items-center justify-center p-6 animate-in slide-in-from-top">
                    <div className="w-full max-w-sm space-y-6">
                        <div className="flex items-center justify-between px-2">
                            <h3 className="text-xl font-black text-white uppercase tracking-widest">Vision Pairing</h3>
                            <button onClick={handleReset} className="p-3 bg-white/10 rounded-2xl text-white border border-white/10"><X className="w-6 h-6" /></button>
                        </div>

                        {!manualMode ? (
                            <div className="relative aspect-square rounded-[3rem] overflow-hidden border-4 border-indigo-600 bg-slate-900 shadow-3xl shadow-indigo-500/20">
                                <div id="reader" className="w-full h-full" />
                                <div className="absolute inset-0 border-[60px] border-black/40 pointer-events-none" />
                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 border-2 border-indigo-400/20 rounded-[2rem] pointer-events-none" />
                                <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-48 h-0.5 bg-indigo-500 shadow-[0_0_20px_rgba(79,70,229,1)] animate-sweep pointer-events-none" />
                                {isCameraBlocked && (
                                    <div className="absolute inset-0 bg-slate-950 flex flex-col items-center justify-center p-8 text-center space-y-4">
                                        <AlertTriangle className="w-10 h-10 text-red-500" />
                                        <p className="text-white font-black uppercase text-[10px] tracking-widest">Camera Access Blocked</p>
                                        <button onClick={() => window.location.reload()} className="px-6 py-3 bg-white text-black font-black uppercase text-[9px] rounded-xl">Reload App</button>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="bg-slate-900 p-8 rounded-[3rem] border-4 border-indigo-600 space-y-6">
                                <p className="text-white font-black uppercase text-[10px] text-center tracking-widest">Paste Peer Code</p>
                                <textarea autoFocus value={manualInput} onChange={(e) => setManualInput(e.target.value)} placeholder="Signal starting with '1' or '2'..." className="w-full h-32 bg-black border border-white/10 rounded-2xl p-4 text-[10px] font-mono text-indigo-400 placeholder:text-slate-800 resize-none outline-none focus:border-indigo-500" />
                                <button onClick={handleManualSubmit} className="w-full p-6 bg-indigo-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs">Establish Link</button>
                            </div>
                        )}

                        <div className="grid grid-cols-3 gap-3">
                            <button onClick={switchCamera} className="p-4 bg-white/5 border border-white/10 rounded-2xl text-[9px] font-black text-white uppercase flex flex-col items-center gap-2"><RefreshCw className="w-4 h-4" /> Flip</button>
                            <button onClick={() => setManualMode(!manualMode)} className={`p-4 border border-white/10 rounded-2xl text-[9px] font-black uppercase flex flex-col items-center gap-2 transition-all ${manualMode ? 'bg-indigo-600 text-white' : 'bg-white/5 text-white'}`}><Terminal className="w-4 h-4" /> Manual</button>
                            <label className="p-4 bg-white/5 border border-white/10 rounded-2xl text-[9px] font-black text-white uppercase flex flex-col items-center gap-2 cursor-pointer"><Monitor className="w-4 h-4" /> Gallery <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} /></label>
                        </div>

                        {scanError && <div className="bg-red-600 text-white p-4 rounded-xl text-[9px] font-black text-center uppercase tracking-widest shadow-lg animate-shake ring-4 ring-red-500/20">{scanError}</div>}
                    </div>
                </div>
            )}

            {/* AI Settings */}
            <div className="bg-slate-900/40 rounded-[2.5rem] border border-white/5 p-8 flex items-center justify-between group cursor-pointer" onClick={() => onToggleFallDetection(!fallDetectionEnabled)}>
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-blue-500/10 rounded-2xl flex items-center justify-center text-blue-400 border border-blue-500/5 group-hover:bg-blue-500/20 transition-all"><Shield className="w-6 h-6" /></div>
                    <div>
                        <p className="font-black text-white uppercase tracking-tighter">Fall Guard</p>
                        <p className="text-[9px] text-slate-600 font-bold uppercase tracking-widest">Edge Neural AI</p>
                    </div>
                </div>
                <div className={`w-14 h-8 rounded-full transition-all relative ${fallDetectionEnabled ? 'bg-blue-600 shadow-[0_0_15px_rgba(37,99,235,0.4)]' : 'bg-slate-800'}`}>
                    <div className={`absolute top-1 left-1 w-6 h-6 bg-white rounded-full transition-all duration-300 ${fallDetectionEnabled ? 'translate-x-6' : ''}`} />
                </div>
            </div>

            <div className="p-6 bg-blue-600/5 rounded-[2.5rem] border border-blue-500/10 flex gap-4 items-start shadow-inner">
                <Info className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
                <div>
                    <p className="text-[9px] font-black text-blue-500 uppercase tracking-widest mb-1 leading-none">Stability Protocol 5.1</p>
                    <p className="text-[10px] text-blue-100/40 font-medium leading-relaxed italic">
                        "If QR fails, use Manual Mode. Establish a direct 100% offline tunnel in under 5 minutes."
                    </p>
                </div>
            </div>

            <style>{`.animate-sweep { animation: sweep 3s infinite ease-in-out; } @keyframes sweep { 0%, 100% { top: 25%; opacity: 0; } 50% { top: 75%; opacity: 1; } } .animate-shake { animation: shake 0.4s ease-in-out; } @keyframes shake { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-4px); } 80% { transform: translateX(4px); } } .custom-scrollbar::-webkit-scrollbar { width: 3px; } .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(79, 70, 229, 0.2); border-radius: 10px; }`}</style>
        </div>
    );
};
