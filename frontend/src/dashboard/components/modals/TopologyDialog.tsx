import { useEffect, useState } from 'react';
import { Network, Pencil, Plus, Trash2, X } from 'lucide-react';
import { apiFetch } from '../../../api';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../components/ui/dialog';
import type { CameraStream, ReidRoute } from '../../types';

const EMPTY_ROUTE: ReidRoute = {
  fromCamera: '',
  toCamera: '',
  minTimeSeconds: 5,
  maxTimeSeconds: 60,
  topologyScore: 1.0,
};

export interface TopologyDialogProps {
  open: boolean;
  onClose: () => void;
  streams: CameraStream[];
  routes: ReidRoute[];
  onSaved: () => void;
}

function formatRouteSummary(route: ReidRoute): string {
  const scorePct = Math.round(route.topologyScore * 100);
  return `${route.fromCamera} → ${route.toCamera} · ${route.minTimeSeconds}s–${route.maxTimeSeconds}s · score ${scorePct}%`;
}

export function TopologyDialog({
  open,
  onClose,
  streams,
  routes,
  onSaved,
}: TopologyDialogProps) {
  const [draft, setDraft] = useState<ReidRoute>(EMPTY_ROUTE);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(EMPTY_ROUTE);
      setEditingId(null);
    }
  }, [open]);

  const resetForm = () => {
    setDraft(EMPTY_ROUTE);
    setEditingId(null);
  };

  const startEdit = (route: ReidRoute) => {
    if (!route.id) return;
    setEditingId(route.id);
    setDraft({
      id: route.id,
      fromCamera: route.fromCamera,
      toCamera: route.toCamera,
      fromStreamId: route.fromStreamId,
      toStreamId: route.toStreamId,
      minTimeSeconds: route.minTimeSeconds,
      maxTimeSeconds: route.maxTimeSeconds,
      topologyScore: route.topologyScore,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.fromCamera || !draft.toCamera) {
      alert('Select both source and target cameras.');
      return;
    }
    if (draft.fromCamera === draft.toCamera) {
      alert('Source and target cameras must be different.');
      return;
    }
    if (draft.minTimeSeconds < 0 || draft.maxTimeSeconds < 0) {
      alert('Time values must be zero or greater.');
      return;
    }
    if (draft.minTimeSeconds > draft.maxTimeSeconds) {
      alert('Minimum time cannot exceed maximum time.');
      return;
    }
    if (draft.topologyScore < 0 || draft.topologyScore > 1) {
      alert('Score must be between 0% and 100%.');
      return;
    }

    const fromStream = streams.find((s) => s.name === draft.fromCamera);
    const toStream = streams.find((s) => s.name === draft.toCamera);
    const payload = {
      fromCamera: draft.fromCamera,
      toCamera: draft.toCamera,
      fromStreamId: fromStream?.streamId,
      toStreamId: toStream?.streamId,
      minTimeSeconds: draft.minTimeSeconds,
      maxTimeSeconds: draft.maxTimeSeconds,
      topologyScore: draft.topologyScore,
    };

    setSaving(true);
    try {
      const res = editingId
        ? await apiFetch(`/reid/topology/${editingId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await apiFetch('/reid/topology', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Failed to save topology route');
        return;
      }

      onSaved();
      resetForm();
    } catch (err) {
      console.error('Failed to save topology route', err);
      alert('Failed to save topology route');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (route: ReidRoute) => {
    if (!route.id) return;
    if (!confirm(`Delete topology route ${route.fromCamera} → ${route.toCamera}?`)) {
      return;
    }

    setDeletingId(route.id);
    try {
      const res = await apiFetch(`/reid/topology/${route.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Failed to delete topology route');
        return;
      }
      if (editingId === route.id) {
        resetForm();
      }
      onSaved();
    } catch (err) {
      console.error('Failed to delete topology route', err);
      alert('Failed to delete topology route');
    } finally {
      setDeletingId(null);
    }
  };

  const scorePercent = Math.round(draft.topologyScore * 100);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}
    >
      <DialogContent className="max-w-[640px] p-6 flex flex-col gap-5 max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="bg-[rgba(6,182,212,0.12)] p-2 rounded-lg">
              <Network size={18} color="var(--color-secondary)" />
            </div>
            <div>
              <DialogTitle>Camera Topology</DialogTitle>
              <DialogDescription className="mt-1">
                Define how likely someone is to move between cameras within a time window.
              </DialogDescription>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn p-1.5 bg-transparent text-text-muted hover:text-text-primary border-none rounded-lg hover:bg-[rgba(255,255,255,0.06)]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="h-px bg-[rgba(255,255,255,0.07)] shrink-0" />

        <div className="flex flex-col gap-5 min-h-0 overflow-y-auto pr-1">
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[0.75rem] font-bold text-text-secondary uppercase tracking-wider">
                Existing routes
              </h3>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="btn btn-secondary py-1 px-2 text-[0.7rem] rounded-md border-none"
                >
                  <Plus size={12} /> New route
                </button>
              )}
            </div>

            {routes.length === 0 ? (
              <p className="text-[0.8rem] text-text-muted py-3 text-center border border-dashed border-border-glass rounded-lg">
                No topology routes yet. Add one below.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {routes.map((route) => (
                  <div
                    key={route.id ?? `${route.fromCamera}-${route.toCamera}`}
                    className={`flex items-center gap-2 p-3 rounded-lg border ${
                      editingId === route.id
                        ? 'border-secondary/40 bg-[rgba(6,182,212,0.08)]'
                        : 'border-border-glass bg-[rgba(255,255,255,0.02)]'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-[0.8rem] font-semibold text-text-primary truncate">
                        {route.fromCamera} → {route.toCamera}
                      </p>
                      <p className="text-[0.72rem] text-text-muted mt-0.5">
                        {route.minTimeSeconds}s–{route.maxTimeSeconds}s · score {Math.round(route.topologyScore * 100)}%
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => startEdit(route)}
                      className="btn btn-secondary p-1.5 rounded-md border-none shrink-0"
                      title="Edit route"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => { void handleDelete(route); }}
                      disabled={deletingId === route.id}
                      className="btn btn-secondary p-1.5 rounded-md border-none shrink-0 hover:text-danger"
                      title="Delete route"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="flex flex-col gap-3 border-t border-border-glass pt-5">
            <h3 className="text-[0.75rem] font-bold text-text-secondary uppercase tracking-wider">
              {editingId ? 'Edit route' : 'Add route'}
            </h3>

            <form onSubmit={(e) => { void handleSubmit(e); }} className="flex flex-col gap-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[0.78rem] text-text-secondary font-medium">From camera</label>
                  <select
                    value={draft.fromCamera}
                    onChange={(e) => setDraft({ ...draft, fromCamera: e.target.value })}
                    required
                    className="text-[0.8rem] py-1.5 px-2 rounded-md bg-[rgba(0,0,0,0.3)] border border-border-glass text-text-primary"
                  >
                    <option value="">Source camera</option>
                    {streams.map((s) => (
                      <option key={s.streamId} value={s.name}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[0.78rem] text-text-secondary font-medium">To camera</label>
                  <select
                    value={draft.toCamera}
                    onChange={(e) => setDraft({ ...draft, toCamera: e.target.value })}
                    required
                    className="text-[0.8rem] py-1.5 px-2 rounded-md bg-[rgba(0,0,0,0.3)] border border-border-glass text-text-primary"
                  >
                    <option value="">Target camera</option>
                    {streams.map((s) => (
                      <option key={s.streamId} value={s.name}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[0.78rem] text-text-secondary font-medium">Min time (s)</label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={draft.minTimeSeconds}
                    onChange={(e) => setDraft({ ...draft, minTimeSeconds: Number(e.target.value) })}
                    required
                    className="text-[0.8rem] py-1.5 px-2 rounded-md bg-[rgba(0,0,0,0.3)] border border-border-glass text-text-primary"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[0.78rem] text-text-secondary font-medium">Max time (s)</label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={draft.maxTimeSeconds}
                    onChange={(e) => setDraft({ ...draft, maxTimeSeconds: Number(e.target.value) })}
                    required
                    className="text-[0.8rem] py-1.5 px-2 rounded-md bg-[rgba(0,0,0,0.3)] border border-border-glass text-text-primary"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[0.78rem] text-text-secondary font-medium">Match score (%)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={scorePercent}
                    onChange={(e) => {
                      const pct = Number(e.target.value);
                      setDraft({ ...draft, topologyScore: Math.min(1, Math.max(0, pct / 100)) });
                    }}
                    required
                    className="text-[0.8rem] py-1.5 px-2 rounded-md bg-[rgba(0,0,0,0.3)] border border-border-glass text-text-primary"
                  />
                </div>
              </div>

              <p className="text-[0.72rem] text-text-muted">
                {formatRouteSummary(draft)}. Higher scores boost matches when someone appears on the target camera within this time window.
              </p>

              <div className="flex items-center justify-end gap-2 pt-1">
                {editingId && (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="btn btn-secondary py-1.5 px-3 text-[0.75rem] rounded-md"
                  >
                    Cancel edit
                  </button>
                )}
                <button
                  type="submit"
                  disabled={saving}
                  className="btn btn-primary py-1.5 px-3 text-[0.75rem] rounded-md"
                >
                  {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add route'}
                </button>
              </div>
            </form>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
