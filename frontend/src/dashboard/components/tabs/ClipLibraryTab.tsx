import { useState, useEffect } from 'react';
import { Play, Pause, Download, Share2, Search } from 'lucide-react';

interface Clip {
  id: string;
  cameraCode: string;
  cameraName: string;
  type: string;
  timeLabel: string;
  recordedAt: string;
  durationLabel: string;
  durationSeconds: number;
  zone: string;
  priority: 'High' | 'Medium' | 'Low';
  tagText: string;
  tagColor: string;
  boxStyle?: { top: string; left: string; width: string; height: string };
}

const mockClips: Clip[] = [
  {
    id: 'CL-8841',
    cameraCode: 'C-01',
    cameraName: 'Main Entrance',
    type: 'Tailgating detected',
    timeLabel: 'Today 14:32:01',
    recordedAt: 'Today · 14:32:01',
    durationLabel: '0:24',
    durationSeconds: 24,
    zone: 'Exterior',
    priority: 'High',
    tagText: '2 persons',
    tagColor: 'var(--color-danger)',
    boxStyle: { top: '35%', left: '35%', width: '30%', height: '50%' },
  },
  {
    id: 'CL-8842',
    cameraCode: 'C-31',
    cameraName: 'Perimeter Gate',
    type: 'Line crossing',
    timeLabel: 'Today 14:28:44',
    recordedAt: 'Today · 14:28:44',
    durationLabel: '0:18',
    durationSeconds: 18,
    zone: 'Exterior',
    priority: 'High',
    tagText: 'Person',
    tagColor: 'var(--color-danger)',
    boxStyle: { top: '25%', left: '40%', width: '25%', height: '60%' },
  },
  {
    id: 'CL-8843',
    cameraCode: 'C-07',
    cameraName: 'Loading Dock',
    type: 'Person loitering',
    timeLabel: 'Today 14:21:10',
    recordedAt: 'Today · 14:21:10',
    durationLabel: '4:12',
    durationSeconds: 252,
    zone: 'Exterior',
    priority: 'Medium',
    tagText: 'Dwell 4m',
    tagColor: 'var(--color-warning)',
    boxStyle: { top: '30%', left: '45%', width: '20%', height: '50%' },
  },
  {
    id: 'CL-8844',
    cameraCode: 'C-04',
    cameraName: 'Lobby',
    type: 'Unattended object',
    timeLabel: 'Today 14:14:33',
    recordedAt: 'Today · 14:14:33',
    durationLabel: '6:02',
    durationSeconds: 362,
    zone: 'Interior',
    priority: 'Medium',
    tagText: 'Bag',
    tagColor: 'var(--color-warning)',
    boxStyle: { top: '60%', left: '30%', width: '25%', height: '25%' },
  },
  {
    id: 'CL-8845',
    cameraCode: 'C-18',
    cameraName: 'Server Room',
    type: 'Motion after hours',
    timeLabel: 'Today 14:08:02',
    recordedAt: 'Today · 14:08:02',
    durationLabel: '0:40',
    durationSeconds: 40,
    zone: 'Restricted',
    priority: 'High',
    tagText: 'Motion',
    tagColor: 'var(--color-secondary)',
    boxStyle: { top: '40%', left: '35%', width: '35%', height: '35%' },
  },
  {
    id: 'CL-8846',
    cameraCode: 'C-24',
    cameraName: 'Cafeteria',
    type: 'Crowd forming',
    timeLabel: 'Today 13:56:47',
    recordedAt: 'Today · 13:56:47',
    durationLabel: '2:30',
    durationSeconds: 150,
    zone: 'Interior',
    priority: 'Medium',
    tagText: '8 persons',
    tagColor: 'var(--color-warning)',
  },
  {
    id: 'CL-8847',
    cameraCode: 'C-15',
    cameraName: 'East Corridor',
    type: 'Subject 4471 transit',
    timeLabel: 'Jun 20 18:05:09',
    recordedAt: 'Jun 20 · 18:05:09',
    durationLabel: '0:12',
    durationSeconds: 12,
    zone: 'Restricted',
    priority: 'Low',
    tagText: 'ID 4471',
    tagColor: 'var(--color-danger)',
    boxStyle: { top: '45%', left: '40%', width: '20%', height: '35%' },
  },
  {
    id: 'CL-8848',
    cameraCode: 'C-09',
    cameraName: 'Parking West',
    type: 'Camera obstructed',
    timeLabel: 'Jun 20 13:41:19',
    recordedAt: 'Jun 20 · 13:41:19',
    durationLabel: '0:40',
    durationSeconds: 40,
    zone: 'Exterior',
    priority: 'Low',
    tagText: 'Obstructed',
    tagColor: 'var(--color-secondary)',
  },
  {
    id: 'CL-8849',
    cameraCode: 'C-27',
    cameraName: 'Stairwell B',
    type: 'Fall detected',
    timeLabel: 'Jun 20 13:30:55',
    recordedAt: 'Jun 20 · 13:30:55',
    durationLabel: '0:22',
    durationSeconds: 22,
    zone: 'Restricted',
    priority: 'High',
    tagText: 'Person down',
    tagColor: 'var(--color-danger)',
    boxStyle: { top: '55%', left: '35%', width: '40%', height: '25%' },
  },
];

