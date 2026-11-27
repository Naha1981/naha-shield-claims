import React from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  FileCheck2,
  FileUp,
  Lock,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  MAX_INGESTION_BYTES,
  normalizeAllowedMime,
  processEvidencePayload,
  sanitizeIngestionFilename,
  type IngestedAttachmentMeta,
  type IngestionCaptureMode,
  type ProcessedEvidenceDocument,
} from '../lib/engine/evidenceIngestion';
import type {
  EvidenceItemRecord,
  EvidenceTag,
  RoleId,
  VaultVerificationResult,
} from '../lib/engine/types';
import { apiFetch, shortHash } from '../utils/format';

interface EvidenceIngestionProps {
  activeRole: RoleId;
  tamperSimulated: boolean;
  defaultCaseRef: string;
  onIngested: () => Promise<void>;
}

interface StagedDocument {
  filename: string;
  mimeType: string;
  byteSize: number;
  base64Payload: string;
  binarySha256: string;
  captureMode: IngestionCaptureMode;
  previewImageUrl: string | null;
  imageDimensions: { width: number; height: number } | null;
  processed: ProcessedEvidenceDocument;
}

const EVIDENCE_TAGS: EvidenceTag[] = [
  'Verified Fact',
  'Documented Allegation',
  'Inference',
  'Hypothesis',
  'Unknown',
];

const POPIA_AUTHORITIES = [
  'Internal SIU Mandate — POPIA s11(1)(f)',
  'PPR Claims Assessment — Policyholder Consent',
  'FSCA / FIC Regulatory Preservation',
];

const ACCEPTED_FILE_EXTENSIONS =
  '.pdf,.png,.jpg,.jpeg,.webp,.csv,.json,.txt';

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function computeBrowserSha256Hex(buffer: ArrayBuffer): Promise<string> {
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    const digest = await window.crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Fallback only if SubtleCrypto is unavailable; server computes authoritative Node SHA-256
  return '0'.repeat(64);
}

