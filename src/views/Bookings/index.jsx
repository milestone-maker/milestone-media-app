import { useState, useEffect, useRef } from "react";
import { supabase } from "../../supabaseClient";
import { useAuth } from "../../lib/auth";

// ============================================================
// BOOKINGS MANAGER VIEW — View & manage all bookings
// ============================================================
function BookingsManagerView() {
  const { user, profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [editingBooking, setEditingBooking] = useState(null);
  const [saving, setSaving] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(null);
  // Media upload/download state
  const [mediaModal, setMediaModal] = useState(null); // booking object when modal is open
  const [mediaFiles, setMediaFiles] = useState([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [tourUrl, setTourUrl] = useState("");
  const [tourLabel, setTourLabel] = useState("");
  const [dragOver, setDragOver] = useState(false);
  // Cache signed URLs keyed by filePath → { url, expiresAt }
  const signedUrlCache = useRef({});
  const [zipProgress, setZipProgress] = useState(null); // null | { done, total }
  const [selectMode, setSelectMode] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState(new Set());
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [lightboxUrl, setLightboxUrl] = useState(null);
  const fileInputRef = useRef(null);
  // Photo reorder drag state
  const dragPhotoIdx = useRef(null);
  const dragOverPhotoIdx = useRef(null);

  // Re-fetch whenever isAdmin or user resolves (profile loads async — empty [] misses admin flag)
  useEffect(() => {
    if (user?.id) fetchBookings();
  }, [isAdmin, user?.id]);

  // Request browser notification permission for admin (so they get alerted on new bookings)
  useEffect(() => {
    if (isAdmin && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, [isAdmin]);

  // Real-time subscription: notify admin when a new booking arrives
  useEffect(() => {
    if (!isAdmin) return;
    const channel = supabase
      .channel("new-bookings")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "bookings" }, (payload) => {
        const b = payload.new;
        const msg = `New booking from ${b.client_name || "an agent"} — ${b.address || ""}`;
        // Use browser notification if permitted, otherwise alert via title flash
        if (Notification.permission === "granted") {
          new Notification("📋 New Booking — Milestone Media", { body: msg, icon: "/icons/icon-192.png" });
        }
        fetchBookings(); // refresh list
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [isAdmin]);

  const fetchBookings = async () => {
    setLoading(true);
    let allBookings = [];

    if (isAdmin) {
      // Admin sees everything
      const { data, error } = await supabase.from("bookings").select("*").order("created_at", { ascending: false });
      if (data) allBookings = data;
      if (error) console.error("Error loading bookings:", error);
    } else if (user?.id) {
      // Email columns are stored lowercased (create-booking normalizes + backfill
      // applied), and Supabase auth emails are lowercased. Use case-insensitive
      // EXACT match via .eq on the lowercased value — NOT .ilike, since ilike
      // treats `_` and `%` as wildcards and could over-match a different client's
      // booking (correctness + privacy bug).
      const userEmail = (user.email || "").trim().toLowerCase();

      // Fetch bookings by agent_id
      const { data: ownData } = await supabase.from("bookings").select("*")
        .eq("agent_id", user.id).order("created_at", { ascending: false });

      // Fetch unclaimed website bookings that match this agent's email
      const { data: emailData } = await supabase.from("bookings").select("*")
        .eq("client_email", userEmail).is("agent_id", null)
        .order("created_at", { ascending: false });

      // Fetch bookings where this user is a CC'd assistant/collaborator
      const { data: ccData } = await supabase.from("bookings").select("*")
        .eq("cc_email", userEmail).order("created_at", { ascending: false });

      // Merge and deduplicate
      const combined = [...(ownData || []), ...(emailData || []), ...(ccData || [])];
      allBookings = combined.filter((b, i, arr) => arr.findIndex(x => x.id === b.id) === i);

      // Auto-claim unclaimed email-matched bookings (link agent_id silently)
      const unclaimed = (emailData || []).filter(b => !b.agent_id);
      if (unclaimed.length > 0) {
        await supabase.from("bookings")
          .update({ agent_id: user.id })
          .in("id", unclaimed.map(b => b.id));
      }
    }

    setBookings(allBookings);
    setLoading(false);
  };

  const updateStatus = async (id, newStatus) => {
    const { error } = await supabase.from("bookings").update({ status: newStatus }).eq("id", id);
    if (error) { console.error("Status update error:", error); alert("Failed to update status."); return; }
    if (newStatus === "completed") {
      const booking = bookings.find(b => b.id === id);
      if (booking?.client_email) {
        fetch("/api/send-media-ready", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ booking: {
            clientName: booking.client_name,
            clientEmail: booking.client_email,
            address: booking.address,
            city: booking.city,
            invoicePaid: booking.invoice_paid,
            stripeInvoiceId: booking.stripe_invoice_id,
          }}),
        }).catch(err => console.error("Media ready email error:", err));
      }
    }
    fetchBookings();
    setCancelConfirm(null);
  };

  const saveBooking = async (updated) => {
    setSaving(true);
    const { id, created_at, ...fields } = updated;
    const { error } = await supabase.from("bookings").update(fields).eq("id", id);
    if (error) { console.error("Save error:", error); alert("Failed to save changes."); }
    else { setEditingBooking(null); fetchBookings(); }
    setSaving(false);
  };

  // ——— Media Functions ———
  const openMediaModal = async (booking) => {
    setMediaModal(booking);
    setTourUrl("");
    setTourLabel("");
    await loadMedia(booking.id);
  };

  const loadMedia = async (bookingId) => {
    setSelectMode(false);
    setSelectedMedia(new Set());
    setMediaLoading(true);
    const { data, error } = await supabase
      .from("booking_media")
      .select("*")
      .eq("booking_id", bookingId)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });
    if (error) { console.error("Error loading media:", error); setMediaLoading(false); return; }

    if (data && data.length > 0) {
      // Photo file paths (need signed URLs for display + thumbnails)
      const photoPaths = data
        .filter(item => item.file_path && item.file_type === "photo")
        .map(item => item.file_path);
      // Video file paths (need full-size signed URL for display; no thumb transform)
      const videoPaths = data
        .filter(item => item.file_path && item.file_type === "video")
        .map(item => item.file_path);

      const allFilePaths = [...photoPaths, ...videoPaths];

      // Only fetch thumbnail URLs on load — full-size URLs are generated on demand
      // (single download) or lazily batched (download all). This cuts load time in half.
      const now = Date.now();
      const uncachedPhotoPaths = photoPaths.filter(p => {
        const c = signedUrlCache.current[p + "__thumb"];
        return !c || c.expiresAt < now;
      });

      if (uncachedPhotoPaths.length > 0) {
        const thumbResult = await supabase.storage.from("booking-media").createSignedUrls(
          uncachedPhotoPaths, 3600, { transform: { width: 300, height: 300, resize: "cover" } }
        );
        thumbResult.data?.forEach(s => {
          if (s.signedUrl) signedUrlCache.current[s.path + "__thumb"] = { url: s.signedUrl, expiresAt: now + 3500000 };
        });
      }

      setMediaFiles(data.map(item => {
        const cached = item.file_path ? signedUrlCache.current[item.file_path + "__thumb"] : null;
        return {
          ...item,
          signed_url: null, // fetched on demand at download time
          thumb_url: cached?.url || null,
        };
      }));
    } else {
      setMediaFiles(data || []);
    }
    setMediaLoading(false);
  };

  // Resize + compress a photo to max 2048×1536 and under 10 MB before upload.
  // Videos are passed through untouched.
  const prepareFile = (file) => new Promise((resolve) => {
    const MAX_W = 2048, MAX_H = 1536, MAX_BYTES = 10 * 1024 * 1024, QUALITY = 0.88;
    if (!file.type.startsWith("image/")) { resolve(file); return; }

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let w = img.naturalWidth, h = img.naturalHeight;
      const needsResize = w > MAX_W || h > MAX_H || file.size > MAX_BYTES;
      if (!needsResize) { resolve(file); return; }

      // Scale down proportionally to fit within 2048×1536
      const ratio = Math.min(MAX_W / w, MAX_H / h, 1);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);

      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);

      canvas.toBlob((blob) => {
        const outName = file.name.replace(/\.[^.]+$/, ".jpg");
        resolve(new File([blob], outName, { type: "image/jpeg" }));
      }, "image/jpeg", QUALITY);
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(file); };
    img.src = objectUrl;
  });

  const handleFileUpload = async (files) => {
    if (!mediaModal || !files.length) return;
    setUploading(true);
    const bookingId = mediaModal.id;

    // Upload all files in parallel — no more waiting for each one to finish before starting the next
    const uploadOne = async (rawFile) => {
      const file = await prepareFile(rawFile); // resize photos to 2048×1536 / 10 MB max
      const isVideo = file.type.startsWith("video/");
      const fileType = isVideo ? "video" : "photo";
      const filePath = `${bookingId}/${Date.now()}_${Math.random().toString(36).slice(2)}_${file.name}`;

      const { error: uploadErr } = await supabase.storage
        .from("booking-media")
        .upload(filePath, file, { contentType: file.type });

      if (uploadErr) {
        console.error("Upload error:", uploadErr);
        return; // skip DB insert for failed upload
      }

      const { error: dbErr } = await supabase.from("booking_media").insert({
        booking_id: bookingId,
        file_name: rawFile.name, // keep original filename in DB
        file_type: fileType,
        file_path: filePath,
        file_size: file.size,
        mime_type: file.type,
        uploaded_by: user?.id,
      });
      if (dbErr) console.error("DB insert error:", dbErr);
    };

    await Promise.all(files.map(uploadOne));
    await loadMedia(bookingId);
    setUploading(false);
  };

  const addTourLink = async () => {
    if (!mediaModal || !tourUrl.trim()) return;
    const { error } = await supabase.from("booking_media").insert({
      booking_id: mediaModal.id,
      file_name: tourLabel.trim() || "3D Tour",
      file_type: "3d_tour",
      tour_url: tourUrl.trim(),
      uploaded_by: user?.id,
    });
    if (error) { console.error("Tour link error:", error); alert("Failed to add tour link."); }
    else { setTourUrl(""); setTourLabel(""); await loadMedia(mediaModal.id); }
  };

  const deleteMedia = async (media) => {
    if (!confirm(`Delete "${media.file_name}"?`)) return;
    // Delete from storage if it's a file (not a tour link)
    if (media.file_path) {
      await supabase.storage.from("booking-media").remove([media.file_path]);
    }
    await supabase.from("booking_media").delete().eq("id", media.id);
    await loadMedia(mediaModal.id);
  };

  const deleteSelectedMedia = async () => {
    if (selectedMedia.size === 0) return;
    if (!confirm(`Delete ${selectedMedia.size} selected file${selectedMedia.size !== 1 ? "s" : ""}? This cannot be undone.`)) return;
    const toDelete = mediaFiles.filter(m => selectedMedia.has(m.id));
    const storagePaths = toDelete.filter(m => m.file_path).map(m => m.file_path);
    if (storagePaths.length > 0) {
      await supabase.storage.from("booking-media").remove(storagePaths);
    }
    const ids = toDelete.map(m => m.id);
    await supabase.from("booking_media").delete().in("id", ids);
    setSelectedMedia(new Set());
    setSelectMode(false);
    await loadMedia(mediaModal.id);
  };

  const toggleSelectItem = (id) => {
    setSelectedMedia(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const getDownloadUrl = async (filePath) => {
    const now = Date.now();
    const cached = signedUrlCache.current[filePath];
    if (cached && cached.expiresAt > now) return cached.url;
    const { data } = await supabase.storage.from("booking-media").createSignedUrl(filePath, 3600);
    if (data?.signedUrl) signedUrlCache.current[filePath] = { url: data.signedUrl, expiresAt: now + 3500000 };
    return data?.signedUrl;
  };

  const openLightbox = async (index) => {
    const photos = mediaFiles.filter(m => m.file_type === "photo");
    if (!photos[index]) return;
    setLightboxIndex(index);
    setLightboxUrl(null); // show spinner while loading
    const url = await getDownloadUrl(photos[index].file_path);
    setLightboxUrl(url);
  };

  const lightboxNav = async (dir) => {
    const photos = mediaFiles.filter(m => m.file_type === "photo");
    const next = (lightboxIndex + dir + photos.length) % photos.length;
    setLightboxIndex(next);
    setLightboxUrl(null);
    const url = await getDownloadUrl(photos[next].file_path);
    setLightboxUrl(url);
  };

  // Keyboard nav for lightbox
  useEffect(() => {
    if (lightboxIndex === null) return;
    const onKey = (e) => {
      if (e.key === "ArrowRight") lightboxNav(1);
      else if (e.key === "ArrowLeft") lightboxNav(-1);
      else if (e.key === "Escape") setLightboxIndex(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxIndex, lightboxUrl]);

  const downloadSingleFile = async (media) => {
    const url = await getDownloadUrl(media.file_path);
    if (!url) return alert("Could not get download link. Please try again.");
    const res = await fetch(url);
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = media.file_name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  };

  // Build a slug from the booking address for MLS file naming
  const buildAddressSlug = (booking) => {
    const parts = [booking?.address, booking?.city].filter(Boolean).join(" ");
    return parts
      .replace(/[^a-zA-Z0-9\s]/g, "")
      .trim()
      .split(/\s+/)
      .slice(0, 4)
      .join("-");
  };

  const downloadAllMedia = async () => {
    const JSZip = window.JSZip;
    if (!JSZip) return alert("ZIP library not loaded. Please refresh and try again.");

    const photos = mediaFiles.filter(m => m.file_type === "photo" && m.file_path);
    const videos = mediaFiles.filter(m => m.file_type === "video" && m.file_path);
    const tours  = mediaFiles.filter(m => m.file_type === "3d_tour");

    const totalFiles = photos.length + videos.length;
    if (totalFiles === 0 && tours.length === 0) return alert("No files to download.");

    setZipProgress({ done: 0, total: totalFiles });
    const zip = new JSZip();
    const addressSlug = buildAddressSlug(mediaModal);

    // Pre-fetch all full-size signed URLs in one batch call before zipping
    const allPaths = [...photos, ...videos].map(m => m.file_path).filter(Boolean);
    const now = Date.now();
    const uncached = allPaths.filter(p => { const c = signedUrlCache.current[p]; return !c || c.expiresAt < now; });
    if (uncached.length > 0) {
      const { data: batchUrls } = await supabase.storage.from("booking-media").createSignedUrls(uncached, 3600);
      batchUrls?.forEach(s => {
        if (s.signedUrl) signedUrlCache.current[s.path] = { url: s.signedUrl, expiresAt: now + 3500000 };
      });
    }

    // ── Photos → Photos_MLS/ with sequential MLS naming ──────────────────
    if (photos.length > 0) {
      const photoFolder = zip.folder("Photos_MLS");
      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        try {
          const url = await getDownloadUrl(photo.file_path);
          if (!url) continue;
          const res = await fetch(url);
          const blob = await res.blob();
          // Determine extension from original filename or MIME
          const origExt = photo.file_name.split(".").pop().toLowerCase() || "jpg";
          const ext = ["jpg","jpeg","png","webp","tiff","heic"].includes(origExt) ? origExt : "jpg";
          const paddedNum = String(i + 1).padStart(2, "0");
          const mlsName = `${paddedNum}_${addressSlug}.${ext}`;
          photoFolder.file(mlsName, blob);
          setZipProgress({ done: i + 1, total: totalFiles });
        } catch (err) {
          console.error("Failed to fetch photo:", photo.file_name, err);
        }
      }
    }

    // ── Videos → Videos/ ─────────────────────────────────────────────────
    if (videos.length > 0) {
      const videoFolder = zip.folder("Videos");
      for (let i = 0; i < videos.length; i++) {
        const video = videos[i];
        try {
          const url = await getDownloadUrl(video.file_path);
          if (!url) continue;
          const res = await fetch(url);
          const blob = await res.blob();
          videoFolder.file(video.file_name, blob);
          setZipProgress({ done: photos.length + i + 1, total: totalFiles });
        } catch (err) {
          console.error("Failed to fetch video:", video.file_name, err);
        }
      }
    }

    // ── 3D Tour URLs → 3D_Tour_Links.txt ─────────────────────────────────
    if (tours.length > 0) {
      const tourLines = tours.map(t =>
        `${t.file_name || "3D Tour"}: ${t.tour_url || "(no URL)"}`
      ).join("\n");
      zip.file("3D_Tour_Links.txt", tourLines);
    }

    // ── Generate & trigger download ───────────────────────────────────────
    const zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
    const zipName = `${addressSlug}_Media.zip`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(zipBlob);
    a.download = zipName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    setZipProgress(null);
  };

  // Drag-and-drop photo reorder handlers
  const handlePhotoDragStart = (idx) => { dragPhotoIdx.current = idx; };
  const handlePhotoDragEnter = (idx) => { dragOverPhotoIdx.current = idx; };
  const handlePhotoDrop = async () => {
    const from = dragPhotoIdx.current;
    const to   = dragOverPhotoIdx.current;
    if (from === null || to === null || from === to) return;
    const photos  = mediaFiles.filter(m => m.file_type === "photo");
    const others  = mediaFiles.filter(m => m.file_type !== "photo");
    const reordered = [...photos];
    const [moved]   = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    // Reassign sort_order values sequentially
    const withOrder = reordered.map((p, i) => ({ ...p, sort_order: i }));
    setMediaFiles([...withOrder, ...others]);
    dragPhotoIdx.current = null;
    dragOverPhotoIdx.current = null;
    // Persist to DB
    await Promise.all(withOrder.map(p =>
      supabase.from("booking_media").update({ sort_order: p.sort_order }).eq("id", p.id)
    ));
  };

  const toggleInvoicePaid = async (bookingId, currentVal) => {
    const { error } = await supabase.from("bookings").update({ invoice_paid: !currentVal }).eq("id", bookingId);
    if (error) alert("Failed to update invoice status.");
    else fetchBookings();
  };

  const filtered = filter === "all" ? bookings : bookings.filter(b => b.status === filter);

  const statusColors = {
    pending: "#e8a838",
    confirmed: "#c9a84c",
    in_progress: "#4ecdc4",
    delivered: "#27ae60",
    completed: "#27ae60",
    cancelled: "#e74c3c",
  };

  const cardStyle = {
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 12,
    padding: 20,
    marginBottom: 12,
  };

  const labelSt = {
    fontFamily: "'Jost', sans-serif",
    fontSize: 10,
    color: "rgba(255,255,255,0.4)",
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    marginBottom: 4,
  };

  const btnBase = {
    fontFamily: "'Jost', sans-serif", fontSize: 11, cursor: "pointer",
    letterSpacing: "0.06em", textTransform: "uppercase", borderRadius: 6, padding: "6px 14px",
  };

  // ——— Media Modal (Admin: upload | Agent: download) ———
  if (mediaModal) {
    const photos = mediaFiles.filter(m => m.file_type === "photo");
    const videos = mediaFiles.filter(m => m.file_type === "video");
    const tours  = mediaFiles.filter(m => m.file_type === "3d_tour");
    const mediaCount = mediaFiles.length;
    const canDownload = isAdmin || mediaModal.invoice_paid;

    const sectionHeader = (text) => ({
      fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#c9a84c",
      letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12, marginTop: 20,
    });
    const dropZoneSt = {
      border: dragOver ? "2px dashed #c9a84c" : "2px dashed rgba(255,255,255,0.15)",
      borderRadius: 12, padding: 40, textAlign: "center", cursor: "pointer",
      background: dragOver ? "rgba(201,168,76,0.06)" : "rgba(255,255,255,0.02)",
      transition: "all 0.2s",
    };
    const thumbSt = {
      width: 80, height: 80, objectFit: "cover", borderRadius: 8,
      border: "1px solid rgba(255,255,255,0.1)",
      backgroundColor: "rgba(255,255,255,0.05)", // placeholder color while loading
    };

    const inputSt = {
      width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
      borderRadius: 8, padding: "10px 12px", color: "#fff", fontFamily: "'Jost', sans-serif", fontSize: 13,
      outline: "none", boxSizing: "border-box",
    };

    return (
      <div style={{ padding: "32px 24px", maxWidth: 750, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, color: "#c9a84c" }}>
            {isAdmin ? "Manage Media" : "Booking Media"}
          </div>
          <button onClick={() => setMediaModal(null)} style={{
            background: "transparent", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8,
            padding: "8px 16px", color: "rgba(255,255,255,0.6)", fontFamily: "'Jost', sans-serif",
            fontSize: 12, cursor: "pointer", letterSpacing: "0.06em",
          }}>← Back</button>
        </div>
        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "rgba(255,255,255,0.5)", marginBottom: 24 }}>
          {mediaModal.client_name} — {mediaModal.address}, {mediaModal.city}
          <span style={{ marginLeft: 12, color: "rgba(255,255,255,0.3)" }}>{mediaCount} file{mediaCount !== 1 ? "s" : ""}</span>
        </div>

        {/* Admin: Invoice & Payment Section */}
        {isAdmin && (
          <div style={{
            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12, padding: 20, marginBottom: 16,
          }}>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#c9a84c", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Invoice & Payment</div>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Stripe Invoice ID</div>
                <input
                  value={mediaModal.stripe_invoice_id || ""}
                  onChange={e => setMediaModal({ ...mediaModal, stripe_invoice_id: e.target.value })}
                  placeholder="in_1abc123... (paste from Stripe Dashboard)"
                  style={inputSt}
                />
              </div>
              <button onClick={async () => {
                const { error } = await supabase.from("bookings").update({ stripe_invoice_id: mediaModal.stripe_invoice_id }).eq("id", mediaModal.id);
                if (error) alert("Failed to save invoice ID.");
                else { fetchBookings(); alert("Invoice ID saved! Media will auto-unlock when paid."); }
              }} style={{
                ...btnBase, padding: "10px 16px", whiteSpace: "nowrap",
                background: "rgba(78,205,196,0.12)", border: "1px solid rgba(78,205,196,0.3)", color: "#4ecdc4",
              }}>Save Invoice ID</button>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 14, color: mediaModal.invoice_paid ? "#27ae60" : "#e74c3c" }}>
                  {mediaModal.invoice_paid ? "Paid — Media unlocked for agent" : "Unpaid — Media locked for agent"}
                </div>
                <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>
                  {mediaModal.stripe_invoice_id
                    ? "Auto-unlocks when agent pays via Stripe"
                    : "Add a Stripe Invoice ID above for auto-unlock, or toggle manually"}
                </div>
              </div>
              <button onClick={() => {
                toggleInvoicePaid(mediaModal.id, mediaModal.invoice_paid);
                setMediaModal({ ...mediaModal, invoice_paid: !mediaModal.invoice_paid });
              }} style={{
                ...btnBase,
                background: mediaModal.invoice_paid ? "rgba(231,76,60,0.12)" : "rgba(39,174,96,0.12)",
                border: `1px solid ${mediaModal.invoice_paid ? "rgba(231,76,60,0.3)" : "rgba(39,174,96,0.3)"}`,
                color: mediaModal.invoice_paid ? "#e74c3c" : "#27ae60",
              }}>{mediaModal.invoice_paid ? "Mark Unpaid" : "Mark Paid"}</button>
            </div>
          </div>
        )}

        {/* Agent: Payment Required Notice */}
        {!isAdmin && !mediaModal.invoice_paid && (
          <div style={{
            background: "rgba(231,76,60,0.06)", border: "1px solid rgba(231,76,60,0.2)",
            borderRadius: 12, padding: 20, marginBottom: 16, textAlign: "center",
          }}>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 14, color: "#e74c3c", marginBottom: 6 }}>
              Media downloads are locked until your invoice is paid.
            </div>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
              Please complete payment to access your photos, videos, and tours.
            </div>
          </div>
        )}

        {/* Admin: Upload Zone */}
        {isAdmin && (
          <div style={{
            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12, padding: 20, marginBottom: 16,
          }}>
            <div style={sectionHeader()}>Upload Photos & Videos</div>
            <div
              style={dropZoneSt}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); handleFileUpload(Array.from(e.dataTransfer.files)); }}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,video/*"
                style={{ display: "none" }}
                onChange={e => { handleFileUpload(Array.from(e.target.files)); e.target.value = ""; }}
              />
              {uploading ? (
                <div style={{ fontFamily: "'Jost', sans-serif", color: "#c9a84c", fontSize: 14 }}>
                  Uploading... Please wait
                </div>
              ) : (
                <>
                  <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 14, color: "rgba(255,255,255,0.6)", marginBottom: 6 }}>
                    Drag & drop photos or videos here
                  </div>
                  <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.3)" }}>
                    or click to browse — JPG, PNG, WebP, MP4, MOV
                  </div>
                </>
              )}
            </div>

            <div style={sectionHeader()}>Add 3D Tour Link</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr auto", gap: 8, alignItems: "end" }}>
              <div>
                <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Label</div>
                <input
                  value={tourLabel}
                  onChange={e => setTourLabel(e.target.value)}
                  placeholder="e.g. Matterport Tour"
                  style={inputSt}
                />
              </div>
              <div>
                <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Tour URL</div>
                <input
                  value={tourUrl}
                  onChange={e => setTourUrl(e.target.value)}
                  placeholder="https://my.matterport.com/show/?m=..."
                  style={inputSt}
                />
              </div>
              <button onClick={addTourLink} style={{
                ...btnBase, padding: "10px 18px",
                background: "rgba(78,205,196,0.12)", border: "1px solid rgba(78,205,196,0.3)", color: "#4ecdc4",
              }}>Add Tour</button>
            </div>
          </div>
        )}

        {/* Media Gallery */}
        {mediaLoading ? (
          <div style={{ color: "rgba(255,255,255,0.4)", fontFamily: "'Jost', sans-serif", padding: 20, textAlign: "center" }}>Loading media...</div>
        ) : mediaFiles.length === 0 ? (
          <div style={{
            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12, padding: 40, textAlign: "center",
          }}>
            <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 14, color: "rgba(255,255,255,0.4)" }}>
              No media uploaded yet.
            </div>
          </div>
        ) : (
          <>
            {/* Admin: Bulk Select Toolbar */}
            {isAdmin && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                {!selectMode ? (
                  <button onClick={() => { setSelectMode(true); setSelectedMedia(new Set()); }} style={{
                    ...btnBase, padding: "6px 14px", fontSize: 11,
                    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.7)",
                  }}>☑ Select</button>
                ) : (
                  <>
                    <button onClick={() => setSelectedMedia(new Set(mediaFiles.map(m => m.id)))} style={{
                      ...btnBase, padding: "6px 14px", fontSize: 11,
                      background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.7)",
                    }}>Select All ({mediaFiles.length})</button>
                    <button onClick={() => setSelectedMedia(new Set())} style={{
                      ...btnBase, padding: "6px 14px", fontSize: 11,
                      background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.5)",
                    }}>Deselect All</button>
                    {selectedMedia.size > 0 && (
                      <button onClick={deleteSelectedMedia} style={{
                        ...btnBase, padding: "6px 14px", fontSize: 11,
                        background: "rgba(231,76,60,0.15)", border: "1px solid rgba(231,76,60,0.4)", color: "#e74c3c", fontWeight: 600,
                      }}>🗑 Delete Selected ({selectedMedia.size})</button>
                    )}
                    <button onClick={() => { setSelectMode(false); setSelectedMedia(new Set()); }} style={{
                      ...btnBase, padding: "6px 14px", fontSize: 11,
                      background: "transparent", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)",
                    }}>Cancel</button>
                  </>
                )}
              </div>
            )}

            {/* Download All ZIP button (for agents with paid invoice, or admin) */}
            {canDownload && mediaFiles.some(m => m.file_path || m.file_type === "3d_tour") && (
              <button
                onClick={downloadAllMedia}
                disabled={!!zipProgress}
                style={{
                  ...btnBase, padding: "10px 22px", marginBottom: 16,
                  background: zipProgress
                    ? "rgba(201,168,76,0.25)"
                    : "linear-gradient(135deg, #C9A84C 0%, #e8c97a 100%)",
                  border: zipProgress ? "1px solid rgba(201,168,76,0.3)" : "none",
                  color: zipProgress ? "#c9a84c" : "#0a1628",
                  fontWeight: 600, cursor: zipProgress ? "not-allowed" : "pointer",
                  display: "flex", alignItems: "center", gap: 8,
                }}
              >
                {zipProgress ? (
                  <>
                    <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⟳</span>
                    Packaging {zipProgress.done}/{zipProgress.total} files…
                  </>
                ) : (
                  <>⬇ Download ZIP (MLS Ready)</>
                )}
              </button>
            )}
            {/* Spinner keyframe */}
            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

            {/* Photos Section — drag to reorder */}
            {photos.length > 0 && (
              <div style={{
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 12, padding: 20, marginBottom: 16,
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={sectionHeader()}>Photos ({photos.length})</div>
                  <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.3)", letterSpacing: "0.06em" }}>
                    ⠿ Drag to reorder
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {photos.map((p, idx) => (
                    <div
                      key={p.id}
                      draggable={!selectMode}
                      onDragStart={() => !selectMode && handlePhotoDragStart(idx)}
                      onDragEnter={() => !selectMode && handlePhotoDragEnter(idx)}
                      onDragOver={e => e.preventDefault()}
                      onDrop={handlePhotoDrop}
                      onDragEnd={() => { dragPhotoIdx.current = null; dragOverPhotoIdx.current = null; }}
                      onClick={() => selectMode && toggleSelectItem(p.id)}
                      style={{
                        position: "relative", display: "inline-block",
                        cursor: selectMode ? "pointer" : "grab", transition: "opacity 0.15s",
                        outline: selectMode && selectedMedia.has(p.id) ? "2px solid #c9a84c" : "none",
                        borderRadius: 9,
                      }}
                    >
                      {/* Select mode checkbox */}
                      {selectMode && (
                        <div style={{
                          position: "absolute", top: 4, right: 4, zIndex: 3,
                          width: 18, height: 18, borderRadius: 4,
                          background: selectedMedia.has(p.id) ? "#c9a84c" : "rgba(0,0,0,0.6)",
                          border: selectedMedia.has(p.id) ? "2px solid #c9a84c" : "2px solid rgba(255,255,255,0.4)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 11, color: "#0a1628", fontWeight: 700,
                        }}>{selectedMedia.has(p.id) ? "✓" : ""}</div>
                      )}
                      {/* Order badge */}
                      <div style={{
                        position: "absolute", top: 4, left: 4, zIndex: 2,
                        background: "rgba(0,0,0,0.7)", color: "#C9A84C",
                        fontFamily: "'Jost', sans-serif", fontSize: 9, fontWeight: 700,
                        padding: "1px 5px", borderRadius: 3, letterSpacing: "0.04em",
                      }}>{idx + 1}</div>
                      <img
                        src={p.thumb_url || p.signed_url || "#"}
                        alt={p.file_name}
                        loading="lazy"
                        decoding="async"
                        width={80}
                        height={80}
                        onClick={() => !selectMode && openLightbox(idx)}
                        style={{ ...thumbSt, display: "block", opacity: selectMode && selectedMedia.has(p.id) ? 0.75 : 1, cursor: selectMode ? "default" : "zoom-in" }}
                        draggable={false}
                      />
                      <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 4, maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.file_name}
                      </div>
                      {!selectMode && (
                        <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                          {canDownload && (
                            <button onClick={() => downloadSingleFile(p)} style={{
                              ...btnBase, padding: "2px 8px", fontSize: 9,
                              background: "rgba(201,168,76,0.12)", border: "1px solid rgba(201,168,76,0.2)", color: "#c9a84c",
                            }}>Download</button>
                          )}
                          {isAdmin && (
                            <button onClick={() => deleteMedia(p)} style={{
                              ...btnBase, padding: "2px 8px", fontSize: 9,
                              background: "rgba(231,76,60,0.08)", border: "1px solid rgba(231,76,60,0.15)", color: "#e74c3c",
                            }}>×</button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Videos Section */}
            {videos.length > 0 && (
              <div style={{
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 12, padding: 20, marginBottom: 16,
              }}>
                <div style={sectionHeader()}>Videos ({videos.length})</div>
                {videos.map(v => (
                  <div key={v.id}
                    onClick={() => selectMode && toggleSelectItem(v.id)}
                    style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.05)",
                      cursor: selectMode ? "pointer" : "default",
                      background: selectMode && selectedMedia.has(v.id) ? "rgba(201,168,76,0.06)" : "transparent",
                      borderRadius: 6, paddingLeft: selectMode ? 6 : 0,
                    }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      {selectMode && (
                        <div style={{
                          width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                          background: selectedMedia.has(v.id) ? "#c9a84c" : "rgba(0,0,0,0.4)",
                          border: selectedMedia.has(v.id) ? "2px solid #c9a84c" : "2px solid rgba(255,255,255,0.3)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 11, color: "#0a1628", fontWeight: 700,
                        }}>{selectedMedia.has(v.id) ? "✓" : ""}</div>
                      )}
                      <div style={{
                        width: 40, height: 40, borderRadius: 8, background: "rgba(78,205,196,0.1)",
                        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
                      }}>🎬</div>
                      <div>
                        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "#fff" }}>{v.file_name}</div>
                        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
                          {v.file_size ? `${(v.file_size / 1048576).toFixed(1)} MB` : "Video"}
                        </div>
                      </div>
                    </div>
                    {!selectMode && (
                      <div style={{ display: "flex", gap: 6 }}>
                        {canDownload && (
                          <button onClick={() => downloadSingleFile(v)} style={{
                            ...btnBase,
                            background: "rgba(201,168,76,0.12)", border: "1px solid rgba(201,168,76,0.2)", color: "#c9a84c",
                          }}>Download</button>
                        )}
                        {isAdmin && (
                          <button onClick={() => deleteMedia(v)} style={{
                            ...btnBase,
                            background: "rgba(231,76,60,0.08)", border: "1px solid rgba(231,76,60,0.15)", color: "#e74c3c",
                          }}>Delete</button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* 3D Tours Section */}
            {tours.length > 0 && (
              <div style={{
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 12, padding: 20, marginBottom: 16,
              }}>
                <div style={sectionHeader()}>3D Tours ({tours.length})</div>
                {tours.map(t => (
                  <div key={t.id}
                    onClick={() => selectMode && toggleSelectItem(t.id)}
                    style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.05)",
                      cursor: selectMode ? "pointer" : "default",
                      background: selectMode && selectedMedia.has(t.id) ? "rgba(201,168,76,0.06)" : "transparent",
                      borderRadius: 6, paddingLeft: selectMode ? 6 : 0,
                    }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      {selectMode && (
                        <div style={{
                          width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                          background: selectedMedia.has(t.id) ? "#c9a84c" : "rgba(0,0,0,0.4)",
                          border: selectedMedia.has(t.id) ? "2px solid #c9a84c" : "2px solid rgba(255,255,255,0.3)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 11, color: "#0a1628", fontWeight: 700,
                        }}>{selectedMedia.has(t.id) ? "✓" : ""}</div>
                      )}
                      <div style={{
                        width: 40, height: 40, borderRadius: 8, background: "rgba(201,168,76,0.1)",
                        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
                      }}>🏠</div>
                      <div>
                        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "#fff" }}>{t.file_name}</div>
                        <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.3)", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {t.tour_url}
                        </div>
                      </div>
                    </div>
                    {!selectMode && (
                      <div style={{ display: "flex", gap: 6 }}>
                        {canDownload && (
                          <button onClick={() => window.open(t.tour_url, "_blank")} style={{
                            ...btnBase,
                            background: "rgba(78,205,196,0.12)", border: "1px solid rgba(78,205,196,0.3)", color: "#4ecdc4",
                          }}>Open Tour</button>
                        )}
                        {isAdmin && (
                          <button onClick={() => deleteMedia(t)} style={{
                            ...btnBase,
                            background: "rgba(231,76,60,0.08)", border: "1px solid rgba(231,76,60,0.15)", color: "#e74c3c",
                          }}>Delete</button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── Lightbox ── */}
        {lightboxIndex !== null && (() => {
          const photo = photos[lightboxIndex];
          return (
            <div
              onClick={() => setLightboxIndex(null)}
              style={{
                position: "fixed", inset: 0, zIndex: 9999,
                background: "rgba(0,0,0,0.92)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              {/* Prev */}
              <button onClick={e => { e.stopPropagation(); lightboxNav(-1); }} style={{
                position: "absolute", left: 20, top: "50%", transform: "translateY(-50%)",
                background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: "50%", width: 48, height: 48, fontSize: 22, color: "#fff",
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              }}>‹</button>

              {/* Image */}
              <div onClick={e => e.stopPropagation()} style={{ maxWidth: "90vw", maxHeight: "90vh", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                {lightboxUrl ? (
                  <img src={lightboxUrl} alt={photo?.file_name}
                    style={{ maxWidth: "88vw", maxHeight: "82vh", objectFit: "contain", borderRadius: 8, boxShadow: "0 8px 40px rgba(0,0,0,0.6)" }} />
                ) : (
                  <div style={{ width: 60, height: 60, border: "3px solid rgba(201,168,76,0.4)", borderTopColor: "#c9a84c", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                )}
                <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "rgba(255,255,255,0.5)", textAlign: "center" }}>
                  {lightboxIndex + 1} / {photos.length} &nbsp;·&nbsp; {photo?.file_name}
                </div>
              </div>

              {/* Next */}
              <button onClick={e => { e.stopPropagation(); lightboxNav(1); }} style={{
                position: "absolute", right: 20, top: "50%", transform: "translateY(-50%)",
                background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: "50%", width: 48, height: 48, fontSize: 22, color: "#fff",
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              }}>›</button>

              {/* Close */}
              <button onClick={() => setLightboxIndex(null)} style={{
                position: "absolute", top: 16, right: 16,
                background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: "50%", width: 36, height: 36, fontSize: 18, color: "#fff",
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              }}>✕</button>
            </div>
          );
        })()}
      </div>
    );
  }

  // ——— Edit Modal ———
  if (editingBooking) {
    const b = editingBooking;
    const set = (key, val) => setEditingBooking({ ...b, [key]: val });
    const inputSt = {
      width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
      borderRadius: 8, padding: "10px 12px", color: "#fff", fontFamily: "'Jost', sans-serif", fontSize: 13,
      outline: "none", boxSizing: "border-box",
    };
    const fieldLabel = { ...labelSt, marginTop: 14 };
    const pkgOpts = ["essential", "signature", "luxury"];
    const tierOpts = [
      { value: "under_1500", label: "Under 1,500 sf" },
      { value: "1501_2500", label: "1,501 – 2,500 sf" },
      { value: "2501_3500", label: "2,501 – 3,500 sf" },
      { value: "3501_4500", label: "3,501 – 4,500 sf" },
      { value: "over_4501", label: "Over 4,501 sf" },
    ];
    const timeSlots = ["9:00 AM","10:00 AM","11:00 AM","12:00 PM","1:00 PM","2:00 PM","3:00 PM","4:00 PM"];

    return (
      <div style={{ padding: "32px 24px", maxWidth: 700, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, color: "#c9a84c" }}>Edit Booking</div>
          <button onClick={() => setEditingBooking(null)} style={{
            background: "transparent", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8,
            padding: "8px 16px", color: "rgba(255,255,255,0.6)", fontFamily: "'Jost', sans-serif",
            fontSize: 12, cursor: "pointer", letterSpacing: "0.06em",
          }}>← Back</button>
        </div>

        {/* Contact */}
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 20, marginBottom: 16 }}>
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#c9a84c", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Contact Information</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={fieldLabel}>Full Name</div>
              <input value={b.client_name || ""} onChange={e => set("client_name", e.target.value)} style={inputSt} />
            </div>
            <div>
              <div style={fieldLabel}>Phone</div>
              <input value={b.client_phone || ""} onChange={e => set("client_phone", e.target.value)} style={inputSt} />
            </div>
          </div>
          <div style={fieldLabel}>Email</div>
          <input value={b.client_email || ""} onChange={e => set("client_email", e.target.value)} style={inputSt} />
        </div>

        {/* Property */}
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 20, marginBottom: 16 }}>
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#c9a84c", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Property Details</div>
          <div style={fieldLabel}>Street Address</div>
          <input value={b.address || ""} onChange={e => set("address", e.target.value)} style={inputSt} />
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }}>
            <div>
              <div style={fieldLabel}>City</div>
              <input value={b.city || ""} onChange={e => set("city", e.target.value)} style={inputSt} />
            </div>
            <div>
              <div style={fieldLabel}>State</div>
              <input value={b.state || ""} onChange={e => set("state", e.target.value)} style={inputSt} />
            </div>
            <div>
              <div style={fieldLabel}>Zip</div>
              <input value={b.zip || ""} onChange={e => set("zip", e.target.value)} style={inputSt} />
            </div>
          </div>
          <div style={fieldLabel}>Property Size</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {tierOpts.map(t => (
              <button key={t.value} onClick={() => set("sqft_tier", t.value)} style={{
                background: b.sqft_tier === t.value ? "rgba(201,168,76,0.15)" : "rgba(255,255,255,0.03)",
                border: b.sqft_tier === t.value ? "1px solid rgba(201,168,76,0.4)" : "1px solid rgba(255,255,255,0.08)",
                borderRadius: 6, padding: "6px 12px", color: b.sqft_tier === t.value ? "#c9a84c" : "rgba(255,255,255,0.5)",
                fontFamily: "'Jost', sans-serif", fontSize: 11, cursor: "pointer",
              }}>{t.label}</button>
            ))}
          </div>
          <div style={fieldLabel}>Method of Access</div>
          <input value={b.access_method || ""} onChange={e => set("access_method", e.target.value)} style={inputSt} />
        </div>

        {/* Services */}
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 20, marginBottom: 16 }}>
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#c9a84c", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Services</div>
          <div style={fieldLabel}>Package</div>
          <div style={{ display: "flex", gap: 8 }}>
            {pkgOpts.map(p => (
              <button key={p} onClick={() => set("selected_package", p)} style={{
                background: b.selected_package === p ? "rgba(201,168,76,0.15)" : "rgba(255,255,255,0.03)",
                border: b.selected_package === p ? "1px solid rgba(201,168,76,0.4)" : "1px solid rgba(255,255,255,0.08)",
                borderRadius: 6, padding: "8px 18px", color: b.selected_package === p ? "#c9a84c" : "rgba(255,255,255,0.5)",
                fontFamily: "'Jost', sans-serif", fontSize: 12, cursor: "pointer", textTransform: "capitalize",
              }}>{p}</button>
            ))}
            <button onClick={() => set("selected_package", null)} style={{
              background: !b.selected_package ? "rgba(201,168,76,0.15)" : "rgba(255,255,255,0.03)",
              border: !b.selected_package ? "1px solid rgba(201,168,76,0.4)" : "1px solid rgba(255,255,255,0.08)",
              borderRadius: 6, padding: "8px 18px", color: !b.selected_package ? "#c9a84c" : "rgba(255,255,255,0.5)",
              fontFamily: "'Jost', sans-serif", fontSize: 12, cursor: "pointer",
            }}>Individual</button>
          </div>
          <div style={fieldLabel}>Subtotal ($)</div>
          <input type="number" value={b.subtotal || 0} onChange={e => set("subtotal", Number(e.target.value))} style={{ ...inputSt, width: 160 }} />
        </div>

        {/* Schedule */}
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 20, marginBottom: 24 }}>
          <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#c9a84c", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Schedule</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={fieldLabel}>Date</div>
              <input type="date" value={b.booking_date || ""} onChange={e => set("booking_date", e.target.value)} style={inputSt} />
            </div>
            <div>
              <div style={fieldLabel}>Time</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {timeSlots.map(t => (
                  <button key={t} onClick={() => set("booking_time", t)} style={{
                    background: b.booking_time === t ? "rgba(201,168,76,0.15)" : "rgba(255,255,255,0.03)",
                    border: b.booking_time === t ? "1px solid rgba(201,168,76,0.4)" : "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 6, padding: "4px 10px", color: b.booking_time === t ? "#c9a84c" : "rgba(255,255,255,0.5)",
                    fontFamily: "'Jost', sans-serif", fontSize: 11, cursor: "pointer",
                  }}>{t}</button>
                ))}
              </div>
            </div>
          </div>
          {isAdmin && (
            <>
              <div style={fieldLabel}>Status</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {["confirmed", "in_progress", "completed", "cancelled"].map(s => (
                  <button key={s} onClick={() => set("status", s)} style={{
                    background: b.status === s ? `${statusColors[s]}22` : "rgba(255,255,255,0.03)",
                    border: `1px solid ${b.status === s ? statusColors[s] : "rgba(255,255,255,0.08)"}`,
                    borderRadius: 6, padding: "6px 14px", color: b.status === s ? statusColors[s] : "rgba(255,255,255,0.5)",
                    fontFamily: "'Jost', sans-serif", fontSize: 11, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.06em",
                  }}>{s.replace("_", " ")}</button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Save / Cancel buttons */}
        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={() => saveBooking(b)} disabled={saving} style={{
            flex: 1, background: saving ? "rgba(201,168,76,0.3)" : "linear-gradient(135deg, #C9A84C 0%, #e8c97a 100%)",
            border: "none", borderRadius: 8, padding: "14px 24px", color: "#0a1628",
            fontFamily: "'Jost', sans-serif", fontWeight: 600, fontSize: 13, cursor: saving ? "wait" : "pointer",
            letterSpacing: "0.1em", textTransform: "uppercase",
          }}>{saving ? "Saving..." : "Save Changes"}</button>
          <button onClick={() => setEditingBooking(null)} style={{
            background: "transparent", border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 8, padding: "14px 24px", color: "rgba(255,255,255,0.6)",
            fontFamily: "'Jost', sans-serif", fontSize: 13, cursor: "pointer", letterSpacing: "0.06em",
          }}>Discard</button>
        </div>
      </div>
    );
  }

  // ——— Bookings List ———
  return (
    <div style={{ padding: "32px 24px", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 32, color: "#c9a84c", marginBottom: 8 }}>
        {isAdmin ? "All Bookings" : "My Bookings"}
      </div>
      <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "rgba(255,255,255,0.5)", marginBottom: 24 }}>
        {bookings.length} booking{bookings.length !== 1 ? "s" : ""}
      </div>

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
        {["all", "confirmed", "in_progress", "completed", "cancelled"].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            background: filter === f ? "rgba(201,168,76,0.15)" : "rgba(255,255,255,0.03)",
            border: filter === f ? "1px solid rgba(201,168,76,0.4)" : "1px solid rgba(255,255,255,0.08)",
            borderRadius: 20, padding: "6px 16px", color: filter === f ? "#c9a84c" : "rgba(255,255,255,0.5)",
            fontFamily: "'Jost', sans-serif", fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase",
            cursor: "pointer",
          }}>{f.replace("_", " ")}</button>
        ))}
      </div>

      {loading && <div style={{ color: "rgba(255,255,255,0.4)", fontFamily: "'Jost', sans-serif" }}>Loading...</div>}

      {!loading && filtered.length === 0 && (
        <div style={{ color: "rgba(255,255,255,0.4)", fontFamily: "'Jost', sans-serif", textAlign: "center", padding: 40 }}>
          No bookings found.
        </div>
      )}

      {filtered.map(b => (
        <div key={b.id} style={{
          ...cardStyle,
          borderLeft: b.status === "cancelled" ? "3px solid #e74c3c" : cardStyle.border,
          opacity: b.status === "cancelled" ? 0.65 : 1,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: "#fff" }}>{b.client_name}</div>
                {b.source === "website" && (
                  <span style={{ background: "rgba(90,160,255,0.12)", color: "#5aa0ff", padding: "2px 8px", borderRadius: 8, fontFamily: "'Jost', sans-serif", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" }}>website</span>
                )}
              </div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{b.client_email} {b.client_phone ? `· ${b.client_phone}` : ""}</div>
            </div>
            <span style={{
              background: `${statusColors[b.status] || "#888"}22`,
              color: statusColors[b.status] || "#888",
              padding: "4px 12px", borderRadius: 12,
              fontFamily: "'Jost', sans-serif", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase",
              textDecoration: b.status === "cancelled" ? "line-through" : "none",
            }}>{b.status?.replace("_", " ") || "pending"}</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <div style={labelSt}>Property</div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "#fff" }}>{b.address}</div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{b.city}, {b.state} {b.zip}</div>
            </div>
            <div>
              <div style={labelSt}>Schedule</div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "#fff" }}>{b.booking_date}</div>
              <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{b.booking_time}</div>
            </div>
            <div>
              <div style={labelSt}>Total</div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: "#c9a84c", fontWeight: 700 }}>${Number(b.subtotal || 0).toLocaleString()}</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <div style={labelSt}>
              {b.booking_mode === "package" ? `${b.selected_package} package` : `${(b.selected_services || []).length} services`}
              {" · "}{b.sqft_tier?.replace("_", "-").replace("under", "<").replace("over", ">")} sf
            </div>
          </div>

          {/* Action buttons */}
          {b.status !== "cancelled" && b.status !== "completed" && (
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <button onClick={() => setEditingBooking({ ...b })} style={{
                ...btnBase,
                background: "rgba(201,168,76,0.12)", border: "1px solid rgba(201,168,76,0.3)", color: "#c9a84c",
              }}>Edit</button>
              {isAdmin && b.status === "confirmed" && (
                <button onClick={() => updateStatus(b.id, "in_progress")} style={{
                  ...btnBase,
                  background: "rgba(78,205,196,0.15)", border: "1px solid rgba(78,205,196,0.3)", color: "#4ecdc4",
                }}>Start</button>
              )}
              {isAdmin && b.status === "in_progress" && (
                <button onClick={() => updateStatus(b.id, "completed")} style={{
                  ...btnBase,
                  background: "rgba(39,174,96,0.15)", border: "1px solid rgba(39,174,96,0.3)", color: "#27ae60",
                }}>Mark Complete</button>
              )}
              {cancelConfirm === b.id ? (
                <>
                  <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 12, color: "#e74c3c", padding: "6px 0", alignSelf: "center" }}>Are you sure?</span>
                  <button onClick={() => updateStatus(b.id, "cancelled")} style={{
                    ...btnBase,
                    background: "rgba(231,76,60,0.2)", border: "1px solid rgba(231,76,60,0.4)", color: "#e74c3c",
                  }}>Yes, Cancel</button>
                  <button onClick={() => setCancelConfirm(null)} style={{
                    ...btnBase,
                    background: "transparent", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.5)",
                  }}>No</button>
                </>
              ) : (
                <button onClick={() => setCancelConfirm(b.id)} style={{
                  ...btnBase,
                  background: "rgba(231,76,60,0.08)", border: "1px solid rgba(231,76,60,0.2)", color: "#e74c3c",
                }}>Cancel Booking</button>
              )}
              {/* Admin: Upload Media button */}
              {isAdmin && (
                <button onClick={() => openMediaModal(b)} style={{
                  ...btnBase,
                  background: "rgba(155,89,182,0.12)", border: "1px solid rgba(155,89,182,0.3)", color: "#9b59b6",
                }}>Upload Media</button>
              )}
            </div>
          )}

          {/* Media button row — always visible (even for completed/cancelled bookings) */}
          {b.status === "completed" && (
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              {isAdmin && (
                <>
                  <button onClick={() => openMediaModal(b)} style={{
                    ...btnBase,
                    background: "rgba(201,168,76,0.12)", border: "1px solid rgba(201,168,76,0.3)", color: "#c9a84c",
                  }}>View Media</button>
                  <button onClick={() => openMediaModal(b)} style={{
                    ...btnBase,
                    background: "rgba(155,89,182,0.12)", border: "1px solid rgba(155,89,182,0.3)", color: "#9b59b6",
                  }}>Upload Media</button>
                </>
              )}
            </div>
          )}

          {/* Agent: Download Media button */}
          {!isAdmin && (
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
              {b.invoice_paid ? (
                <button onClick={() => openMediaModal(b)} style={{
                  ...btnBase,
                  background: "linear-gradient(135deg, #C9A84C 0%, #e8c97a 100%)",
                  border: "none", color: "#0a1628", fontWeight: 600,
                }}>Download Media</button>
              ) : (
                <>
                  <button onClick={() => openMediaModal(b)} style={{
                    ...btnBase,
                    background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.3)",
                  }}>View Media</button>
                  <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "rgba(231,76,60,0.7)" }}>
                    🔒 Invoice payment required
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default BookingsManagerView;