export function ClipLibraryTab() {
  const [selectedClip, setSelectedClip] = useState<Clip>(mockClips[0]);
  const [filterPriority, setFilterPriority] = useState<'All' | 'High' | 'Medium' | 'Low'>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [playProgress, setPlayProgress] = useState(9); // Default start time

  // Video scrubber timeline update simulation
  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    if (isPlaying) {
      timer = setInterval(() => {
        setPlayProgress((prev) => {
          if (prev >= selectedClip.durationSeconds) {
            setIsPlaying(false);
            return 0;
          }
          return prev + 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isPlaying, selectedClip.durationSeconds]);

  const [prevClipId, setPrevClipId] = useState(selectedClip.id);
  if (selectedClip.id !== prevClipId) {
    setPrevClipId(selectedClip.id);
    setIsPlaying(false);
    setPlayProgress(Math.min(9, selectedClip.durationSeconds));
  }

  const filteredClips = mockClips.filter((clip) => {
    const matchesPriority = filterPriority === 'All' || clip.priority === filterPriority;
    const matchesSearch =
      clip.cameraName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      clip.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
      clip.cameraCode.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesPriority && matchesSearch;
  });

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 animate-[slideUp_0.3s_ease-out] w-full min-h-[calc(100vh-140px)]">
      {/* LEFT COLUMN: Clips Grid */}
      <div className="xl:col-span-9 flex flex-col gap-4">
        {/* Header & Filters */}
        <div className="flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-[1.25rem] font-bold tracking-tight">Clip library</h2>
              <p className="text-[0.8rem] text-text-muted mt-0.5">Recorded & flagged footage</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Priority filter tabs */}
            <div className="flex gap-1.5 bg-[rgba(255,255,255,0.02)] p-1 rounded-lg border border-border-glass">
              {(['All', 'High', 'Medium', 'Low'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setFilterPriority(p)}
                  className={`py-1.5 px-3 rounded-md text-[0.78rem] font-semibold transition-all duration-200 border-none outline-none cursor-pointer ${
                    (p === 'All' && filterPriority === 'All') || filterPriority === p
                      ? 'bg-[rgba(255,255,255,0.08)] text-white shadow-sm'
                      : 'text-text-muted hover:text-text-secondary bg-transparent'
                  }`}
                >
                  {p === 'All' ? 'All clips' : p}
                </button>
              ))}
            </div>

            {/* Search Input */}
            <div className="relative w-full sm:w-[280px]">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-text-muted" />
              <input
                type="text"
                placeholder="Search clips..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-1.5 text-[0.85rem] bg-[rgba(15,23,42,0.4)] border border-border-glass rounded-lg text-text-primary focus:border-[var(--color-primary)] outline-none"
              />
            </div>
          </div>

          <div className="text-[0.75rem] text-text-muted select-none">
            {filteredClips.length} clip{filteredClips.length === 1 ? '' : 's'} · sorted newest first
          </div>
        </div>

        {/* Clip cards grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 flex-1">
          {filteredClips.map((clip) => {
            const isSelected = selectedClip.id === clip.id;
            return (
              <div
                key={clip.id}
                onClick={() => setSelectedClip(clip)}
                className={`glass-panel overflow-hidden relative group flex flex-col cursor-pointer transition-all duration-300 ${
                  isSelected
                    ? 'border-[var(--color-primary-glow)] bg-[rgba(124,58,237,0.03)] active border-primary/50 shadow-[0_0_12px_rgba(124,58,237,0.15)] scale-[1.005]'
                    : 'border-border-glass bg-[rgba(255,255,255,0.015)]'
                }`}
              >
                {/* Image Cover/Gradient Simulation */}
                <div
                  className="flex-1 relative bg-gradient-to-br from-[#131924] to-[#0a0d14] w-full overflow-hidden select-none"
                  style={{ aspectRatio: '16/9' }}
                >
                  {/* Bounding box simulation inside card */}
                  {clip.boxStyle && (
                    <div
                      className="absolute border-2 rounded border-[var(--color-danger)] pointer-events-none"
                      style={{
                        ...clip.boxStyle,
                        borderColor: clip.tagColor,
                        boxShadow: `0 0 8px ${clip.tagColor}30`,
                      }}
                    />
                  )}

                  {/* Top-left camera code badge */}
                  <div className="absolute top-2.5 left-2.5 text-[0.65rem] font-bold text-text-secondary bg-[rgba(9,13,22,0.7)] px-2 py-0.5 rounded border border-[rgba(255,255,255,0.04)] font-mono">
                    {clip.cameraCode}
                  </div>

                  {/* Top-right REC badge */}
                  <div className="absolute top-2.5 right-2.5 flex items-center gap-1 bg-[rgba(9,13,22,0.7)] px-2 py-0.5 rounded border border-[rgba(255,255,255,0.04)]">
                    <span className="w-1 h-1 rounded-full bg-[var(--color-danger)] inline-block animate-[pulse-danger_1.2s_infinite]" />
                    <span className="text-[0.55rem] font-extrabold tracking-wider text-white">REC</span>
                  </div>

                  {/* Bounding box tag indicator */}
                  <div
                    className="absolute px-1.5 py-0.5 rounded text-[0.58rem] font-bold text-white uppercase tracking-wider select-none pointer-events-none"
                    style={{
                      backgroundColor: clip.tagColor,
                      top: clip.boxStyle ? `calc(${clip.boxStyle.top} - 1.25rem)` : '40%',
                      left: clip.boxStyle ? clip.boxStyle.left : '40%',
                    }}
                  >
                    {clip.tagText}
                  </div>

                  {/* Duration label overlay */}
                  <div className="absolute bottom-2.5 right-2.5 text-[0.62rem] font-semibold text-text-primary bg-[rgba(9,13,22,0.75)] px-1.5 py-0.5 rounded border border-[rgba(255,255,255,0.05)]">
                    {clip.durationLabel}
                  </div>

                  {/* Overlay play button */}
                  <div className="absolute inset-0 bg-[rgba(9,13,22,0.3)] opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center pointer-events-none">
                    <div className="bg-[rgba(255,255,255,0.06)] backdrop-blur p-2.5 rounded-full border border-[rgba(255,255,255,0.1)]">
                      <Play className="text-white w-4.5 h-4.5 fill-white" />
                    </div>
                  </div>
                </div>

                {/* Info summary */}
                <div className="p-3 border-t border-[rgba(255,255,255,0.03)] bg-[rgba(9,13,22,0.25)] flex flex-col gap-1 shrink-0 text-left">
                  <div className="flex justify-between items-center gap-2">
                    <h3 className="text-[0.78rem] font-bold text-text-primary truncate">
                      {clip.type}
                    </h3>
                  </div>
                  <div className="flex justify-between items-center text-[0.65rem] text-text-muted font-mono leading-none">
                    <span className="font-semibold">{clip.cameraName}</span>
                    <span>{clip.timeLabel}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* RIGHT COLUMN: Playback / Detail panel */}
      <div className="xl:col-span-3 flex flex-col gap-4">
        {/* Playback Container */}
        <div className="glass-panel p-4 rounded-2xl flex flex-col gap-4 flex-1">
          {/* Mock Video Player */}
          <div className="relative w-full rounded-xl overflow-hidden bg-gradient-to-br from-[#0c121e] to-[#04060b] select-none border border-border-glass flex flex-col" style={{ aspectRatio: '4/3' }}>
            <div className="flex-1 relative flex items-center justify-center">
              {/* Simulated scanlines & grids */}
              <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:16px_16px] pointer-events-none" />
              <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.2)_50%)] bg-[size:100%_4px] pointer-events-none opacity-20" />

              {/* Bounding box simulation in player */}
              {selectedClip.boxStyle && (
                <div
                  className="absolute border-2 rounded pointer-events-none border-[var(--color-danger)] animate-pulse"
                  style={{
                    ...selectedClip.boxStyle,
                    borderColor: selectedClip.tagColor,
                    boxShadow: `0 0 16px ${selectedClip.tagColor}50`,
                  }}
                />
              )}

              {/* Floating label tag */}
              <div
                className="absolute px-2 py-0.5 rounded text-[0.65rem] font-bold text-white uppercase tracking-wider select-none pointer-events-none animate-bounce"
                style={{
                  backgroundColor: selectedClip.tagColor,
                  top: selectedClip.boxStyle ? `calc(${selectedClip.boxStyle.top} - 1.5rem)` : '45%',
                  left: selectedClip.boxStyle ? selectedClip.boxStyle.left : '40%',
                }}
              >
                {selectedClip.tagText}
              </div>

              {/* Big central Play button overlay */}
              {!isPlaying && (
                <button
                  onClick={() => setIsPlaying(true)}
                  className="w-14 h-14 rounded-full bg-[rgba(255,255,255,0.08)] backdrop-blur border border-border-glass hover:bg-[rgba(255,255,255,0.15)] flex items-center justify-center transition-all duration-300 cursor-pointer shadow-lg active:scale-95"
                >
                  <Play className="text-white fill-white w-6 h-6 ml-0.5" />
                </button>
              )}
            </div>

            {/* Video Control Bar */}
            <div className="h-12 bg-[rgba(9,13,22,0.85)] border-t border-[rgba(255,255,255,0.05)] px-3 flex items-center gap-3 select-none">
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className="text-text-primary hover:text-white bg-transparent border-none outline-none cursor-pointer flex items-center justify-center"
              >
                {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
              </button>

              {/* Play progress timeline slider */}
              <div className="flex-1 relative flex items-center">
                <input
                  type="range"
                  min="0"
                  max={selectedClip.durationSeconds}
                  value={playProgress}
                  onChange={(e) => setPlayProgress(Number(e.target.value))}
                  className="w-full h-1 bg-[rgba(255,255,255,0.15)] rounded-lg appearance-none cursor-pointer accent-[var(--color-secondary)] outline-none"
                />
              </div>

              {/* Time tracker */}
              <span className="text-[0.65rem] text-text-muted font-mono whitespace-nowrap">
                {formatSeconds(playProgress)} / {selectedClip.durationLabel}
              </span>
            </div>
          </div>

          {/* Details & Action List */}
          <div className="flex flex-col gap-3">
            {/* Priority tag */}
            <div className="flex justify-between items-center">
              <span className="text-[0.62rem] font-bold tracking-widest uppercase text-white bg-[rgba(244,63,94,0.15)] border border-[rgba(244,63,94,0.35)] px-2 py-0.5 rounded-full select-none">
                {selectedClip.priority} priority
              </span>
              <span className="text-[0.68rem] text-text-muted font-mono font-bold select-all">
                {selectedClip.id}
              </span>
            </div>

            {/* Title */}
            <h3 className="text-[1.1rem] font-bold text-text-primary leading-tight">
              {selectedClip.type}
            </h3>

            {/* Metadata Table */}
            <div className="border border-border-glass rounded-xl overflow-hidden bg-[rgba(0,0,0,0.15)]">
              <table className="w-full text-[0.78rem] text-left border-collapse">
                <tbody>
                  <tr className="border-b border-border-glass">
                    <td className="p-3 text-text-muted font-semibold w-1/3">Camera</td>
                    <td className="p-3 text-text-secondary font-mono font-semibold">
                      {selectedClip.cameraCode} · {selectedClip.cameraName}
                    </td>
                  </tr>
                  <tr className="border-b border-border-glass">
                    <td className="p-3 text-text-muted font-semibold">Recorded</td>
                    <td className="p-3 text-text-secondary font-semibold">
                      {selectedClip.recordedAt}
                    </td>
                  </tr>
                  <tr className="border-b border-border-glass">
                    <td className="p-3 text-text-muted font-semibold">Duration</td>
                    <td className="p-3 text-text-secondary font-semibold">
                      {selectedClip.durationLabel}
                    </td>
                  </tr>
                  <tr>
                    <td className="p-3 text-text-muted font-semibold">Zone</td>
                    <td className="p-3 text-text-secondary font-semibold">
                      {selectedClip.zone}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* CTA Buttons */}
            <button
              onClick={() => setIsPlaying(true)}
              className="btn btn-primary w-full py-2.5 text-[0.88rem] flex items-center justify-center gap-2 cursor-pointer font-bold shadow-[0_4px_16px_rgba(6,182,212,0.25)] hover:shadow-[0_6px_22px_rgba(6,182,212,0.4)]"
              style={{ background: 'linear-gradient(135deg, var(--color-secondary) 0%, #0891b2 100%)' }}
            >
              <Play size={14} fill="currentColor" /> Play clip
            </button>

            <div className="grid grid-cols-2 gap-2">
              <button className="btn btn-secondary py-2 text-[0.78rem] font-bold flex items-center justify-center gap-1.5 cursor-pointer">
                <Download size={13} /> Download
              </button>
              <button className="btn btn-secondary py-2 text-[0.78rem] font-bold flex items-center justify-center gap-1.5 cursor-pointer">
                <Share2 size={13} /> Share link
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