function readImageDimensions(
  objectUrl: string,
): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => resolve(null);
    img.src = objectUrl;
  });
}

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const EvidenceIngestion: React.FC<EvidenceIngestionProps> = ({
  activeRole,
  tamperSimulated,
  defaultCaseRef,
  onIngested,
}) => {
  const [mode, setMode] = React.useState<IngestionCaptureMode>('drag_drop');
  const [dragActive, setDragActive] = React.useState(false);
  const [staged, setStaged] = React.useState<StagedDocument | null>(null);
  const [processingFile, setProcessingFile] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmation, setConfirmation] = React.useState<{
    evidence_id: string;
    chain_hash: string;
    ingestion: IngestedAttachmentMeta;
  } | null>(null);

  // Form fields for sealing
  const [caseRef, setCaseRef] = React.useState(defaultCaseRef || 'SYN-RC-004');
  const [evidenceTag, setEvidenceTag] = React.useState<EvidenceTag | ''>(
    'Verified Fact',
  );
  const [title, setTitle] = React.useState('');
  const [accessAuthority, setAccessAuthority] = React.useState(
    POPIA_AUTHORITIES[0],
  );
  const [investigatorNote, setInvestigatorNote] = React.useState('');

  // Camera state
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const cameraFallbackInputRef = React.useRef<HTMLInputElement | null>(null);
  const [cameraActive, setCameraActive] = React.useState(false);
  const [cameraStarting, setCameraStarting] = React.useState(false);
  const [cameraError, setCameraError] = React.useState<string | null>(null);

  const stopCameraStream = React.useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setCameraStarting(false);
  }, []);

  const clearStaged = React.useCallback(() => {
    setStaged((prev) => {
      if (prev?.previewImageUrl) {
        URL.revokeObjectURL(prev.previewImageUrl);
      }
      return null;
    });
    setTitle('');
    setInvestigatorNote('');
  }, []);

  React.useEffect(() => {
    return () => {
      stopCameraStream();
    };
  }, [stopCameraStream]);

  React.useEffect(() => {
    return () => {
      if (staged?.previewImageUrl) {
        URL.revokeObjectURL(staged.previewImageUrl);
      }
    };
  }, [staged?.previewImageUrl]);

  async function stageBinaryOrFile(params: {
    buffer: ArrayBuffer;
    filename: string;
    mimeType: string;
    captureMode: IngestionCaptureMode;
    explicitDimensions?: { width: number; height: number } | null;
  }) {
    setError(null);
    setConfirmation(null);
    setProcessingFile(true);
    let previewUrl: string | null = null;

    try {
      if (params.buffer.byteLength === 0) {
        throw new Error('Selected file is empty (0 bytes).');
      }
      if (params.buffer.byteLength > MAX_INGESTION_BYTES) {
        throw new Error(
          `File exceeds ${Math.round(MAX_INGESTION_BYTES / (1024 * 1024))} MB limit (${formatByteSize(params.buffer.byteLength)}).`,
        );
      }

      const safeName = sanitizeIngestionFilename(params.filename);
      const mime = normalizeAllowedMime(params.mimeType, safeName);
      if (!mime) {
        throw new Error(
          'Unsupported file type. Upload PDF, PNG, JPEG, WebP, CSV, JSON, or TXT documents.',
        );
      }

      const bytes = new Uint8Array(params.buffer);
      const binarySha256 = await computeBrowserSha256Hex(params.buffer);

      // Validate magic bytes and payload integrity before allocating any preview Blob URL
      const initialProcessed = processEvidencePayload({
        bytes,
        filename: safeName,
        mimeType: mime,
        binarySha256,
        captureMode: params.captureMode,
        investigatorNote,
        imageDimensions: params.explicitDimensions ?? null,
      });

      let dims = params.explicitDimensions ?? null;
      let processed = initialProcessed;

      if (mime.startsWith('image/')) {
        const blob = new Blob([bytes], { type: mime });
        previewUrl = URL.createObjectURL(blob);
        if (!dims) {
          dims = await readImageDimensions(previewUrl);
          if (dims) {
            processed = processEvidencePayload({
              bytes,
              filename: safeName,
              mimeType: mime,
              binarySha256,
              captureMode: params.captureMode,
              investigatorNote,
              imageDimensions: dims,
            });
          }
        }
      }

      const base64Payload = arrayBufferToBase64(params.buffer);

      setStaged((prev) => {
        if (prev?.previewImageUrl) {
          URL.revokeObjectURL(prev.previewImageUrl);
        }
        return {
          filename: safeName,
          mimeType: mime,
          byteSize: params.buffer.byteLength,
          base64Payload,
          binarySha256,
          captureMode: params.captureMode,
          previewImageUrl: previewUrl,
          imageDimensions: dims,
          processed,
        };
      });

      setTitle(processed.suggested_title);
      if (processed.suggested_case_ref) {
        setCaseRef(processed.suggested_case_ref);
      }
    } catch (err) {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to validate or inspect document payload.',
      );
    } finally {
      setProcessingFile(false);
    }
  }

  async function handleFileInput(
    files: FileList | null,
    captureMode: IngestionCaptureMode,
  ) {
    if (!files || files.length === 0) return;
    const file = files[0];
    const buffer = await file.arrayBuffer();
    await stageBinaryOrFile({
      buffer,
      filename: file.name,
      mimeType: file.type,
      captureMode,
    });
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    void handleFileInput(e.dataTransfer?.files ?? null, 'drag_drop');
  }

  async function handleStartCamera() {
    setCameraError(null);
    setError(null);
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setCameraError(
        'Live camera stream API is unavailable in this browser context. Use "Capture via Device Photo" below to attach a camera image.',
      );
      return;
    }

    setCameraStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);
      // Attach stream after state commits video element
      requestAnimationFrame(() => {
        if (videoRef.current && streamRef.current) {
          videoRef.current.srcObject = streamRef.current;
          void videoRef.current.play().catch(() => {});
        }
      });
    } catch (err) {
      setCameraError(
        err instanceof Error
          ? `Camera access unavailable (${err.message}). Use "Capture via Device Photo" below to upload a document photo.`
          : 'Camera permission declined or no camera hardware detected.',
      );
      stopCameraStream();
    } finally {
      setCameraStarting(false);
    }
  }

  async function handleCaptureFrame() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      setCameraError('Camera stream is still initializing; wait a moment and try again.');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setCameraError('Unable to initialize canvas frame buffer.');
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.92),
    );
    if (!blob) {
      setCameraError('Failed to encode captured camera frame.');
      return;
    }

    const buffer = await blob.arrayBuffer();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    await stageBinaryOrFile({
      buffer,
      filename: `camera-evidence-${stamp}.jpg`,
      mimeType: 'image/jpeg',
      captureMode: 'camera',
      explicitDimensions: { width: canvas.width, height: canvas.height },
    });
    stopCameraStream();
  }

  async function handleSealIngestedDocument(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!staged) {
      setError('Drop a document or capture an image first.');
      return;
    }
    if (!evidenceTag) {
      setError('Mandatory Evidence Tag is required before sealing.');
      return;
    }
    if (!caseRef.trim() || !title.trim()) {
      setError('Case / Policy reference and Document title are required.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetch<{
        ok: boolean;
        item: EvidenceItemRecord;
        verification: VaultVerificationResult;
        ingestion: IngestedAttachmentMeta;
      }>('/api/vault/ingest', activeRole, {
        method: 'POST',
        body: JSON.stringify({
          case_ref: caseRef.trim(),
          title: title.trim(),
          evidence_tag: evidenceTag,
          access_authority: accessAuthority,
          investigator_note: investigatorNote.trim(),
          capture_mode: staged.captureMode,
          filename: staged.filename,
          mime_type: staged.mimeType,
          content_base64: staged.base64Payload,
          image_dimensions: staged.imageDimensions,
        }),
      });

      setConfirmation({
        evidence_id: res.item.evidence_id,
        chain_hash: res.item.chain_hash,
        ingestion: res.ingestion,
      });
      clearStaged();
      await onIngested();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to process and seal document into Evidence Vault.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      aria-label="Evidence Ingestion"
      className="rounded-md bg-[#131C31] border border-slate-800 p-4 sm:p-5 space-y-4"
    >
      {/* Header + Mode Switcher */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <FileUp className="w-4 h-4 text-emerald-400 shrink-0" />
            <h2 className="font-display text-base font-semibold text-white">
              Evidence Ingestion
            </h2>
          </div>
          <p className="text-xs text-slate-400">
            Securely drop insurance documents / claim records or capture physical evidence via camera · Verified magic bytes, POPIA s19 PII masking, and SHA-256 chain sealing.
          </p>
        </div>

        <div
          role="group"
          aria-label="Evidence ingestion input mode"
          className="inline-flex items-center gap-1 p-1 rounded-md bg-slate-900 border border-slate-800 self-start lg:self-auto shrink-0"
        >
          <button
            type="button"
            onClick={() => {
              stopCameraStream();
              setMode('drag_drop');
              setError(null);
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
              mode === 'drag_drop'
                ? 'bg-emerald-600 text-white font-semibold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            Drag &amp; Drop Document
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('camera');
              setError(null);
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
              mode === 'camera'
                ? 'bg-emerald-600 text-white font-semibold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
            Camera Capture
          </button>
        </div>
      </div>

      {/* Fail-Closed Tamper Warning */}
      {tamperSimulated && (
        <div
          role="alert"
          className="p-3 rounded-md bg-red-950/40 border border-red-600/50 text-xs text-red-200 flex items-center gap-2.5"
        >
          <Lock className="w-4 h-4 text-red-400 shrink-0" />
          <span>
            Vault is currently quarantined (fail-closed). Restore the verified hash chain above before ingesting new documents.
          </span>
        </div>
      )}

      {/* Confirmation Banner */}
      {confirmation && (
        <div
          role="status"
          className="p-3.5 rounded-md bg-emerald-950/40 border border-emerald-500/50 text-xs text-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
        >
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <div>
                <span className="font-semibold text-white">
                  Sealed to Custody Chain:{' '}
                </span>
                <span className="font-mono font-semibold text-emerald-300">
                  {confirmation.evidence_id}
                </span>{' '}
                · {confirmation.ingestion.document_class}
              </div>
              <div className="font-mono text-[11px] text-emerald-200/85 tabular-nums">
                File SHA-256 {shortHash(confirmation.ingestion.binary_sha256)} · Chain{' '}
                {shortHash(confirmation.chain_hash)} ·{' '}
                {confirmation.ingestion.pii_redactions_count} POPIA PII redaction(s)
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setConfirmation(null)}
            className="text-emerald-300 hover:text-white font-medium self-start sm:self-auto shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Error Alert */}
      {error && (
        <div
          role="alert"
          className="p-3.5 rounded-md bg-amber-950/45 border border-amber-700/60 text-xs text-amber-200 flex items-start justify-between gap-3"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-amber-300 hover:text-white font-medium shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Two-Column Ingestion Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left: Drop Zone or Camera Viewfinder */}
        <div className="lg:col-span-6 space-y-3">
          {mode === 'drag_drop' ? (
            <div
              onDragEnter={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragActive(true);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragActive(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragActive(false);
              }}
              onDrop={handleDrop}
              className={`rounded-md border-2 border-dashed p-6 text-center transition-colors space-y-3 ${
                dragActive
                  ? 'border-emerald-400 bg-emerald-950/25'
                  : 'border-slate-700 bg-[#0F172A] hover:border-slate-600'
              }`}
            >
              <input
                ref={fileInputRef}
                id="evidence-ingestion-file-input"
                type="file"
                accept={ACCEPTED_FILE_EXTENSIONS}
                className="sr-only"
                onChange={(e) => {
                  void handleFileInput(e.target.files, 'drag_drop');
                  e.target.value = '';
                }}
              />

              <div className="mx-auto w-10 h-10 rounded-md bg-slate-900 border border-slate-800 flex items-center justify-center">
                <Upload className="w-5 h-5 text-emerald-400" />
              </div>

              <div className="space-y-1">
                <p className="text-sm font-semibold text-white">
                  {dragActive
                    ? 'Release file to inspect & hash'
                    : 'Drop insurance document or claim record here'}
                </p>
                <p className="text-xs text-slate-400">
                  Supports BI-1663 scans, policy schedules, sheriff returns, CSV bordereaux, and JSON claim records (PDF, PNG, JPEG, WebP, CSV, JSON, TXT · max 5 MB).
                </p>
              </div>

              <div className="pt-1">
                <button
                  type="button"
                  disabled={processingFile || tamperSimulated}
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 text-xs font-semibold rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white inline-flex items-center gap-2 transition-colors whitespace-nowrap disabled:opacity-50"
                >
                  <FileCheck2 className="w-3.5 h-3.5 text-emerald-400" />
                  {processingFile ? 'Inspecting Payload...' : 'Browse Files'}
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-md bg-[#0F172A] border border-slate-800 p-4 space-y-3">
              <input
                ref={cameraFallbackInputRef}
                id="evidence-camera-fallback-input"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                capture="environment"
                className="sr-only"
                onChange={(e) => {
                  void handleFileInput(e.target.files, 'camera');
                  e.target.value = '';
                }}
              />

              {cameraActive ? (
                <div className="space-y-3">
                  <div className="relative rounded-md overflow-hidden bg-black border border-slate-700 aspect-video flex items-center justify-center">
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-mono text-emerald-400">
                      Live optical viewfinder active · Frame document clearly
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={stopCameraStream}
                        className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-300 whitespace-nowrap"
                      >
                        Stop Camera
                      </button>
                      <button
                        type="button"
                        disabled={processingFile || tamperSimulated}
                        onClick={() => void handleCaptureFrame()}
                        className="px-3.5 py-1.5 text-xs font-semibold rounded-md bg-emerald-600 hover:bg-emerald-500 text-white inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
                      >
                        <Camera className="w-3.5 h-3.5" />
                        Capture Frame
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="py-5 text-center space-y-3">
                  <div className="mx-auto w-10 h-10 rounded-md bg-slate-900 border border-slate-800 flex items-center justify-center">
                    <Camera className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div className="space-y-1 max-w-md mx-auto">
                    <p className="text-sm font-semibold text-white">
                      Capture Physical Insurance Document
                    </p>
                    <p className="text-xs text-slate-400">
                      Photograph death notices, signed consent forms, or assessor inspection evidence directly into a SHA-256 frame.
                    </p>
                  </div>

                  {cameraError && (
                    <div
                      role="alert"
                      className="p-2.5 rounded bg-amber-950/40 border border-amber-700/50 text-[11px] text-amber-200 text-left"
                    >
                      {cameraError}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                    <button
                      type="button"
                      disabled={cameraStarting || tamperSimulated}
                      onClick={() => void handleStartCamera()}
                      className="px-4 py-2 text-xs font-semibold rounded-md bg-emerald-600 hover:bg-emerald-500 text-white inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      {cameraStarting ? 'Starting Camera...' : 'Start Camera'}
                    </button>
                    <button
                      type="button"
                      disabled={processingFile || tamperSimulated}
                      onClick={() => cameraFallbackInputRef.current?.click()}
                      className="px-3.5 py-2 text-xs font-medium rounded-md border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
                    >
                      <Upload className="w-3.5 h-3.5 text-emerald-400" />
                      Capture via Device Photo
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Staged Document Preview (Image thumbnail or structured payload inspection) */}
          {staged && (
            <div className="p-3.5 rounded-md bg-[#0F172A] border border-slate-800 space-y-2.5 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-white truncate">
                    {staged.filename}
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-0.5">
                    {staged.processed.meta.document_class} · {staged.mimeType} ·{' '}
                    {formatByteSize(staged.byteSize)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={clearStaged}
                  aria-label="Clear staged document"
                  className="text-slate-400 hover:text-red-300 p-1 rounded border border-slate-800 hover:border-red-500/40 shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {staged.previewImageUrl && (
                <div className="rounded overflow-hidden border border-slate-800 bg-black/50 max-h-48 flex items-center justify-center">
                  <img
                    src={staged.previewImageUrl}
                    alt={`Preview of staged evidence ${staged.filename}`}
                    className="max-h-48 w-auto object-contain"
                  />
                </div>
              )}

              <div className="pt-2 border-t border-slate-800/80 space-y-1 text-[11px]">
                <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-slate-300 tabular-nums">
                  <span>Pre-seal SHA-256: {shortHash(staged.binarySha256)}</span>
                  {staged.processed.meta.pii_redactions_count > 0 ? (
                    <span className="text-amber-300 font-semibold">
                      POPIA s19 masked {staged.processed.meta.pii_redactions_count} PII item(s)
                    </span>
                  ) : (
                    <span className="text-emerald-400">Magic bytes verified</span>
                  )}
                </div>
                <p className="text-slate-400 leading-relaxed">
                  {staged.processed.extracted_summary}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Right: Classification & Seal Form */}
        <form
          onSubmit={handleSealIngestedDocument}
          className="lg:col-span-6 rounded-md bg-[#0F172A] border border-slate-800 p-4 space-y-3 text-xs"
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
            <h3 className="font-display text-sm font-semibold text-white">
              Forensic Classification &amp; Sealing
            </h3>
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          </div>

          {!staged ? (
            <div className="py-6 text-center space-y-1.5 text-slate-400">
              <p className="text-slate-300 font-medium">
                No document or capture staged
              </p>
              <p className="leading-relaxed max-w-md mx-auto">
                Drop a claim record / PDF scan or capture a document photo on the left to inspect its SHA-256 fingerprint, redact SA PII, and seal it into the append-only vault.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="ingest-case-ref"
                    className="block text-slate-400 mb-1"
                  >
                    Case / Policy Reference
                  </label>
                  <input
                    id="ingest-case-ref"
                    value={caseRef}
                    onChange={(e) => setCaseRef(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white font-mono"
                  />
                </div>

                <div>
                  <label
                    htmlFor="ingest-evidence-tag"
                    className="block text-slate-400 mb-1"
                  >
                    Mandatory Evidence Tag (NOT NULL)
                  </label>
                  <select
                    id="ingest-evidence-tag"
                    value={evidenceTag}
                    onChange={(e) =>
                      setEvidenceTag(e.target.value as EvidenceTag | '')
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white"
                  >
                    <option value="">-- Select Evidence Tag --</option>
                    {EVIDENCE_TAGS.map((tag) => (
                      <option key={tag} value={tag}>
                        {tag}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="ingest-title"
                  className="block text-slate-400 mb-1"
                >
                  Document / Claim Record Title
                </label>
                <input
                  id="ingest-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white"
                />
              </div>

              <div>
                <label
                  htmlFor="ingest-authority"
                  className="block text-slate-400 mb-1"
                >
                  POPIA Processing Authority
                </label>
                <select
                  id="ingest-authority"
                  value={accessAuthority}
                  onChange={(e) => setAccessAuthority(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white"
                >
                  {POPIA_AUTHORITIES.map((auth) => (
                    <option key={auth} value={auth}>
                      {auth}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="ingest-note"
                  className="block text-slate-400 mb-1"
                >
                  Investigator Context Note (Optional · POPIA s19 masked on save)
                </label>
                <textarea
                  id="ingest-note"
                  rows={2}
                  maxLength={400}
                  value={investigatorNote}
                  onChange={(e) => setInvestigatorNote(e.target.value)}
                  placeholder="e.g., Original DHA-1663 stamped by mortuary; matches BI-1663 box 24 discrepancy..."
                  className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white placeholder:text-slate-500"
                />
              </div>

              <button
                type="submit"
                disabled={submitting || tamperSimulated || !evidenceTag}
                className="w-full py-2.5 px-4 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
              >
                <ShieldCheck className="w-4 h-4" />
                {submitting
                  ? 'Sealing to SHA-256 Chain...'
                  : 'Process & Seal to SHA-256 Vault'}
              </button>
            </div>
          )}
        </form>
      </div>
    </section>
  );
};
