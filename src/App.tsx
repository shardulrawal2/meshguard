import { useState, useEffect } from 'react';
import { useSOS } from './hooks/useSOS';
import { Header } from './components/Header';
import { SosForm } from './components/SosForm';
import { MessageCard } from './components/MessageCard';
import { Settings } from './components/Settings';
import { fallDetector } from './ai/FallDetector';
import { LayoutDashboard, Settings as SettingsIcon, MessageSquare, QrCode, Camera, Radio } from 'lucide-react';

function App() {
  const { messages, isOnline, sendSOS, sendTestMessage } = useSOS();
  const [activeTab, setActiveTab] = useState<'dashboard' | 'messages' | 'settings'>('dashboard');
  const [fallDetectionOn, setFallDetectionOn] = useState(false);
  const [pairingAction, setPairingAction] = useState<'generate' | 'scan' | null>(null);

  useEffect(() => {
    if (fallDetectionOn) {
      fallDetector.start(() => {
        sendSOS("🚨 AUTOMATIC FALL DETECTED - Assistance required at this location.", true);
      });
    } else {
      fallDetector.stop();
    }
    return () => fallDetector.stop();
  }, [fallDetectionOn, sendSOS]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 pb-24 font-sans selection:bg-blue-500/30">
      {/* Dynamic Background Element */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-blue-600/10 blur-[120px] rounded-full" />
        <div className="absolute top-[20%] -right-[5%] w-[30%] h-[30%] bg-indigo-600/10 blur-[100px] rounded-full" />
      </div>

      <Header
        isOnline={isOnline}
        isMeshActive={true}
        isFallDetectionOn={fallDetectionOn}
      />

      <main className="relative z-10 max-w-lg mx-auto px-6 pt-24 space-y-10">
        {activeTab === 'dashboard' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="text-center space-y-2">
              <h2 className="text-3xl font-extrabold tracking-tight">Safe Guarded</h2>
              <p className="text-slate-400 text-base">Mesh network monitoring active</p>
            </div>

            <SosForm onSend={(text) => sendSOS(text)} />

            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <button onClick={() => { setActiveTab('settings'); setPairingAction('generate'); }} className="p-6 bg-indigo-600 hover:bg-indigo-500 text-white rounded-3xl transition-all active:scale-95 shadow-lg shadow-indigo-900/40 font-black uppercase tracking-widest flex items-center justify-center gap-4 text-sm">
                  <QrCode className="w-5 h-5" /> Generate Link
                </button>
                <button onClick={() => { setActiveTab('settings'); setPairingAction('scan'); }} className="p-6 bg-slate-800 hover:bg-slate-700 text-white rounded-3xl transition-all active:scale-95 border border-white/5 font-black uppercase tracking-widest flex items-center justify-center gap-4 text-sm">
                  <Camera className="w-5 h-5 text-slate-400" /> Scan Peer
                </button>
                <button onClick={sendTestMessage} className="p-6 bg-green-600 hover:bg-green-500 text-white rounded-3xl transition-all active:scale-95 shadow-lg shadow-green-900/40 font-black uppercase tracking-widest flex items-center justify-center gap-4 text-sm">
                  <Radio className="w-5 h-5" /> Test Message
                </button>
              </div>
              <div className="space-y-4">
                {messages.length === 0 ? (
                  <div className="bg-slate-900/40 backdrop-blur-sm border border-slate-800/50 p-12 rounded-3xl text-center">
                    <p className="text-slate-500 text-sm italic">No active SOS reports in your area</p>
                  </div>
                ) : (
                  messages.slice(0, 3).map(m => <MessageCard key={m.id} message={m} />)
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'messages' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold">Message History</h2>
              <div className="text-xs px-2 py-1 bg-slate-800 rounded-lg text-slate-400 border border-slate-700">
                {messages.length} Total
              </div>
            </div>
            <div className="space-y-4">
              {messages.length === 0 ? (
                <div className="bg-slate-900/40 backdrop-blur-sm border border-slate-800/50 p-12 rounded-3xl text-center">
                  <p className="text-slate-500 text-sm italic">Historical reports will appear here</p>
                </div>
              ) : (
                messages.map(m => <MessageCard key={m.id} message={m} />)
              )}
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
            <Settings
              fallDetectionEnabled={fallDetectionOn}
              onToggleFallDetection={setFallDetectionOn}
              onSendTestMessage={sendTestMessage}
              initialAction={pairingAction}
              onActionHandled={() => setPairingAction(null)}
            />
          </div>
        )}
      </main>

      {/* Premium Bottom Navigation */}
      <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[calc(100%-3rem)] max-w-md bg-slate-900/80 backdrop-blur-xl border border-white/10 px-8 py-4 rounded-3xl flex items-center justify-between z-50 shadow-2xl shadow-black/50">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`group flex flex-col items-center gap-1 transition-all ${activeTab === 'dashboard' ? 'text-blue-400' : 'text-slate-500'}`}
        >
          <div className={`p-2 rounded-xl transition-all ${activeTab === 'dashboard' ? 'bg-blue-500/10' : 'group-hover:bg-slate-800'}`}>
            <LayoutDashboard className="w-6 h-6" />
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wider">Home</span>
        </button>
        <button
          onClick={() => setActiveTab('messages')}
          className={`group flex flex-col items-center gap-1 transition-all ${activeTab === 'messages' ? 'text-blue-400' : 'text-slate-500'}`}
        >
          <div className={`p-2 rounded-xl transition-all ${activeTab === 'messages' ? 'bg-blue-500/10' : 'group-hover:bg-slate-800'}`}>
            <MessageSquare className="w-6 h-6" />
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wider">Feed</span>
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`group flex flex-col items-center gap-1 transition-all ${activeTab === 'settings' ? 'text-blue-400' : 'text-slate-500'}`}
        >
          <div className={`p-2 rounded-xl transition-all ${activeTab === 'settings' ? 'bg-blue-500/10' : 'group-hover:bg-slate-800'}`}>
            <SettingsIcon className="w-6 h-6" />
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wider">Settings</span>
        </button>
      </nav>
    </div>
  );
}

export default App;
