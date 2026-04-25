import React, { useRef, useState, ChangeEvent } from 'react';
import { Play, Pause, Square, Plus, Trash2, Volume2, VolumeX, AlertCircle, Loader2, Repeat, Settings, Image as ImageIcon, Download, ChevronRight, X, ChevronLeft, Save } from 'lucide-react';
import { useMultitrack } from './hooks/useMultitrack';

const formatTime = (time: number) => {
  const m = Math.floor(time / 60);
  const s = Math.floor(time % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const hexToRgba = (hex: string, alpha: number) => {
  const r = parseInt(hex.slice(1, 3) || '00', 16);
  const g = parseInt(hex.slice(3, 5) || '00', 16);
  const b = parseInt(hex.slice(5, 7) || '00', 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

export default function App() {
  const {
    tracks, keyframes, projectConfig, isPlaying, isLooping, currentTime, duration,
    play, pause, stop, seek, setVolume, toggleMute, toggleLoop, addFiles, removeTrack,
    addOrUpdateKeyframe, removeKeyframe, updateProjectConfig, exportMLayer
  } = useMultitrack();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const [view, setView] = useState<'main' | 'settings'>('main');
  const [settingsTab, setSettingsTab] = useState<'project' | 'evolution'>('project');

  // Timeline UI States
  const [editingTimelineId, setEditingTimelineId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [kfTime, setKfTime] = useState<string>('0');
  const [kfIsLast, setKfIsLast] = useState(false);
  const [kfDurationAfter, setKfDurationAfter] = useState<string>('0');
  const [kfVolumes, setKfVolumes] = useState<Record<string, number>>({});

  const isReady = tracks.some(t => t.buffer !== null) && tracks.every(t => !t.isLoading);

  const theme = projectConfig.themeColors;
  const bgColor = theme ? hexToRgba(theme.bg, theme.bgOpacity) : '#000';
  const accentColor = theme ? hexToRgba(theme.accent, theme.accentOpacity) : '#6366f1';
  const btnColor = theme ? hexToRgba(theme.buttons, theme.buttonsOpacity) : 'rgba(255,255,255,0.1)';

  const handleCreateTimeline = () => {
    const t = parseFloat(kfTime);
    const d = parseFloat(kfDurationAfter) || 0;
    if (!isNaN(t) && t >= 0) {
      // Calculate current absolute volumes at time `t` to prefill
      const initialVols: Record<string, number> = {};
      tracks.forEach(track => { initialVols[track.id] = track.volume; });
      // In a real app we'd interpolate, but keeping it simple:
      const newId = crypto.randomUUID();
      addOrUpdateKeyframe(newId, t, initialVols, kfIsLast, d);
      setShowCreateForm(false);
      openTimelineEditor(newId);
    }
  };

  const openTimelineEditor = (id: string) => {
    const kf = keyframes.find(k => k.id === id);
    if (kf) {
      setKfTime(kf.time.toString());
      const vols = { ...kf.volumes };
      tracks.forEach(t => { if (vols[t.id] === undefined) vols[t.id] = t.volume; });
      setKfVolumes(vols);
      setKfIsLast(!!kf.isLast);
      setKfDurationAfter((kf.durationAfter || 0).toString());
      setEditingTimelineId(id);
    }
  };

  const saveTimelineVolumes = () => {
    if (!editingTimelineId) return;
    const t = parseFloat(kfTime);
    const d = parseFloat(kfDurationAfter) || 0;
    if (!isNaN(t) && t >= 0) {
      addOrUpdateKeyframe(editingTimelineId, t, kfVolumes, kfIsLast, d);
      setEditingTimelineId(null);
    }
  };

  const currentEvoDuration = () => {
    const lastKf = keyframes.find(k => k.isLast);
    return lastKf ? lastKf.time + (lastKf.durationAfter || 0) : duration;
  };

  return (
    <div className="w-full h-screen overflow-hidden flex flex-col relative text-white font-sans bg-black">
      {/* Global Background Layer */}
      {projectConfig.bgUrl && (
        <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${projectConfig.bgUrl})` }} />
      )}
      {/* Theme Overlay */}
      <div className="absolute inset-0 pointer-events-none" style={{ backgroundColor: bgColor }} />

      {/* Navigation */}
      <nav className="h-16 border-b border-white/10 px-6 flex items-center justify-between relative z-10 backdrop-blur-sm" style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}>
        <div className="flex items-center gap-4">
          <span className="text-xl font-bold tracking-tight opacity-90">MLayer Studio</span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => fileInputRef.current?.click()} className="px-4 py-2 rounded-md text-sm transition-colors" style={{ backgroundColor: btnColor }}>
            Импорт MLayer / Audio
          </button>
          <input type="file" multiple accept=".ml,.zip,audio/*" ref={fileInputRef} onChange={(e) => { e.target.files && addFiles(e.target.files); }} className="hidden" />

          {view === 'main' ? (
            <button onClick={() => setView('settings')} className="px-4 py-2 rounded-md text-sm transition-colors flex items-center gap-2" style={{ backgroundColor: btnColor }}>
              <Settings className="w-4 h-4" /> Настройки
            </button>
          ) : (
            <button onClick={() => setView('main')} className="px-4 py-2 rounded-md text-sm transition-colors flex items-center gap-2" style={{ backgroundColor: accentColor }}>
              <ChevronLeft className="w-4 h-4" /> Вернуться в плеер
            </button>
          )}

          <button onClick={exportMLayer} disabled={tracks.length === 0} className="px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50 transition-colors flex items-center gap-2" style={{ backgroundColor: accentColor }}>
            <Download className="w-4 h-4" /> Сохранить .ml
          </button>
        </div>
      </nav>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden relative z-10 flex">
        
        {/* === MAIN PLAYER VIEW === */}
        {view === 'main' && (
          <>
            {/* Left Column: Layers (Tracks) */}
            <div className="w-[45%] h-full flex flex-col border-r border-white/10 backdrop-blur-md" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
              <div className="p-4 border-b border-white/10">
                <h2 className="text-lg font-semibold opacity-90">Слои</h2>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {tracks.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center opacity-50">
                    <p className="mb-4">Нет треков</p>
                    <button onClick={() => fileInputRef.current?.click()} className="px-6 py-2 rounded-md transition-colors" style={{ backgroundColor: btnColor }}>Добавить файлы</button>
                  </div>
                ) : (
                  tracks.map(track => (
                    <div key={track.id} className="p-3 rounded-lg border border-white/5 flex flex-col gap-3 transition-colors" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium truncate flex-1" title={track.name}>{track.name}</span>
                        <div className="flex items-center gap-2 ml-4">
                          <button onClick={() => toggleMute(track.id)} className={`w-7 h-7 rounded text-xs flex items-center justify-center transition-colors ${track.isMuted ? 'bg-red-500/30 text-red-300' : 'hover:bg-white/10'}`} style={!track.isMuted ? { backgroundColor: btnColor } : {}}>M</button>
                          <button onClick={() => removeTrack(track.id)} className="w-7 h-7 rounded hover:bg-red-500/30 hover:text-red-300 flex items-center justify-center transition-colors" style={{ backgroundColor: btnColor }}><Trash2 className="w-3 h-3" /></button>
                        </div>
                      </div>
                      
                      {track.isLoading ? (
                        <div className="flex items-center gap-2 text-xs text-blue-300 bg-blue-500/10 px-2 py-1 rounded w-max"><Loader2 className="w-3 h-3 animate-spin"/> Загрузка аудио...</div>
                      ) : track.error ? (
                        <div className="flex items-center gap-2 text-xs text-red-300 bg-red-500/10 px-2 py-1 rounded w-max"><AlertCircle className="w-3 h-3"/> Ошибка декодирования</div>
                      ) : (
                        <div className="flex items-center gap-3">
                           <VolumeX className="w-3 h-3 opacity-40"/>
                           <input type="range" min="0" max="1" step="0.01" value={track.isMuted ? 0 : track.volume} onChange={(e) => setVolume(track.id, parseFloat(e.target.value))} className="flex-1 h-1.5 rounded-full appearance-none outline-none bg-white/10" style={{ backgroundImage: `linear-gradient(to right, ${accentColor} ${(track.isMuted ? 0 : track.volume)*100}%, transparent 0)` }} />
                           <Volume2 className="w-3 h-3 opacity-40"/>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Right Column: Player & Cover */}
            <div className="w-[55%] h-full flex flex-col relative overflow-y-auto">
              {/* Player UI */}
              <div className="flex-1 flex flex-col items-center justify-center p-8 min-h-[500px]">
                
                {/* Cover Art */}
                <div className="w-64 h-64 md:w-80 md:h-80 rounded-2xl shadow-2xl mb-8 flex items-center justify-center overflow-hidden border border-white/10" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
                  {projectConfig.coverUrl ? (
                    <img src={projectConfig.coverUrl} className="w-full h-full object-cover" alt="Cover" />
                  ) : (
                    <ImageIcon className="w-16 h-16 opacity-20" />
                  )}
                </div>

                {/* Metadata */}
                <div className="text-center mb-8 max-w-md w-full">
                  <h1 className="text-3xl font-bold mb-2 truncate" title={projectConfig.name}>{projectConfig.name}</h1>
                  <h2 className="text-lg opacity-60 truncate" title={projectConfig.author}>{projectConfig.author}</h2>
                </div>

                {/* Transport Controls */}
                <div className="flex items-center gap-6 mb-8">
                  <button onClick={toggleLoop} className={`p-4 rounded-full transition-colors`} style={{ backgroundColor: isLooping ? accentColor : btnColor }}>
                    <Repeat className="w-5 h-5" style={{ color: isLooping ? '#000' : '#fff' }} />
                  </button>
                  
                  <button onClick={isPlaying ? pause : play} disabled={!isReady || duration === 0} className="w-20 h-20 rounded-full flex items-center justify-center shadow-lg disabled:opacity-50 transition-transform active:scale-95" style={{ backgroundColor: accentColor }}>
                    {isPlaying ? <Pause className="w-8 h-8 fill-black text-black" /> : <Play className="w-8 h-8 fill-black text-black ml-1.5" />}
                  </button>
                  
                  <button onClick={stop} disabled={currentTime === 0 && !isPlaying} className="p-4 flex items-center justify-center rounded-full disabled:opacity-30 transition-colors" style={{ backgroundColor: btnColor }}>
                    <Square className="w-5 h-5 fill-current" />
                  </button>
                </div>

                {/* Global Seeker */}
                <div className="w-full max-w-lg mb-2">
                   <input type="range" min="0" max={duration || 1} step="0.1" value={currentTime} onChange={(e) => seek(parseFloat(e.target.value))} disabled={!isReady || duration === 0} className="w-full h-2 rounded-full appearance-none outline-none bg-white/10" style={{ backgroundImage: `linear-gradient(to right, ${accentColor} ${(currentTime / (duration||1))*100}%, transparent 0)` }} />
                </div>
                
                {/* Time Info */}
                <div className="w-full max-w-lg flex justify-between text-sm font-mono opacity-60">
                   <span>{formatTime(currentTime)}</span>
                   <span>
                     {(keyframes.find(k=>k.isLast) && isLooping) && <span className="mr-2 text-xs opacity-50 uppercase">Эволюция активна</span>}
                     {formatTime(currentEvoDuration())} {currentEvoDuration() !== duration ? `(${formatTime(duration)})` : ''}
                   </span>
                </div>
              </div>
            </div>
          </>
        )}

        {/* === FULLSCREEN SETTINGS / MENU VIEW === */}
        {view === 'settings' && (
          <div className="flex w-full h-full backdrop-blur-lg" style={{ backgroundColor: 'rgba(0,0,0,0.8)' }}>
             
             {/* Left Settings Navigation */}
             <div className="w-64 border-r border-white/10 p-6 flex flex-col gap-2">
               <h2 className="text-xl font-bold mb-6 opacity-90">Меню</h2>
               <button onClick={() => setSettingsTab('project')} className={`text-left px-5 py-4 rounded-lg transition-colors font-medium`} style={{ backgroundColor: settingsTab === 'project' ? accentColor : btnColor, color: settingsTab === 'project' ? '#000' : '#fff' }}>
                 О проекте
               </button>
               <button onClick={() => setSettingsTab('evolution')} className={`text-left px-5 py-4 rounded-lg transition-colors font-medium`} style={{ backgroundColor: settingsTab === 'evolution' ? accentColor : btnColor, color: settingsTab === 'evolution' ? '#000' : '#fff' }}>
                 Эволюция слоёв
               </button>
             </div>

             {/* Right Settings Content */}
             <div className="flex-1 p-8 overflow-y-auto">
               <div className="max-w-3xl mx-auto">
                  
                  {/* PROJECT SETTINGS */}
                  {settingsTab === 'project' && (
                    <div className="space-y-8 animate-in fade-in zoom-in-95 duration-200">
                      <h3 className="text-2xl font-bold text-white">Основная информация и Дизайн</h3>
                      
                      <div className="grid grid-cols-2 gap-6">
                        <div>
                           <label className="block text-sm opacity-70 mb-2">Название проекта</label>
                           <input type="text" value={projectConfig.name} onChange={e => updateProjectConfig({ name: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-lg p-3 outline-none focus:border-white/30" />
                        </div>
                        <div>
                           <label className="block text-sm opacity-70 mb-2">Автор</label>
                           <input type="text" value={projectConfig.author} onChange={e => updateProjectConfig({ author: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-lg p-3 outline-none focus:border-white/30" />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-6">
                        <div>
                           <label className="block text-sm opacity-70 mb-2">Обложка</label>
                           <button onClick={() => coverInputRef.current?.click()} className="w-full border border-white/10 border-dashed rounded-lg p-6 text-sm hover:bg-white/5 transition-colors flex flex-col items-center gap-2" style={{ backgroundColor: btnColor }}>
                             {projectConfig.coverUrl ? <img src={projectConfig.coverUrl} className="w-16 h-16 object-cover rounded" /> : <ImageIcon className="w-8 h-8 opacity-50" />}
                             <span className="opacity-80 mt-2">{projectConfig._coverFile ? 'Изменить обложку' : 'Загрузить обложку проекта'}</span>
                           </button>
                           <input type="file" accept="image/*" ref={coverInputRef} className="hidden" onChange={(e) => { if (e.target.files?.[0]) updateProjectConfig({ coverUrl: URL.createObjectURL(e.target.files[0]), _coverFile: e.target.files[0] }); }} />
                        </div>
                        <div>
                           <label className="block text-sm opacity-70 mb-2">Фоновое изображение</label>
                           <button onClick={() => bgInputRef.current?.click()} className="w-full border border-white/10 border-dashed rounded-lg p-6 text-sm hover:bg-white/5 transition-colors flex flex-col items-center gap-2" style={{ backgroundColor: btnColor }}>
                             {projectConfig.bgUrl ? <div className="w-16 h-16 rounded bg-cover bg-center" style={{backgroundImage: `url(${projectConfig.bgUrl})`}} /> : <ImageIcon className="w-8 h-8 opacity-50" />}
                             <span className="opacity-80 mt-2">{projectConfig._bgFile ? 'Изменить фон' : 'Загрузить фон'}</span>
                           </button>
                           <input type="file" accept="image/*" ref={bgInputRef} className="hidden" onChange={(e) => { if (e.target.files?.[0]) updateProjectConfig({ bgUrl: URL.createObjectURL(e.target.files[0]), _bgFile: e.target.files[0] }); }} />
                        </div>
                      </div>

                      <div className="space-y-6 pt-6 border-t border-white/10">
                        <h4 className="text-xl font-bold">Цвета интерфейса</h4>
                        <div className="space-y-4">
                           {/* BG Color */}
                           <div className="flex gap-4 items-center p-4 rounded-lg border border-white/5 bg-black/20">
                             <div className="w-32"><span className="text-sm opacity-80 block">Форн</span></div>
                             <input type="color" value={theme.bg} onChange={e => updateProjectConfig({ themeColors: { ...theme, bg: e.target.value }})} className="w-12 h-12 rounded cursor-pointer" />
                             <div className="flex-1 px-4">
                               <label className="text-xs opacity-50 block mb-1">Непрозрачность слоя ({Math.round(theme.bgOpacity*100)}%)</label>
                               <input type="range" min="0" max="1" step="0.05" value={theme.bgOpacity} onChange={e => updateProjectConfig({ themeColors: {...theme, bgOpacity: parseFloat(e.target.value)} })} className="w-full h-1 bg-white/20 rounded-full appearance-none overflow-hidden" />
                             </div>
                           </div>
                           
                           {/* Accent Color */}
                           <div className="flex gap-4 items-center p-4 rounded-lg border border-white/5 bg-black/20">
                             <div className="w-32"><span className="text-sm opacity-80 block">Акцент</span></div>
                             <input type="color" value={theme.accent} onChange={e => updateProjectConfig({ themeColors: { ...theme, accent: e.target.value }})} className="w-12 h-12 rounded cursor-pointer" />
                             <div className="flex-1 px-4">
                               <label className="text-xs opacity-50 block mb-1">Непрозрачность ({Math.round(theme.accentOpacity*100)}%)</label>
                               <input type="range" min="0" max="1" step="0.05" value={theme.accentOpacity} onChange={e => updateProjectConfig({ themeColors: {...theme, accentOpacity: parseFloat(e.target.value)} })} className="w-full h-1 bg-white/20 rounded-full appearance-none overflow-hidden" />
                             </div>
                           </div>

                           {/* Buttons Color */}
                           <div className="flex gap-4 items-center p-4 rounded-lg border border-white/5 bg-black/20">
                             <div className="w-32"><span className="text-sm opacity-80 block">Кнопки/Панели</span></div>
                             <input type="color" value={theme.buttons} onChange={e => updateProjectConfig({ themeColors: { ...theme, buttons: e.target.value }})} className="w-12 h-12 rounded cursor-pointer" />
                             <div className="flex-1 px-4">
                               <label className="text-xs opacity-50 block mb-1">Непрозрачность ({Math.round(theme.buttonsOpacity*100)}%)</label>
                               <input type="range" min="0" max="1" step="0.05" value={theme.buttonsOpacity} onChange={e => updateProjectConfig({ themeColors: {...theme, buttonsOpacity: parseFloat(e.target.value)} })} className="w-full h-1 bg-white/20 rounded-full appearance-none overflow-hidden" />
                             </div>
                           </div>
                        </div>
                      </div>

                    </div>
                  )}

                  {/* EVOLUTION SETTINGS LIST */}
                  {settingsTab === 'evolution' && !showCreateForm && !editingTimelineId && (
                     <div className="animate-in fade-in zoom-in-95 duration-200">
                       <div className="flex justify-between items-center mb-8 pb-4 border-b border-white/10">
                         <h3 className="text-2xl font-bold">Эволюция слоёв</h3>
                         <button onClick={() => { setShowCreateForm(true); setKfTime('0'); setKfIsLast(false); setKfDurationAfter('0'); }} className="px-5 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors text-black" style={{ backgroundColor: accentColor }}>
                            <Plus className="w-4 h-4"/> Создать таймлайн
                         </button>
                       </div>
                       
                       <div className="space-y-4">
                         {keyframes.length === 0 ? (
                           <div className="text-center py-20 opacity-50 border border-white/10 border-dashed rounded-xl">Ни одного таймлайна не создано.</div>
                         ) : (
                           keyframes.map((kf, index) => (
                             <div key={kf.id} className="border border-white/10 rounded-xl p-5 flex items-center justify-between" style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}>
                                <div className="flex items-center gap-6">
                                  <div className="w-8 h-8 rounded-full flex items-center justify-center font-mono text-sm opacity-60 bg-white/5">{index + 1}</div>
                                  <div className="text-xl font-mono min-w-[80px]">{formatTime(kf.time)}</div>
                                  {kf.isLast && (
                                    <div className="flex flex-col">
                                      <span className="text-[10px] bg-red-500/20 text-red-300 px-2 py-0.5 rounded uppercase tracking-wider font-bold w-max mb-1">Последний</span>
                                      {kf.durationAfter && kf.durationAfter > 0 ? (
                                        <span className="text-xs opacity-60">Конец через {kf.durationAfter} сек.</span>
                                      ) : null}
                                    </div>
                                  )}
                                </div>
                                <div className="flex items-center gap-3">
                                  <button onClick={() => openTimelineEditor(kf.id)} className="px-5 py-2 rounded-md text-sm transition-colors text-black font-medium" style={{ backgroundColor: accentColor }}>Настроить слои</button>
                                  <button onClick={() => removeKeyframe(kf.id)} className="p-2 rounded-md hover:bg-red-500/30 hover:text-red-300 transition-colors" style={{ backgroundColor: btnColor }}><Trash2 className="w-4 h-4"/></button>
                                </div>
                             </div>
                           ))
                         )}
                       </div>
                     </div>
                  )}

                  {/* EVOLUTION CREATE FORM */}
                  {settingsTab === 'evolution' && showCreateForm && (
                     <div className="animate-in slide-in-from-bottom-4 duration-200">
                        <div className="flex items-center gap-4 mb-8">
                           <button onClick={() => setShowCreateForm(false)} className="opacity-50 hover:opacity-100 flex items-center gap-1"><ChevronLeft className="w-4 h-4"/> Назад</button>
                           <h3 className="text-2xl font-bold">Новый таймлайн</h3>
                        </div>

                        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 space-y-6">
                           <div>
                             <label className="block text-sm opacity-70 mb-2">Время начала (в секундах)</label>
                             <input type="number" step="0.1" value={kfTime} onChange={e => setKfTime(e.target.value)} className="w-full max-w-xs bg-black/40 border border-white/10 rounded-lg p-3 outline-none" />
                           </div>

                           <div className="pt-4 border-t border-white/10">
                              <label className="flex items-center gap-3 cursor-pointer p-4 rounded-lg bg-black/20 border border-white/5 w-max hover:bg-white/5 transition-colors">
                                 <input type="checkbox" checked={kfIsLast} onChange={e => setKfIsLast(e.target.checked)} className="w-5 h-5 accent-indigo-500" />
                                 <span className="font-medium opacity-90">Установить как последний</span>
                              </label>
                           </div>

                           {kfIsLast && (
                             <div className="pt-4 animate-in fade-in">
                               <label className="block text-sm opacity-70 mb-2 text-red-200">Через сколько секунд он закончится и начнётся сначала?</label>
                               <input type="number" step="0.1" value={kfDurationAfter} onChange={e => setKfDurationAfter(e.target.value)} className="w-full max-w-xs bg-red-900/20 border border-red-500/30 rounded-lg p-3 outline-none focus:border-red-500/60 transition-colors" />
                             </div>
                           )}

                           <div className="pt-8">
                              <button onClick={handleCreateTimeline} className="px-8 py-3 rounded-lg text-black font-medium transition-colors w-full sm:w-auto" style={{ backgroundColor: accentColor }}>Создать и перейти к настройке слоёв</button>
                           </div>
                        </div>
                     </div>
                  )}

                  {/* EVOLUTION TIMELINE EDITOR (VOLUMES) */}
                  {settingsTab === 'evolution' && editingTimelineId && (
                     <div className="animate-in fade-in zoom-in-95 duration-200">
                        <div className="flex items-center justify-between mb-8 pb-4 border-b border-white/10">
                           <div className="flex items-center gap-4">
                             <button onClick={() => setEditingTimelineId(null)} className="opacity-50 hover:opacity-100 flex items-center gap-1"><ChevronLeft className="w-4 h-4"/> Назад к списку</button>
                             <span className="opacity-30">|</span>
                             <h3 className="text-xl font-bold">Настройка слоёв для таймлайна</h3>
                           </div>
                           <button onClick={saveTimelineVolumes} className="px-6 py-2.5 rounded-lg text-black font-medium transition-colors flex items-center gap-2" style={{ backgroundColor: accentColor }}><Save className="w-4 h-4"/> Сохранить</button>
                        </div>

                        <div className="mb-8 flex gap-6 bg-white/5 p-4 rounded-xl border border-white/10">
                           <div>
                             <span className="block text-xs opacity-50 mb-1">Время</span>
                             <span className="font-mono text-xl">{formatTime(parseFloat(kfTime) || 0)}</span>
                           </div>
                           {kfIsLast && (
                             <div className="pl-6 border-l border-white/10">
                               <span className="block text-xs text-red-300 opacity-80 mb-1">Последний. Длительность до петли:</span>
                               <span className="font-mono text-xl">{kfDurationAfter} сек</span>
                             </div>
                           )}
                        </div>

                        <div className="bg-black/30 border border-white/10 rounded-2xl p-6 space-y-6">
                           <h4 className="text-lg font-medium opacity-80 border-b border-white/10 pb-4">Громкость треков на этом этапе</h4>
                           
                           {tracks.length === 0 ? (
                             <div className="opacity-50 py-4">Нет треков для настройки.</div>
                           ) : (
                             tracks.map(track => {
                               const v = kfVolumes[track.id] ?? track.volume;
                               return (
                                 <div key={track.id} className="flex items-center gap-6 p-4 rounded-lg bg-white/5 border border-white/5 transition-colors hover:bg-white/10">
                                   <span className="w-48 text-sm font-medium truncate opacity-90">{track.name}</span>
                                   <input 
                                     type="range" min="0" max="1" step="0.01" value={v}
                                     onChange={(e) => setKfVolumes(p => ({ ...p, [track.id]: parseFloat(e.target.value) }))}
                                     className="flex-1 h-2 rounded-full appearance-none outline-none bg-black/50"
                                     style={{ backgroundImage: `linear-gradient(to right, ${accentColor} ${v * 100}%, transparent 0)` }}
                                   />
                                   <span className="w-16 text-sm font-mono text-right opacity-70 bg-black/30 px-2 py-1 rounded">{Math.round(v * 100)}%</span>
                                 </div>
                               )
                             })
                           )}
                        </div>
                     </div>
                  )}

               </div>
             </div>

          </div>
        )}

      </div>
    </div>
  );
}
