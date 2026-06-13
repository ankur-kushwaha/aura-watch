import {
  ArrowLeft,
  Clock,
  Network,
  Play,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  UserCircle,
  Users,
} from 'lucide-react';
import { REID_CROP_IMG } from '../../constants';
import type { ReidTabState } from '../../hooks/useReidTab';
import { identityCoverUrl, mediaUrl } from '../../utils';
import { EntityIds } from '../IdsInfoIcon';
import { TimelineClipPlaybackDialog } from '../modals';

export interface ReidTabProps {
  reid: ReidTabState;
  view: 'people' | 'person';
}

export function ReidTab({ reid, view }: ReidTabProps) {
  const {
    streams,
    hasOnlineDevices,
    reidPeople,
    loadingReidPeople,
    brokenIdentityCovers,
    setBrokenIdentityCovers,
    deletingIdentityId,
    selectedPerson,
    personTimeline,
    personSuggestions,
    loadingPersonDetail,
    linkPeopleMode,
    setLinkPeopleMode,
    linkPeopleSelection,
    setLinkPeopleSelection,
    identityLabelDraft,
    setIdentityLabelDraft,
    savingIdentityLabel,
    feedbackPending,
    showTopology,
    setShowTopology,
    timelineVideo,
    setTimelineVideo,
    timelineClipLoading,
    showIdentitySuggestions,
    setShowIdentitySuggestions,
    topologyRoutes,
    newRoute,
    setNewRoute,
    fetchReidPeople,
    openPersonDetail,
    closePersonDetail,
    playTimelineCrop,
    handleSavePersonLabel,
    handleStreamTrackFeedback,
    handleLinkPeopleSelection,
    handleDeleteIdentity,
    handleLinkPeople,
    handleAddTopology,
  } = reid;

  if (view === 'people') {
    return (
      <>
            <div className="flex flex-col gap-6 h-[984px]">
              <div className="glass-panel p-5 flex flex-col flex-1 min-h-0">
                <div className="flex justify-between items-center mb-5">
                  <h2 className="text-[1.1rem] flex items-center gap-2">
                    <UserCircle size={20} color="var(--color-primary)" /> People
                  </h2>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setLinkPeopleMode(!linkPeopleMode);
                        setLinkPeopleSelection([]);
                      }}
                      className={`btn py-1 px-2 text-[0.75rem] rounded-md ${linkPeopleMode ? 'btn-primary' : 'btn-secondary'}`}
                    >
                      <Users size={12} /> {linkPeopleMode ? 'Cancel' : 'Link People'}
                    </button>
                    {linkPeopleMode && linkPeopleSelection.length === 2 && (
                      <button onClick={handleLinkPeople} className="btn btn-primary py-1 px-2 text-[0.75rem] rounded-md">
                        Merge 2 people
                      </button>
                    )}
                    <button
                      onClick={() => setShowTopology(!showTopology)}
                      className="btn btn-secondary py-1 px-2 text-[0.75rem] rounded-md"
                    >
                      <Network size={12} /> Topology
                    </button>
                    <button
                      onClick={fetchReidPeople}
                      className="btn btn-secondary py-1 px-2 text-[0.75rem] rounded-md"
                      disabled={loadingReidPeople}
                    >
                      <RefreshCw size={12} className={loadingReidPeople ? 'animate-spin' : ''} /> Refresh
                    </button>
                  </div>
                </div>

                {linkPeopleMode && (
                  <p className="text-[0.75rem] text-text-muted mb-4">
                    Select 2 people that are the same person.
                    {linkPeopleSelection.length > 0 && (
                      <span className="text-secondary font-semibold ml-1">{linkPeopleSelection.length} selected</span>
                    )}
                  </p>
                )}

                <div className="flex-1 overflow-y-auto pr-1">
                  {loadingReidPeople && reidPeople.length === 0 ? (
                    <div className="h-full flex flex-col justify-center items-center text-text-muted">
                      <RefreshCw size={24} className="animate-spin mb-2" />
                      <span>Loading people...</span>
                    </div>
                  ) : reidPeople.length === 0 ? (
                    <div className="h-full flex flex-col justify-center items-center text-text-muted text-[0.85rem] py-12">
                      <UserCircle size={40} className="mb-3 opacity-50" />
                      <span>{hasOnlineDevices ? 'No people detected yet.' : 'No online devices.'}</span>
                      <span className="text-[0.75rem] mt-1 text-center max-w-[280px]">
                        {hasOnlineDevices
                          ? 'Each camera track is auto-grouped. Crops appear here once a person is visible for >1s.'
                          : 'ReID detections are hidden while all edge devices are offline because video playback is unavailable.'}
                      </span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-6">
                      {reidPeople.map((person) => {
                        const isLinkSelected = linkPeopleSelection.includes(person.id);
                        const coverBroken = brokenIdentityCovers.has(person.id);

                        return (
                          <div
                            key={person.id}
                            className={`relative flex flex-col items-center gap-2 group ${isLinkSelected ? 'opacity-100' : ''}`}
                          >
                            {!linkPeopleMode && (
                              <button
                                type="button"
                                onClick={(e) => handleDeleteIdentity(person, e)}
                                disabled={deletingIdentityId === person.id}
                                title="Delete person"
                                className="absolute top-0 right-0 z-10 btn p-1 bg-[rgba(9,13,22,0.85)] text-text-muted hover:text-danger border border-[rgba(255,255,255,0.1)] rounded-full opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                              >
                                {deletingIdentityId === person.id
                                  ? <RefreshCw size={11} className="animate-spin" />
                                  : <Trash2 size={11} />}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => linkPeopleMode
                                ? handleLinkPeopleSelection(person.id)
                                : openPersonDetail(person)}
                              className="flex flex-col items-center gap-2 border-none bg-transparent p-0 cursor-pointer w-full"
                            >
                            <div className={`relative w-[88px] h-[88px] rounded-full overflow-hidden border-2 transition-all duration-200 ${
                              isLinkSelected
                                ? 'border-secondary shadow-[0_0_12px_rgba(6,182,212,0.5)]'
                                : 'border-[rgba(255,255,255,0.1)] group-hover:border-primary/50 group-hover:shadow-[0_0_12px_rgba(124,58,237,0.3)]'
                            }`}>
                              {coverBroken ? (
                                <div className="w-full h-full bg-[rgba(255,255,255,0.05)] flex items-center justify-center">
                                  <UserCircle size={32} className="text-text-muted" />
                                </div>
                              ) : (
                                <img
                                  src={identityCoverUrl(person.id)}
                                  alt=""
                                  onError={() => {
                                    setBrokenIdentityCovers((prev) => new Set(prev).add(person.id));
                                  }}
                                  className={`w-full h-full ${REID_CROP_IMG}`}
                                />
                              )}
                              {person.photoCount > 1 && (
                                <div className="absolute bottom-0 inset-x-0 bg-black/60 text-[0.6rem] text-white text-center py-0.5">
                                  {person.photoCount}
                                </div>
                              )}
                            </div>
                            <span className="text-[0.72rem] font-semibold text-text-primary text-center max-w-[100px] truncate leading-tight">
                              {person.displayName}
                            </span>
                            {person.streamTracks.length > 1 ? (
                              <span className="text-[0.6rem] text-text-muted -mt-1">
                                {person.streamTracks.length} tracks
                              </span>
                            ) : person.streamTracks.length === 1 && person.label ? (
                              <span className="text-[0.6rem] text-text-muted -mt-1">
                                track {person.streamTracks[0].trackId}
                              </span>
                            ) : null}
                            <EntityIds
                              identityId={person.id}
                              detectionId={person.coverDetectionId}
                              clipId={person.coverClipId}
                              className="justify-center"
                            />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {showTopology && (
                <div className="glass-panel p-5 flex flex-col h-[320px] shrink-0">
                  <h2 className="text-[1rem] flex items-center gap-2 mb-3">
                    <Network size={16} color="var(--color-secondary)" /> Camera Topology
                  </h2>
                  <div className="flex flex-col md:flex-row gap-4 flex-1 min-h-0">
                    <form onSubmit={handleAddTopology} className="flex flex-col gap-2 md:w-[220px] shrink-0">
                      <select
                        value={newRoute.fromCamera}
                        onChange={(e) => setNewRoute({ ...newRoute, fromCamera: e.target.value })}
                        required
                        className="text-[0.75rem] py-1 px-2 rounded-md bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.08)] text-text-primary"
                      >
                        <option value="">Source camera</option>
                        {streams.map((s) => <option key={s.streamId} value={s.name}>{s.name}</option>)}
                      </select>
                      <select
                        value={newRoute.toCamera}
                        onChange={(e) => setNewRoute({ ...newRoute, toCamera: e.target.value })}
                        required
                        className="text-[0.75rem] py-1 px-2 rounded-md bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.08)] text-text-primary"
                      >
                        <option value="">Target camera</option>
                        {streams.map((s) => <option key={s.streamId} value={s.name}>{s.name}</option>)}
                      </select>
                      <button type="submit" className="btn btn-primary py-1 text-[0.75rem]">Save Link Rule</button>
                    </form>
                    <div className="flex-1 overflow-y-auto">
                      {topologyRoutes.map((r, rIdx) => (
                        <div key={rIdx} className="text-[0.75rem] py-1.5 border-b border-border-glass">
                          {r.fromCamera} ↔ {r.toCamera} ({r.minTimeSeconds}s–{r.maxTimeSeconds}s)
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

        <TimelineClipPlaybackDialog
          playback={timelineVideo}
          onClose={() => setTimelineVideo(null)}
        />
      </>
    );
  }

  if (view === 'person' && selectedPerson) {
    return (
      <>
            <div className="flex flex-col gap-5 h-[984px]">
              <div className="glass-panel p-5 flex flex-col flex-1 min-h-0">
                <div className="flex items-start gap-4 mb-5">
                  <button
                    type="button"
                    onClick={closePersonDetail}
                    className="btn btn-secondary p-2 rounded-lg shrink-0 border-none"
                  >
                    <ArrowLeft size={16} />
                  </button>
                  <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-primary/30 shrink-0">
                    {selectedPerson && !brokenIdentityCovers.has(selectedPerson.id) ? (
                      <img
                        src={identityCoverUrl(selectedPerson.id)}
                        alt=""
                        onError={() => {
                          if (selectedPerson) {
                            setBrokenIdentityCovers((prev) => new Set(prev).add(selectedPerson.id));
                          }
                        }}
                        className={`w-full h-full ${REID_CROP_IMG}`}
                      />
                    ) : (
                      <div className="w-full h-full bg-[rgba(255,255,255,0.05)] flex items-center justify-center">
                        <UserCircle size={36} className="text-text-muted" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-[1.2rem] font-bold text-text-primary truncate">
                      {selectedPerson?.displayName}
                    </h2>
                    <p className="text-[0.75rem] text-text-muted mt-0.5">
                      {selectedPerson?.photoCount} photo{selectedPerson?.photoCount !== 1 ? 's' : ''}
                      {selectedPerson?.streamTracks && selectedPerson.streamTracks.length > 0 && (
                        <span> · {selectedPerson.streamTracks.length} camera track{selectedPerson.streamTracks.length !== 1 ? 's' : ''}</span>
                      )}
                    </p>
                    {selectedPerson && (
                      <EntityIds
                        identityId={selectedPerson.id}
                        detectionId={selectedPerson.coverDetectionId}
                        clipId={selectedPerson.coverClipId}
                        className="mt-1.5"
                      />
                    )}
                    <div className="flex gap-2 mt-2 max-w-md">
                      <input
                        type="text"
                        value={identityLabelDraft}
                        onChange={(e) => setIdentityLabelDraft(e.target.value)}
                        placeholder="Name this person"
                        className="flex-1 text-[0.75rem] py-1.5 px-2 rounded-md bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.08)] text-text-primary"
                      />
                      <button
                        type="button"
                        onClick={handleSavePersonLabel}
                        disabled={savingIdentityLabel}
                        className="btn btn-secondary py-1 px-3 text-[0.7rem] shrink-0"
                      >
                        {savingIdentityLabel ? '…' : 'Save'}
                      </button>
                    </div>
                  </div>
                </div>

                {selectedPerson && selectedPerson.streamTracks.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-4">
                    {selectedPerson.streamTracks.map((st) => (
                      <span
                        key={`${st.streamId}-${st.trackId}`}
                        className="text-[0.65rem] bg-secondary/10 text-secondary px-2 py-1 rounded-full border border-secondary/20"
                      >
                        {st.cameraName} · track {st.trackId} ({st.cropCount})
                      </span>
                    ))}
                  </div>
                )}

                {personSuggestions.length > 0 && (
                  <div className="mb-5">
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <h3 className="text-[0.75rem] font-bold text-text-secondary uppercase tracking-wider">
                        Might be the same person
                      </h3>
                      {selectedPerson?.label?.trim() && !showIdentitySuggestions && (
                        <button
                          type="button"
                          onClick={() => setShowIdentitySuggestions(true)}
                          className="btn btn-secondary py-1 px-2 text-[0.7rem] rounded-md shrink-0"
                        >
                          Change selection
                        </button>
                      )}
                      {selectedPerson?.label?.trim() && showIdentitySuggestions && (
                        <button
                          type="button"
                          onClick={() => setShowIdentitySuggestions(false)}
                          className="btn btn-secondary py-1 px-2 text-[0.7rem] rounded-md shrink-0"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                    {(!selectedPerson?.label?.trim() || showIdentitySuggestions) && (
                    <div className="flex gap-4 overflow-x-auto pb-2">
                      {personSuggestions.map((suggestion) => {
                        const srcTrack = selectedPerson?.streamTracks[0];
                        const tgtTrack = suggestion.streamTracks[0];
                        if (!srcTrack || !tgtTrack) return null;
                        const sameKey = `same_person:${srcTrack.streamId}:${srcTrack.trackId}:${tgtTrack.streamId}:${tgtTrack.trackId}`;
                        const diffKey = `different_person:${srcTrack.streamId}:${srcTrack.trackId}:${tgtTrack.streamId}:${tgtTrack.trackId}`;

                        return (
                          <div key={suggestion.id} className="glass-panel p-3 rounded-xl shrink-0 w-[160px] flex flex-col items-center gap-2">
                            <div className="w-14 h-14 rounded-full overflow-hidden border border-border-glass">
                              {brokenIdentityCovers.has(suggestion.id) ? (
                                <div className="w-full h-full bg-[rgba(255,255,255,0.05)] flex items-center justify-center">
                                  <UserCircle size={24} className="text-text-muted" />
                                </div>
                              ) : (
                                <img
                                  src={identityCoverUrl(suggestion.id)}
                                  alt=""
                                  onError={() => {
                                    setBrokenIdentityCovers((prev) => new Set(prev).add(suggestion.id));
                                  }}
                                  className={`w-full h-full ${REID_CROP_IMG}`}
                                />
                              )}
                            </div>
                            <span className="text-[0.7rem] font-semibold text-center truncate w-full">{suggestion.displayName}</span>
                            <span className="text-[0.6rem] text-secondary">{Math.round(suggestion.matchScore * 100)}% match</span>
                            <div className="flex gap-1 w-full">
                              <button
                                type="button"
                                disabled={!!feedbackPending}
                                onClick={() => handleStreamTrackFeedback('same_person', srcTrack.streamId, srcTrack.trackId, tgtTrack.streamId, tgtTrack.trackId)}
                                className="btn btn-secondary flex-1 py-0.5 text-[0.6rem] border-none hover:text-green-400"
                              >
                                <ThumbsUp size={10} className={feedbackPending === sameKey ? 'animate-pulse' : ''} />
                              </button>
                              <button
                                type="button"
                                disabled={!!feedbackPending}
                                onClick={() => handleStreamTrackFeedback('different_person', srcTrack.streamId, srcTrack.trackId, tgtTrack.streamId, tgtTrack.trackId)}
                                className="btn btn-secondary flex-1 py-0.5 text-[0.6rem] border-none hover:text-danger"
                              >
                                <ThumbsDown size={10} className={feedbackPending === diffKey ? 'animate-pulse' : ''} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    )}
                  </div>
                )}

                <h3 className="text-[0.75rem] font-bold text-text-secondary uppercase tracking-wider mb-3">
                  Timeline
                </h3>
                <div className="flex-1 overflow-y-auto pr-1">
                  {loadingPersonDetail ? (
                    <div className="flex justify-center py-12 text-text-muted">
                      <RefreshCw size={20} className="animate-spin" />
                    </div>
                  ) : personTimeline.length === 0 ? (
                    <p className="text-text-muted text-[0.8rem] text-center py-8">No photos in this group yet.</p>
                  ) : (
                    <div className="relative border-l-2 border-primary/25 ml-4 pl-6 flex flex-col gap-5">
                      {personTimeline.map((crop) => {
                        const isLoadingClip = timelineClipLoading === crop.id;
                        return (
                          <div key={crop.id} className="relative">
                            <div className="absolute -left-[27px] top-3 w-3 h-3 rounded-full bg-primary border-2 border-[#090d16]" />
                            <button
                              type="button"
                              onClick={() => playTimelineCrop(crop)}
                              disabled={isLoadingClip}
                              className="glass-panel p-3 flex gap-3 items-center rounded-xl w-full text-left transition-all duration-200 cursor-pointer hover:border-primary/40 hover:bg-[rgba(124,58,237,0.06)]"
                            >
                              <div className="relative w-12 h-12 shrink-0">
                                <img
                                  src={mediaUrl(`/crops/${crop.filename}`)}
                                  alt=""
                                  className={`w-12 h-12 rounded-lg ${REID_CROP_IMG}`}
                                />
                                <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40">
                                  {isLoadingClip ? (
                                    <RefreshCw size={14} className="text-white animate-spin" />
                                  ) : (
                                    <Play size={16} className="text-white" fill="white" />
                                  )}
                                </div>
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-[0.85rem] font-bold text-text-primary">{crop.cameraName}</div>
                                <div className="text-[0.7rem] text-text-muted flex items-center gap-2 flex-wrap">
                                  <Clock size={11} />
                                  {new Date(crop.timestamp).toLocaleString()}
                                  <span className="text-secondary">track {crop.trackId}</span>
                                  <span className="text-[#a78bfa]">tap to play clip</span>
                                </div>
                                <EntityIds
                                  identityId={crop.identityId || selectedPerson?.id || '—'}
                                  detectionId={crop.id}
                                  clipId={crop.clipId}
                                  className="mt-1"
                                />
                              </div>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

        <TimelineClipPlaybackDialog
          playback={timelineVideo}
          onClose={() => setTimelineVideo(null)}
        />
      </>
    );
  }

  return null;
}
