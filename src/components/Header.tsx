import React from 'react';
import { Shield, Radio, Activity } from 'lucide-react';

interface HeaderProps {
    isOnline: boolean;
    isMeshActive: boolean;
    isFallDetectionOn: boolean;
}

export const Header: React.FC<HeaderProps> = ({ isOnline, isMeshActive, isFallDetectionOn }) => {
    return (
        <header className="fixed top-0 left-0 right-0 bg-slate-900/40 backdrop-blur-2xl border-b border-white/5 z-50 px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
                <div className="p-1.5 bg-blue-500/10 rounded-lg">
                    <Shield className="w-5 h-5 text-blue-500" />
                </div>
                <h1 className="text-xl font-black tracking-tighter bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
                    MESHGUARD
                </h1>
            </div>

            <div className="flex items-center gap-5">
                <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-800/40 rounded-lg border border-white/5">
                    <Activity className={`w-3.5 h-3.5 ${isFallDetectionOn ? 'text-green-400 animate-pulse' : 'text-slate-600'}`} />
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest hidden sm:inline">AI</span>
                </div>
                <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-800/40 rounded-lg border border-white/5">
                    <Radio className={`w-3.5 h-3.5 ${isMeshActive ? 'text-blue-400' : 'text-slate-600'}`} />
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest hidden sm:inline">Mesh</span>
                </div>
                <div className="flex items-center">
                    {isOnline ? (
                        <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
                    ) : (
                        <div className="w-2 h-2 rounded-full bg-red-500" />
                    )}
                </div>
            </div>
        </header>
    );
};
