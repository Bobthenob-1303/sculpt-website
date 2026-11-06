import { useEffect, useRef, useState } from "react";

// Browser-local image storage; unlike localStorage, IndexedDB handles image blobs.
const DB_NAME = "sculpt-saved-gallery";
const STORE_NAME = "images";

function openGalleryDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Cannot open gallery storage"));
  });
}

async function listImages() {
  const db = await openGalleryDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => b.id - a.id));
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function writeImage(blob) {
  const db = await openGalleryDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).add({ image: blob, savedAt: Date.now() });
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}

async function removeImage(id) {
  const db = await openGalleryDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}

function GalleryArrow() {
  // Tall, hand-drawn chevron. The two offset strokes make it look scribbled.
  return (
    <svg className="gallery-arrow-svg" viewBox="0 0 110 600" fill="none" aria-hidden="true">
      <path className="gallery-arrow-line arrow-line-1"
        d="M92 20 L78 58 L66 96 L54 139 L42 181 L30 225 L19 265 L12 300 L20 337 L33 382 L44 426 L58 470 L72 516 L92 580" />
      <path className="gallery-arrow-line arrow-line-2"
        d="M96 24 L83 62 L70 100 L57 144 L46 184 L33 230 L22 267 L16 300 L24 338 L37 383 L49 430 L62 475 L77 518 L96 575" />
      <path className="gallery-arrow-line arrow-line-3"
        d="M88 30 L75 68 L64 110 L50 148 L38 195 L27 238 L16 277 L9 300 L18 345 L30 390 L42 434 L56 484 L69 523 L87 568" />
    </svg>
  );
}

export default function Gallery({ captureImage }) {
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [images, setImages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pointer = useRef(null);
  const suppressClick = useRef(false);
  const panelRef = useRef(null);
  const objectUrls = useRef([]);

  async function refresh() {
    const records = await listImages();
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    const urls = records.map((record) => ({
      id: record.id,
      savedAt: record.savedAt,
      url: URL.createObjectURL(record.image),
    }));
    objectUrls.current = urls.map((item) => item.url);
    setImages(urls);
  }

  useEffect(() => {
    let alive = true;
    listImages().then((records) => {
      if (!alive) return;
      const urls = records.map((record) => ({
        id: record.id,
        savedAt: record.savedAt,
        url: URL.createObjectURL(record.image),
      }));
      objectUrls.current = urls.map((item) => item.url);
      setImages(urls);
    }).catch(() => {
      if (alive) setError("Gallery storage is unavailable in this browser.");
    });
    return () => {
      alive = false;
      objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrls.current = [];
    };
  }, []);

  function setGalleryOpen(value) {
    setOpen(value);
    setProgress(value ? 1 : 0);
  }

  function startDrag(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    pointer.current = {
      id: e.pointerId,
      startX: e.clientX,
      initial: progress,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  }

  function moveDrag(e) {
    const p = pointer.current;
    if (!p || p.id !== e.pointerId) return;
    const dx = e.clientX - p.startX;
    if (Math.abs(dx) > 5) p.moved = true;
    const width = panelRef.current?.getBoundingClientRect().width || 380;
    setProgress(Math.max(0, Math.min(1, p.initial - dx / width)));
  }

  function endDrag(e) {
    const p = pointer.current;
    if (!p || p.id !== e.pointerId) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    pointer.current = null;
    setDragging(false);
    if (p.moved) {
      suppressClick.current = true;
      const width = panelRef.current?.getBoundingClientRect().width || 380;
      const finalProgress = Math.max(0, Math.min(1, p.initial - (e.clientX - p.startX) / width));
      setGalleryOpen(finalProgress >= 0.5);
    }
  }

  function clickArrow() {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    setGalleryOpen(!open);
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const blob = await captureImage();
      if (!blob) throw new Error("Could not capture the sculpture.");
      await writeImage(blob);
      await refresh();
    } catch (err) {
      setError(err?.message || "Could not save the image.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    setError("");
    try {
      await removeImage(id);
      await refresh();
    } catch {
      setError("Could not delete this image.");
    }
  }

  return (
    <aside
      ref={panelRef}
      className={`sculpt-gallery ${dragging ? "is-dragging" : ""} ${open ? "is-open" : ""}`}
      style={{ transform: `translateX(${(1 - progress) * 100}%)` }}
      aria-label="Saved sculptures gallery"
    >
      <button
        className="gallery-handle"
        type="button"
        aria-label={open ? "Close saved gallery" : "Open saved gallery"}
        aria-expanded={open}
        title="Drag to open or close gallery"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={clickArrow}
      >
        <span className="gallery-arrow"><GalleryArrow /></span>
      </button>

      <div className="gallery-panel-inner" aria-hidden={!open && !dragging}>
        <div className="gallery-heading">
          <span>SCULPTURE ARCHIVE</span>
          <span className="gallery-count">{images.length} SAVED</span>
        </div>
        <button type="button" className="gallery-save" onClick={save} disabled={busy}>
          {busy ? "SAVING..." : "+ SAVE CURRENT SCULPTURE"}
        </button>
        <p className="gallery-note">Saves a snapshot of the current 3D mesh, not an editable 3D model. Images are stored in this browser.</p>
        {error && <p className="gallery-error" role="alert">{error}</p>}
        {images.length === 0 ? (
          <div className="gallery-empty">NO SCULPTURES SAVED YET</div>
        ) : (
          <div className="gallery-grid">
            {images.map((item) => (
              <div className="gallery-tile" key={item.id}>
                <a href={item.url} target="_blank" rel="noreferrer" title="View saved image">
                  <img src={item.url} alt={`Saved sculpture from ${new Date(item.savedAt).toLocaleString()}`} />
                </a>
                <div className="gallery-tile-footer">
                  <span>{new Date(item.savedAt).toLocaleDateString()}</span>
                  <button type="button" aria-label="Delete saved image" onClick={() => remove(item.id)}>DELETE</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
