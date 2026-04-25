import { useState, useRef, useEffect, useCallback } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

export type Track = { id: string; name: string; buffer: AudioBuffer | null; file?: File | Blob; volume: number; isMuted: boolean; isLoading: boolean; error: string | null; };
export type Keyframe = { id: string; time: number; volumes: Record<string, number>; isLast?: boolean; durationAfter?: number; };
export type ProjectConfig = { name: string; author: string; themeColors: { bg: string; bgOpacity: number; accent: string; accentOpacity: number; buttons: string; buttonsOpacity: number; }; bgUrl: string | null; coverUrl: string | null; _bgFile?: Blob | null; _coverFile?: Blob | null; };

let audioCtx: AudioContext | null = null;
const getContext = () => { if (!audioCtx) audioCtx = new AudioContext(); return audioCtx; };

export function useMultitrack() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [keyframes, setKeyframes] = useState<Keyframe[]>([]);
  const [isLooping, setIsLooping] = useState(false);
  const [projectConfig, setProjectConfig] = useState<ProjectConfig>({
    name: 'Новый проект MLayer',
    author: 'Неизвестный автор',
    themeColors: { bg: '#000000', bgOpacity: 0.8, accent: '#6366f1', accentOpacity: 1, buttons: '#ffffff', buttonsOpacity: 0.1 },
    bgUrl: null, coverUrl: null
  });

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  const sourceNodesRef = useRef<Map<string, AudioBufferSourceNode>>(new Map());
  const gainNodesRef = useRef<Map<string, GainNode>>(new Map());
  const startTimeRef = useRef<number>(0);
  const pausedAtRef = useRef<number>(0);
  const isPlayingRef = useRef(false);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  const animFrameIdRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  const tracksRef = useRef<Track[]>([]);
  useEffect(() => { tracksRef.current = tracks; }, [tracks]);

  const keyframesRef = useRef<Keyframe[]>([]);
  useEffect(() => { keyframesRef.current = keyframes; }, [keyframes]);

  const isLoopingRef = useRef(false);
  useEffect(() => { isLoopingRef.current = isLooping; }, [isLooping]);

  const duration = tracks.reduce((acc, t) => Math.max(acc, t.buffer?.duration || 0), 0);
  const durationRef = useRef(0);
  useEffect(() => { durationRef.current = duration; }, [duration]);

  const stopNodes = useCallback(() => {
    sourceNodesRef.current.forEach(node => { try { node.stop(); node.disconnect(); } catch (e) {} });
    sourceNodesRef.current.clear();
    gainNodesRef.current.forEach(node => { try { node.disconnect(); } catch (e) {} });
    gainNodesRef.current.clear();
    if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
  }, []);

  const updateProgress = useCallback(() => {
    if (!isPlayingRef.current) return;
    const ctx = getContext();
    const currentAudioTime = ctx.currentTime - startTimeRef.current;

    if (durationRef.current > 0 && currentAudioTime >= durationRef.current) {
      if (isLoopingRef.current) {
        stopNodes(); pausedAtRef.current = 0; lastTimeRef.current = 0; setCurrentTime(0);
        const targetStartTime = ctx.currentTime + 0.05;
        tracksRef.current.forEach(track => {
          if (!track.buffer) return;
          const source = ctx.createBufferSource(); source.buffer = track.buffer;
          const gain = ctx.createGain();
          let currentTrackVol = track.volume;
          const initialKfs = keyframesRef.current.filter(k => Math.abs(k.time) < 0.05);
          if (initialKfs.length > 0 && initialKfs[0].volumes[track.id] !== undefined) currentTrackVol = initialKfs[0].volumes[track.id];
          gain.gain.value = track.isMuted ? 0 : currentTrackVol;
          source.connect(gain); gain.connect(ctx.destination);
          source.start(targetStartTime, 0);
          sourceNodesRef.current.set(track.id, source); gainNodesRef.current.set(track.id, gain);
        });
        startTimeRef.current = targetStartTime;
        animFrameIdRef.current = requestAnimationFrame(updateProgress);
        return;
      } else {
        stopNodes(); setIsPlaying(false); pausedAtRef.current = 0; setCurrentTime(durationRef.current); lastTimeRef.current = 0;
        return;
      }
    }

    const lastKf = keyframesRef.current.find(k => k.isLast);
    const evolutionDuration = lastKf ? lastKf.time + (lastKf.durationAfter || 0) : null;
    let currentEvoTime = currentAudioTime;
    const prevEvoTime = lastTimeRef.current;

    if (evolutionDuration && evolutionDuration > 0) currentEvoTime = currentAudioTime % evolutionDuration;

    if (evolutionDuration && currentEvoTime < prevEvoTime) {
      const initialKfs = keyframesRef.current.filter(k => k.time === 0);
      if (initialKfs.length > 0) {
        Object.entries(initialKfs[0].volumes).forEach(([trackId, targetVolume]) => {
          const gainNode = gainNodesRef.current.get(trackId);
          if (gainNode) { gainNode.gain.cancelScheduledValues(ctx.currentTime); gainNode.gain.setValueAtTime(targetVolume, ctx.currentTime); }
          setTracks(prev => prev.map(t => t.id === trackId ? { ...t, volume: targetVolume } : t));
        });
      }
    } else {
      keyframesRef.current.forEach(kf => {
        if (kf.time === 0) return; 
        if (prevEvoTime <= kf.time && currentEvoTime >= kf.time) {
          Object.entries(kf.volumes).forEach(([trackId, targetVolume]) => {
            const gainNode = gainNodesRef.current.get(trackId);
            if (gainNode) { gainNode.gain.cancelScheduledValues(ctx.currentTime); gainNode.gain.setTargetAtTime(targetVolume, ctx.currentTime, 0.1); }
            setTracks(prev => prev.map(t => t.id === trackId ? { ...t, volume: targetVolume } : t));
          });
        }
      });
    }

    lastTimeRef.current = currentEvoTime;
    setCurrentTime(currentAudioTime);
    animFrameIdRef.current = requestAnimationFrame(updateProgress);
  }, [stopNodes]);

  const play = useCallback(() => {
    if (isPlayingRef.current || tracksRef.current.length === 0 || durationRef.current === 0) return;
    const ctx = getContext();
    if (ctx.state === 'suspended') ctx.resume();
    stopNodes();
    let resumeTime = pausedAtRef.current >= durationRef.current ? 0 : pausedAtRef.current;
    const targetStartTime = ctx.currentTime + 0.05;

    tracksRef.current.forEach(track => {
      if (!track.buffer) return;
      const source = ctx.createBufferSource(); source.buffer = track.buffer;
      const gain = ctx.createGain(); gain.gain.value = track.isMuted ? 0 : track.volume;
      source.connect(gain); gain.connect(ctx.destination);
      source.start(targetStartTime, resumeTime);
      sourceNodesRef.current.set(track.id, source); gainNodesRef.current.set(track.id, gain);
    });

    startTimeRef.current = targetStartTime - resumeTime;
    const lastKf = keyframesRef.current.find(k => k.isLast);
    const loopDur = lastKf ? lastKf.time + (lastKf.durationAfter || 0) : null;
    lastTimeRef.current = loopDur && loopDur > 0 ? resumeTime % loopDur : resumeTime;
    setIsPlaying(true);
    animFrameIdRef.current = requestAnimationFrame(updateProgress);
  }, [stopNodes, updateProgress]);

  const stop = useCallback(() => { stopNodes(); setIsPlaying(false); pausedAtRef.current = 0; lastTimeRef.current = 0; setCurrentTime(0); }, [stopNodes]);
  const pause = useCallback(() => { stopNodes(); setIsPlaying(false); pausedAtRef.current = currentTime; }, [stopNodes, currentTime]);

  const seek = useCallback((time: number) => {
    const boundTime = Math.max(0, Math.min(time, durationRef.current));
    const wasPlaying = isPlayingRef.current;
    if (wasPlaying) { stopNodes(); setIsPlaying(false); }
    pausedAtRef.current = boundTime; setCurrentTime(boundTime);
    
    const lastKf = keyframesRef.current.find(k => k.isLast);
    const loopDur = lastKf ? lastKf.time + (lastKf.durationAfter || 0) : null;
    let currentEvoTime = loopDur && loopDur > 0 ? boundTime % loopDur : boundTime;
    lastTimeRef.current = currentEvoTime;

    const newlyAppliedVolumes = new Map<string, number>();
    tracksRef.current.forEach(track => {
      const pastEvents = keyframesRef.current.filter(k => k.time <= currentEvoTime);
      if (pastEvents.length > 0) {
        pastEvents.sort((a,b) => a.time - b.time);
        const latestEvent = pastEvents[pastEvents.length - 1];
        if (latestEvent.volumes[track.id] !== undefined) {
          const targetVol = latestEvent.volumes[track.id];
          newlyAppliedVolumes.set(track.id, targetVol);
          const gainNode = gainNodesRef.current.get(track.id);
          if (gainNode) { gainNode.gain.cancelScheduledValues(getContext().currentTime); gainNode.gain.setValueAtTime(targetVol, getContext().currentTime); }
        }
      }
    });

    if (newlyAppliedVolumes.size > 0) setTracks(prev => prev.map(t => { const v = newlyAppliedVolumes.get(t.id); return v !== undefined ? { ...t, volume: v } : t; }));
    if (wasPlaying) play();
  }, [stopNodes, play]);

  const toggleLoop = useCallback(() => setIsLooping(prev => !prev), []);

  const setVolume = useCallback((id: string, vol: number) => {
    setTracks(prev => prev.map(t => (t.id === id ? { ...t, volume: vol } : t)));
    const gainNode = gainNodesRef.current.get(id);
    if (gainNode) gainNode.gain.setValueAtTime(vol, getContext().currentTime);
  }, []);

  const toggleMute = useCallback((id: string) => {
    setTracks(prev => {
      const track = prev.find(t => t.id === id);
      if (!track) return prev;
      const gainNode = gainNodesRef.current.get(id);
      if (gainNode) gainNode.gain.setValueAtTime(!track.isMuted ? 0 : track.volume, getContext().currentTime);
      return prev.map(t => (t.id === id ? { ...t, isMuted: !track.isMuted } : t));
    });
  }, []);

  const processAudioFile = useCallback(async (fileInfo: { id: string, name: string, data: ArrayBuffer | Blob }) => {
    const ctx = getContext(); const id = fileInfo.id;
    try {
      const arrayBuffer = fileInfo.data instanceof Blob ? await fileInfo.data.arrayBuffer() : fileInfo.data;
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      setTracks(prev => prev.map(t => (t.id === id ? { ...t, buffer: audioBuffer, isLoading: false } : t)));
    } catch (error) {
      setTracks(prev => prev.map(t => (t.id === id ? { ...t, isLoading: false, error: 'Ошибка декодирования' } : t)));
    }
  }, []);

  const loadMLFile = useCallback(async (file: File) => {
    try {
      const zip = new JSZip(); const loadedZip = await zip.loadAsync(file);
      let config: ProjectConfig = { name: file.name.replace('.ml', ''), author: 'Неизвестный автор', themeColors: { bg: '#000000', bgOpacity: 0.8, accent: '#6366f1', accentOpacity: 1, buttons: '#ffffff', buttonsOpacity: 0.1 }, bgUrl: null, coverUrl: null };
      let newKeyframes: Keyframe[] = [];

      const metaFile = loadedZip.file('meta.json');
      if (metaFile) {
        const meta = JSON.parse(await metaFile.async('string'));
        if (meta.name) config.name = meta.name;
        if (meta.author) config.author = meta.author;
        if (meta.themeColors) config.themeColors = { ...config.themeColors, ...meta.themeColors };
        if (meta.keyframes) newKeyframes = meta.keyframes;
      }

      const bgFiles = Object.keys(loadedZip.files).filter(k => k.startsWith('bg_'));
      if (bgFiles.length > 0) { const blob = await loadedZip.file(bgFiles[0])!.async('blob'); config.bgUrl = URL.createObjectURL(blob); config._bgFile = blob; }

      const coverFiles = Object.keys(loadedZip.files).filter(k => k.startsWith('cover_'));
      if (coverFiles.length > 0) { const blob = await loadedZip.file(coverFiles[0])!.async('blob'); config.coverUrl = URL.createObjectURL(blob); config._coverFile = blob; }

      setProjectConfig(config); setKeyframes(newKeyframes);

      const audioPaths = Object.keys(loadedZip.files).filter(k => k.match(/\.(mp3|wav|ogg|flac)$/i));
      const trackInitializers = audioPaths.map(path => ({ id: crypto.randomUUID(), name: path.split('/').pop() || path, buffer: null, volume: 1, isMuted: false, isLoading: true, error: null, _path: path }));
      setTracks(trackInitializers.map(({_path, ...t}) => t as Track));

      for (const tInit of trackInitializers) {
        const data = await loadedZip.file(tInit._path)!.async('blob');
        setTracks(prev => prev.map(t => (t.id === tInit.id ? { ...t, file: data } : t)));
        await processAudioFile({ id: tInit.id, name: tInit.name, data });
      }
    } catch (e) { alert("Не удалось загрузить MLayer: " + e); }
  }, [processAudioFile]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const fileArr = Array.from(files);
    const mlFile = fileArr.find(f => f.name.endsWith('.ml') || f.name.endsWith('.zip'));
    if (mlFile) { stopNodes(); setIsPlaying(false); setTracks([]); setKeyframes([]); await loadMLFile(mlFile); return; }

    const newTrackIds: string[] = [];
    setTracks(prev => {
      const initialTracks = fileArr.map(file => { const id = crypto.randomUUID(); newTrackIds.push(id); return { id, name: file.name, buffer: null, file, volume: 1, isMuted: false, isLoading: true, error: null }; });
      return [...prev, ...initialTracks];
    });
    for (let i = 0; i < fileArr.length; i++) await processAudioFile({ id: newTrackIds[i], name: fileArr[i].name, data: fileArr[i] });
  }, [loadMLFile, processAudioFile, stopNodes]);

  const removeTrack = useCallback((id: string) => {
    setTracks(prev => {
       const newTracks = prev.filter(t => t.id !== id);
       if (newTracks.length === 0) { try { stopNodes(); setIsPlaying(false); } catch(e){} }
       return newTracks;
    });
    setKeyframes(prev => prev.map(kf => { const newVols = { ...kf.volumes }; delete newVols[id]; return { ...kf, volumes: newVols }; }));
  }, [stopNodes]);

  const addOrUpdateKeyframe = useCallback((id: string, time: number, newVolumes: Record<string, number>, isLast?: boolean, durationAfter?: number) => {
    setKeyframes(prev => {
      let nextState = [...prev];
      const existingIdx = nextState.findIndex(k => k.id === id);
      
      if (existingIdx !== -1) {
         nextState[existingIdx] = { ...nextState[existingIdx], time, volumes: newVolumes, isLast, durationAfter };
      } else {
         nextState.push({ id, time, volumes: newVolumes, isLast, durationAfter });
      }

      if (isLast) nextState = nextState.map(k => k.id === id ? { ...k, isLast: true } : { ...k, isLast: false, durationAfter: undefined });
      return nextState.sort((a,b) => a.time - b.time);
    });
  }, []);

  const removeKeyframe = useCallback((id: string) => setKeyframes(prev => prev.filter(e => e.id !== id)), []);
  const updateProjectConfig = useCallback((config: Partial<ProjectConfig>) => setProjectConfig(c => ({ ...c, ...config })), []);

  const exportMLayer = useCallback(async () => {
    if (tracks.length === 0) return;
    const zip = new JSZip();
    zip.file("meta.json", JSON.stringify({ name: projectConfig.name, author: projectConfig.author, themeColors: projectConfig.themeColors, keyframes }, null, 2));
    tracks.forEach(track => { if (track.file) zip.file(track.name, track.file); });
    if (projectConfig._bgFile) zip.file(`bg_${projectConfig._bgFile.name || 'bg.jpg'}`, projectConfig._bgFile);
    if (projectConfig._coverFile) zip.file(`cover_${projectConfig._coverFile.name || 'cover.jpg'}`, projectConfig._coverFile);
    const blob = await zip.generateAsync({ type: "blob" });
    saveAs(blob, `${projectConfig.name || 'MLayerProject'}.ml`);
  }, [projectConfig, keyframes, tracks]);

  useEffect(() => { return () => { if (audioCtx?.state !== 'closed') audioCtx?.close().catch(()=>{}).finally(()=>{ audioCtx = null; }); }; }, []);

  return { tracks, keyframes, projectConfig, isPlaying, isLooping, currentTime, duration, play, pause, stop, seek, setVolume, toggleMute, toggleLoop, addFiles, removeTrack, addOrUpdateKeyframe, removeKeyframe, updateProjectConfig, exportMLayer };
}
