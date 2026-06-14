import {
  ArrowLeft,
  Fingerprint,
  Link2,
  Network,
  RefreshCw,
  SlidersHorizontal,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  UserCircle,
  Users,
} from 'lucide-react';
import { REID_CROP_IMG } from '../../constants';
import type { ReidTabState } from '../../hooks/useReidTab';
import { formatClipListDateTime, identityCoverUrl, mediaUrl } from '../../utils';
import { ReidGridAvatar } from '../CropThumbnail';
import { EntityIds, IdsInfoIcon } from '../IdsInfoIcon';
import { buildTimelineIdEntries } from '../idEntries';
import { ReidTimeline } from '../ReidTimeline';

export interface ReidTabProps {
  reid: ReidTabState;
  view: 'people' | 'person' | 'detection';
}

export function ReidTab({ reid, view }: ReidTabProps) {
  const {
    streams,
    hasOnlineDevices,
    reidPeople,
    reidDetections,
    reidDetectionsTotal,
    loadingReidPeople,
    loadingReidDetections,
    loadingMoreReidDetections,
    brokenIdentityCovers,
    setBrokenIdentityCovers,
    brokenDetectionCrops,
    setBrokenDetectionCrops,
    deletingIdentityId,
    selectedPerson,
    selectedDetection,
    personSuggestions,
    linkPeopleMode,
    setLinkPeopleMode,
    linkPeopleSelection,
    setLinkPeopleSelection,
    linkDetectionsMode,
    setLinkDetectionsMode,
    linkDetectionsSelection,
    setLinkDetectionsSelection,
    mergingDetections,
    identityLabelDraft,
    setIdentityLabelDraft,
    savingIdentityLabel,
    feedbackPending,
    showTopology,
    setShowTopology,
    showIdentitySuggestions,
    setShowIdentitySuggestions,
    topologyRoutes,
    newRoute,
    setNewRoute,
    detectionFilterStreamId,
    setDetectionFilterStreamId,
    detectionFilterCameraName,
    setDetectionFilterCameraName,
    detectionFilterStartTime,
    setDetectionFilterStartTime,
    detectionFilterEndTime,
    setDetectionFilterEndTime,
    showDetectionFilters,
    setShowDetectionFilters,
    detectionFilterCameras,
    detectionFilterStreams,
    hasActiveDetectionFilters,
    clearDetectionFilters,
    fetchReidPeople,
    fetchReidDetections,
    loadMoreReidDetections,
    openPersonDetail,
    openDetectionDetail,
    closePersonDetail,
    refreshPersonDetail,
    handleSavePersonLabel,
    handleStreamTrackFeedback,
    handleLinkPeopleSelection,
    handleLinkDetectionsSelection,
    handleDeleteIdentity,
    handleLinkPeople,
    handleLinkDetections,
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
                      onClick={() => {
                        void fetchReidPeople();
                        void fetchReidDetections();
                      }}
                      className="btn btn-secondary py-1 px-2 text-[0.75rem] rounded-md"
                      disabled={loadingReidPeople || loadingReidDetections}
                    >
                      <RefreshCw size={12} className={(loadingReidPeople || loadingReidDetections) ? 'animate-spin' : ''} /> Refresh
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

                <div className="flex flex-col flex-1 min-h-0 gap-5">
                  {/* Identities */}
                  <div className="shrink-0">
                    <h3 className="text-[0.75rem] font-bold text-text-secondary uppercase tracking-wider mb-3 flex items-center gap-1.5">
                      <UserCircle size={14} color="var(--color-primary)" /> Identities
                    </h3>
                    {loadingReidPeople && reidPeople.length === 0 ? (
                      <div className="flex flex-col justify-center items-center text-text-muted py-8">
                        <RefreshCw size={20} className="animate-spin mb-2" />
                        <span className="text-[0.8rem]">Loading identities...</span>
                      </div>
                    ) : reidPeople.length === 0 ? (
                      <div className="flex flex-col justify-center items-center text-text-muted text-[0.85rem] py-8">
                        <UserCircle size={32} className="mb-2 opacity-50" />
                        <span>{hasOnlineDevices ? 'No identities yet.' : 'No online devices.'}</span>
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
                              <ReidGridAvatar
                                src={identityCoverUrl(person.id)}
                                broken={coverBroken}
                                brokenFallback={
                                  <div className="w-full h-full bg-[rgba(255,255,255,0.05)] flex items-center justify-center">
                                    <UserCircle size={32} className="text-text-muted" />
                                  </div>
                                }
                                borderClassName={
                                  isLinkSelected
                                    ? 'border-secondary shadow-[0_0_12px_rgba(6,182,212,0.5)]'
                                    : 'border-[rgba(255,255,255,0.1)] group-hover:border-primary/50 group-hover:shadow-[0_0_12px_rgba(124,58,237,0.3)]'
                                }
                                onImageError={() => {
                                  setBrokenIdentityCovers((prev) => new Set(prev).add(person.id));
                                }}
                                overlay={person.photoCount > 1 ? (
                                  <div className="absolute bottom-0 inset-x-0 bg-black/60 text-[0.6rem] text-white text-center py-0.5">
                                    {person.photoCount}
                                  </div>
                                ) : undefined}
                              />
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

                  {/* Detections */}
                  <div className="flex flex-col flex-1 min-h-0 border-t border-border-glass pt-5">
                    <div className="flex items-center justify-between gap-2 mb-3 shrink-0">
                      <h3 className="text-[0.75rem] font-bold text-text-secondary uppercase tracking-wider flex items-center gap-1.5">
                        <Fingerprint size={14} color="var(--color-secondary)" /> Detections
                      </h3>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setLinkDetectionsMode(!linkDetectionsMode);
                            setLinkDetectionsSelection([]);
                          }}
                          className={`btn py-1 px-2 text-[0.75rem] rounded-md ${linkDetectionsMode ? 'btn-primary' : 'btn-secondary'}`}
                        >
                          <Link2 size={12} /> {linkDetectionsMode ? 'Cancel' : 'Link Same'}
                        </button>
                        {linkDetectionsMode && linkDetectionsSelection.length >= 2 && (
                          <button
                            type="button"
                            onClick={() => { void handleLinkDetections(); }}
                            disabled={mergingDetections}
                            className="btn btn-primary py-1 px-2 text-[0.75rem] rounded-md"
                          >
                            {mergingDetections ? 'Linking…' : `Merge ${linkDetectionsSelection.length}`}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setShowDetectionFilters(!showDetectionFilters)}
                          className={`btn btn-secondary py-1 px-2.5 text-[0.75rem] rounded-md flex items-center gap-1.5 transition-all duration-200 ${
                            showDetectionFilters || hasActiveDetectionFilters
                              ? 'border-secondary text-secondary bg-[rgba(6,182,212,0.08)]'
                              : ''
                          }`}
                        >
                          <SlidersHorizontal size={12} />
                          Filters
                          {hasActiveDetectionFilters && (
                            <span className="w-1.5 h-1.5 rounded-full bg-secondary inline-block" />
                          )}
                        </button>
                      </div>
                    </div>

                    {linkDetectionsMode && (
                      <p className="text-[0.75rem] text-text-muted mb-3 shrink-0">
                        Select 2 or more detections that are the same person or vehicle.
                        {linkDetectionsSelection.length > 0 && (
                          <span className="text-secondary font-semibold ml-1">
                            {linkDetectionsSelection.length} selected
                          </span>
                        )}
                      </p>
                    )}

                    {showDetectionFilters && (
                      <div className="glass-panel p-3.5 mb-3 bg-[rgba(255,255,255,0.01)] border-border-glass rounded-[10px] flex flex-col gap-3 shrink-0">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                          <div className="flex flex-col gap-1">
                            <label className="text-[0.7rem] text-text-secondary">Camera</label>
                            <select
                              value={detectionFilterCameraName}
                              onChange={(e) => {
                                setDetectionFilterCameraName(e.target.value);
                                setDetectionFilterStreamId('');
                              }}
                              className="filter-field rounded-md bg-[rgba(0,0,0,0.3)] border border-border-glass text-text-primary"
                            >
                              <option value="">All Cameras</option>
                              {detectionFilterCameras.map((name) => (
                                <option key={name} value={name}>{name}</option>
                              ))}
                            </select>
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[0.7rem] text-text-secondary">Stream</label>
                            <select
                              value={detectionFilterStreamId}
                              onChange={(e) => setDetectionFilterStreamId(e.target.value)}
                              className="filter-field rounded-md bg-[rgba(0,0,0,0.3)] border border-border-glass text-text-primary"
                            >
                              <option value="">All Streams</option>
                              {detectionFilterStreams.map((s) => (
                                <option key={s.streamId} value={s.streamId}>{s.name}</option>
                              ))}
                            </select>
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[0.7rem] text-text-secondary">From</label>
                            <input
                              type="datetime-local"
                              value={detectionFilterStartTime}
                              onChange={(e) => setDetectionFilterStartTime(e.target.value)}
                              className="filter-field rounded-md bg-[rgba(0,0,0,0.3)] border border-border-glass text-text-primary"
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[0.7rem] text-text-secondary">To</label>
                            <input
                              type="datetime-local"
                              value={detectionFilterEndTime}
                              onChange={(e) => setDetectionFilterEndTime(e.target.value)}
                              className="filter-field rounded-md bg-[rgba(0,0,0,0.3)] border border-border-glass text-text-primary"
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-end gap-2">
                          {hasActiveDetectionFilters && (
                            <button
                              type="button"
                              onClick={() => { void clearDetectionFilters(); }}
                              className="btn btn-secondary py-1 px-2 text-[0.7rem] rounded flex items-center gap-1 hover:text-danger hover:border-danger bg-transparent font-semibold border-none"
                            >
                              Clear Filters
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => { void fetchReidDetections(); }}
                            disabled={loadingReidDetections}
                            className="btn btn-secondary py-1 px-2.5 text-[0.75rem] rounded-md"
                          >
                            Apply Filters
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="flex-1 overflow-y-auto pr-1 min-h-0">
                      {loadingReidDetections && reidDetections.length === 0 ? (
                        <div className="flex flex-col justify-center items-center text-text-muted py-8">
                          <RefreshCw size={20} className="animate-spin mb-2" />
                          <span className="text-[0.8rem]">Loading detections...</span>
                        </div>
                      ) : reidDetections.length === 0 ? (
                        <div className="flex flex-col justify-center items-center text-text-muted text-[0.85rem] py-8">
                          <Fingerprint size={32} className="mb-2 opacity-50" />
                          <span>
                            {hasActiveDetectionFilters
                              ? 'No detections match the current filters.'
                              : hasOnlineDevices
                                ? 'No detections yet.'
                                : 'No online devices.'}
                          </span>
                          {!hasActiveDetectionFilters && (
                            <span className="text-[0.75rem] mt-1 text-center max-w-[280px]">
                              {hasOnlineDevices
                                ? 'Individual ReID crops appear here as people are detected on camera.'
                                : 'ReID detections are hidden while all edge devices are offline.'}
                            </span>
                          )}
                        </div>
                      ) : (
                        <>
                          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-6">
                            {reidDetections.map((detection) => {
                              const cropBroken = brokenDetectionCrops.has(detection.id);
                              const isLinkSelected = linkDetectionsSelection.includes(detection.id);

                              return (
                                <button
                                  key={detection.id}
                                  type="button"
                                  onClick={() => linkDetectionsMode
                                    ? handleLinkDetectionsSelection(detection.id)
                                    : openDetectionDetail(detection)}
                                  className="flex flex-col items-center gap-2 border-none bg-transparent p-0 cursor-pointer w-full group"
                                >
                                  <ReidGridAvatar
                                    src={mediaUrl(`/crops/${detection.filename}`)}
                                    broken={cropBroken}
                                    brokenFallback={
                                      <div className="w-full h-full bg-[rgba(255,255,255,0.05)] flex items-center justify-center">
                                        <UserCircle size={32} className="text-text-muted" />
                                      </div>
                                    }
                                    borderClassName={
                                      isLinkSelected
                                        ? 'border-secondary shadow-[0_0_12px_rgba(6,182,212,0.5)]'
                                        : 'border-[rgba(255,255,255,0.1)] group-hover:border-secondary/50 group-hover:shadow-[0_0_12px_rgba(6,182,212,0.3)] transition-all duration-200'
                                    }
                                    onImageError={() => {
                                      setBrokenDetectionCrops((prev) => new Set(prev).add(detection.id));
                                    }}
                                  />
                                  <span className="text-[0.72rem] font-semibold text-text-primary text-center max-w-[100px] truncate leading-tight">
                                    {detection.cameraName}
                                  </span>
                                  <span className="text-[0.6rem] text-text-muted -mt-1 truncate max-w-[100px] text-center">
                                    {formatClipListDateTime(detection.timestamp)}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                          {reidDetections.length < reidDetectionsTotal && (
                            <button
                              type="button"
                              onClick={() => { void loadMoreReidDetections(); }}
                              disabled={loadingMoreReidDetections}
                              className="btn btn-secondary w-full py-2 mt-4 text-[0.8rem] rounded-lg flex items-center justify-center gap-1.5"
                            >
                              <RefreshCw size={12} className={loadingMoreReidDetections ? 'animate-spin' : ''} />
                              {loadingMoreReidDetections
                                ? 'Loading…'
                                : `Load more (${reidDetections.length} of ${reidDetectionsTotal})`}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
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

      </>
    );
  }

  if (view === 'person' && selectedPerson) {
    return (
      <>
            <div className="flex flex-col gap-5">
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
                        const sameKey = `same:${srcTrack.streamId}:${srcTrack.trackId}:${tgtTrack.streamId}:${tgtTrack.trackId}`;
                        const diffKey = `different:${srcTrack.streamId}:${srcTrack.trackId}:${tgtTrack.streamId}:${tgtTrack.trackId}`;

                        return (
                          <div key={suggestion.id} className="glass-panel p-3 rounded-xl shrink-0 w-[160px] flex flex-col items-center gap-2">
                            <ReidGridAvatar
                              src={identityCoverUrl(suggestion.id)}
                              broken={brokenIdentityCovers.has(suggestion.id)}
                              sizeClassName="w-14 h-14"
                              borderClassName="border-border-glass"
                              brokenFallback={
                                <div className="w-full h-full bg-[rgba(255,255,255,0.05)] flex items-center justify-center">
                                  <UserCircle size={24} className="text-text-muted" />
                                </div>
                              }
                              onImageError={() => {
                                setBrokenIdentityCovers((prev) => new Set(prev).add(suggestion.id));
                              }}
                            />
                            <span className="text-[0.7rem] font-semibold text-center truncate w-full">{suggestion.displayName}</span>
                            <span className="text-[0.6rem] text-secondary">{Math.round(suggestion.matchScore * 100)}% match</span>
                            <div className="flex gap-1 w-full">
                              <button
                                type="button"
                                disabled={!!feedbackPending}
                                onClick={() => handleStreamTrackFeedback('same', srcTrack.streamId, srcTrack.trackId, tgtTrack.streamId, tgtTrack.trackId)}
                                className="btn btn-secondary flex-1 py-0.5 text-[0.6rem] border-none hover:text-green-400"
                              >
                                <ThumbsUp size={10} className={feedbackPending === sameKey ? 'animate-pulse' : ''} />
                              </button>
                              <button
                                type="button"
                                disabled={!!feedbackPending}
                                onClick={() => handleStreamTrackFeedback('different', srcTrack.streamId, srcTrack.trackId, tgtTrack.streamId, tgtTrack.trackId)}
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

                <div className="flex-1 overflow-y-auto pr-1">
                  <ReidTimeline
                    source={{
                      mode: 'identity',
                      identityId: selectedPerson.id,
                      coverDetectionId: selectedPerson.coverDetectionId,
                    }}
                    emptyMessage="No photos in this group yet."
                    onUpdated={async () => {
                      await refreshPersonDetail({ silent: true });
                      await fetchReidPeople({ silent: true });
                    }}
                  />
                </div>
              </div>
            </div>
      </>
    );
  }

  if (view === 'detection' && selectedDetection) {
    const identityLabel = selectedDetection.identity?.label?.trim();
    const displayName = identityLabel || `track ${selectedDetection.trackId}`;

    return (
      <>
            <div className="flex flex-col gap-5">
              <div className="glass-panel p-5 flex flex-col flex-1 min-h-0">
                <div className="flex items-start gap-4 mb-5">
                  <button
                    type="button"
                    onClick={closePersonDetail}
                    className="btn btn-secondary p-2 rounded-lg shrink-0 border-none"
                  >
                    <ArrowLeft size={16} />
                  </button>
                  <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-secondary/30 shrink-0">
                    {!brokenDetectionCrops.has(selectedDetection.id) ? (
                      <img
                        src={mediaUrl(`/crops/${selectedDetection.filename}`)}
                        alt=""
                        onError={() => {
                          setBrokenDetectionCrops((prev) => new Set(prev).add(selectedDetection.id));
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
                      {displayName}
                    </h2>
                    <p className="text-[0.75rem] text-text-muted mt-0.5">
                      {selectedDetection.cameraName} · track {selectedDetection.trackId}
                    </p>
                    <IdsInfoIcon
                      ids={buildTimelineIdEntries({
                        detectionId: selectedDetection.id,
                        clipId: selectedDetection.clipId,
                      })}
                      className="mt-1.5"
                    />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto pr-1">
                  <ReidTimeline
                    source={{ mode: 'detection', detectionId: selectedDetection.id }}
                    emptyMessage="No similar detections found yet."
                    onUpdated={async () => {
                      await fetchReidDetections({ silent: true });
                      await fetchReidPeople({ silent: true });
                    }}
                  />
                </div>
              </div>
            </div>
      </>
    );
  }

  return null;
}
