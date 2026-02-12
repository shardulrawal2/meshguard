import React, { useState } from 'react';
import { Send, MapPin, AlertTriangle } from 'lucide-react';

interface SosFormProps {
    onSend: (text: string) => void;
}

export const SosForm: React.FC<SosFormProps> = ({ onSend }) => {
    const [text, setText] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (text.trim()) {
            onSend(text);
            setText('');
        }
    };

    return (
        <div className="bg-slate-900/60 backdrop-blur-2xl p-8 rounded-[2.5rem] border border-white/5 shadow-2xl relative overflow-hidden group">
            {/* Accent Glow */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/10 blur-3xl rounded-full -mr-16 -mt-16 group-hover:bg-red-500/20 transition-all duration-700" />

            <div className="flex items-center gap-3 text-red-500 mb-6 px-1">
                <div className="p-2 bg-red-500/10 rounded-xl">
                    <AlertTriangle className="w-6 h-6 animate-pulse" />
                </div>
                <h2 className="text-xl font-bold tracking-tight">Emergency SOS</h2>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6 relative z-10">
                <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="What is your emergency?"
                    className="w-full bg-slate-950/50 border border-slate-800 rounded-[1.5rem] p-5 text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500/50 transition-all min-h-[140px] text-lg resize-none shadow-inner"
                />

                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-1">
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
                        <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                        <MapPin className="w-4 h-4" />
                        <span>GPS Tracking Active</span>
                    </div>

                    <button
                        type="submit"
                        disabled={!text.trim()}
                        className="w-full sm:w-auto bg-red-600 hover:bg-red-500 disabled:opacity-30 disabled:hover:bg-red-600 text-white font-black py-4 px-10 rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-95 shadow-lg shadow-red-900/20 hover:shadow-red-600/40 uppercase tracking-widest text-xs"
                    >
                        <Send className="w-5 h-5 fill-current" />
                        Broadcast SOS
                    </button>
                </div>
            </form>
        </div>
    );
};
