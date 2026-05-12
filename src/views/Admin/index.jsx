import { useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { useAuth } from "../../lib/auth";

// ADMIN VIEW — Property Creation & Management
// ============================================================
function AdminView() {
  const { user } = useAuth();
  const [listings, setListings] = useState([]);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 768);

  const [formData, setFormData] = useState({
    address: "",
    city: "Dallas, TX",
    price: "",
    beds: "",
    baths: "",
    sqft: "",
    package: "Signature",
    status: "In Production",
    agent_id: "",
    description: "",
    hero_img: "",
    matterport_url: "",
    youtube_url: "",
  });

  const [selectedListing, setSelectedListing] = useState(null);
  const [mediaFiles, setMediaFiles] = useState({});
  const [mediaLoading, setMediaLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({});
  const [micrositeRequests, setMicrositeRequests] = useState([]);

  const fetchMicrositeRequests = async () => {
    const { data: reqs } = await supabase
      .from("microsite_requests")
      .select("*, listings(address, city, package), agents:agent_id(full_name)")
      .order("created_at", { ascending: false });
    if (reqs) setMicrositeRequests(reqs);
  };

  const handleApproveAddon = async (requestId, listingId) => {
    // Approve the request
    await supabase.from("microsite_requests").update({
      status: "approved", resolved_at: new Date().toISOString(), resolved_by: user?.id,
    }).eq("id", requestId);
    // Enable microsite_addon on the listing
    await supabase.from("listings").update({ microsite_addon: true }).eq("id", listingId);
    fetchMicrositeRequests();
    fetchListingsAndAgents();
  };

  const handleDenyAddon = async (requestId) => {
    await supabase.from("microsite_requests").update({
      status: "denied", resolved_at: new Date().toISOString(), resolved_by: user?.id,
    }).eq("id", requestId);
    fetchMicrositeRequests();
  };

  // Fetch listings and agents on mount
  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth >= 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    fetchListingsAndAgents();
    fetchMicrositeRequests();
  }, []);

  const fetchListingsAndAgents = async () => {
    setLoading(true);
    try {
      // Fetch agents
      const { data: agentsData, error: agentsError } = await supabase
        .from("agents")
        .select("id, full_name")
        .order("full_name");
      if (agentsError) throw agentsError;
      setAgents(agentsData || []);

      // Fetch listings with agent info
      const { data: listingsData, error: listingsError } = await supabase
        .from("listings")
        .select("*, agents(full_name)")
        .order("created_at", { ascending: false });
      if (listingsError) throw listingsError;
      setListings(listingsData || []);
    } catch (err) {
      setErrorMessage(`Error loading data: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const uploadFile = async (listingId, category, file) => {
    const filePath = `${listingId}/${category}/${file.name}`;
    try {
      const { data, error } = await supabase.storage
        .from('listing-media')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false,
        });
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage
        .from('listing-media')
        .getPublicUrl(filePath);
      return publicUrl;
    } catch (err) {
      throw new Error(`Upload failed: ${err.message}`);
    }
  };

  const listFiles = async (listingId, category) => {
    try {
      const { data, error } = await supabase.storage
        .from('listing-media')
        .list(`${listingId}/${category}/`, {
          limit: 100,
          sortBy: { column: 'name', order: 'asc' },
        });
      if (error) throw error;
      return data || [];
    } catch (err) {
      throw new Error(`List files failed: ${err.message}`);
    }
  };

  const deleteFile = async (listingId, category, fileName) => {
    try {
      const { error } = await supabase.storage
        .from('listing-media')
        .remove([`${listingId}/${category}/${fileName}`]);
      if (error) throw error;
    } catch (err) {
      throw new Error(`Delete failed: ${err.message}`);
    }
  };

  const loadMediaFiles = async (listingId) => {
    setMediaLoading(true);
    try {
      const photos = await listFiles(listingId, 'photos');
      const video = await listFiles(listingId, 'video');
      const floorplan = await listFiles(listingId, 'floorplan');
      setMediaFiles(prev => ({
        ...prev,
        [listingId]: { photos, video, floorplan },
      }));
    } catch (err) {
      setErrorMessage(err.message);
    } finally {
      setMediaLoading(false);
    }
  };

  const handleMediaUpload = async (listingId, category, files) => {
    setUploadProgress(prev => ({ ...prev, [listingId]: 'uploading' }));
    try {
      for (const file of files) {
        await uploadFile(listingId, category, file);
      }
      await loadMediaFiles(listingId);
      setUploadProgress(prev => ({ ...prev, [listingId]: 'done' }));
      setTimeout(() => setUploadProgress(prev => ({ ...prev, [listingId]: null })), 2000);
    } catch (err) {
      setErrorMessage(err.message);
      setUploadProgress(prev => ({ ...prev, [listingId]: null }));
    }
  };

  const handleMediaDelete = async (listingId, category, fileName) => {
    try {
      await deleteFile(listingId, category, fileName);
      await loadMediaFiles(listingId);
    } catch (err) {
      setErrorMessage(err.message);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      // Validate required fields
      if (!formData.address || !formData.price || !formData.beds || !formData.baths || !formData.sqft || !formData.agent_id) {
        throw new Error("Please fill in all required fields");
      }

      const { data, error } = await supabase
        .from("listings")
        .insert([
          {
            address: formData.address,
            city: formData.city,
            price: formData.price,
            beds: parseInt(formData.beds),
            baths: parseFloat(formData.baths),
            sqft: formData.sqft,
            package: formData.package,
            status: formData.status,
            agent_id: formData.agent_id,
            description: formData.description || null,
            hero_img: formData.hero_img || null,
            matterport_url: formData.matterport_url || null,
            youtube_url: formData.youtube_url || null,
            created_at: new Date().toISOString(),
          },
        ])
        .select();

      if (error) throw error;

      setSuccessMessage("Listing created successfully!");
      setFormData({
        address: "",
        city: "Dallas, TX",
        price: "",
        beds: "",
        baths: "",
        sqft: "",
        package: "Signature",
        status: "In Production",
        agent_id: "",
        description: "",
        hero_img: "",
        matterport_url: "",
        youtube_url: "",
      });

      // Refresh listings
      await fetchListingsAndAgents();

      // Clear success message after 3 seconds
      setTimeout(() => setSuccessMessage(""), 3000);
    } catch (err) {
      setErrorMessage(err.message || "Error creating listing");
    } finally {
      setSubmitting(false);
    }
  };

  const formInputStyle = {
    width: "100%",
    background: "#111827",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    padding: "12px 16px",
    color: "#F0EDE8",
    fontFamily: "'Jost', sans-serif",
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.2s",
  };

  const formFieldContainer = {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  };

  const labelStyle = {
    fontFamily: "'Jost', sans-serif",
    fontSize: 12,
    color: "#F0EDE8",
    fontWeight: 500,
  };

  const cardStyle = {
    background: "#111827",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 14,
    padding: 24,
    marginBottom: 16,
  };

  const pendingRequests = micrositeRequests.filter(r => r.status === "pending");

  const MicrositeRequestsSection = () => (
    <div style={{ marginBottom: 32 }}>
      <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 24, color: "#c9a84c", marginBottom: 16 }}>
        Microsite Add-on Requests
        {pendingRequests.length > 0 && (
          <span style={{
            display: "inline-block", marginLeft: 10, padding: "2px 10px",
            borderRadius: 12, fontSize: 11, fontFamily: "'Jost', sans-serif",
            fontWeight: 600, background: "rgba(239,68,68,0.15)", color: "#f87171",
            verticalAlign: "middle",
          }}>{pendingRequests.length} pending</span>
        )}
      </div>
      {micrositeRequests.length === 0 ? (
        <div style={{ color: "#8A8680", fontSize: 13, fontFamily: "'Jost', sans-serif", padding: "16px 0" }}>
          No microsite add-on requests yet.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {micrositeRequests.map(req => (
            <div key={req.id} style={{
              background: "#111827", border: `1px solid ${req.status === "pending" ? "rgba(201,168,76,0.3)" : "rgba(255,255,255,0.08)"}`,
              borderRadius: 12, padding: "14px 18px",
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 13, color: "#F0EDE8", fontWeight: 500 }}>
                  {req.listings?.address || "Unknown"} — {req.listings?.city || ""}
                </div>
                <div style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, color: "#8A8680", marginTop: 2 }}>
                  Agent: {req.agents?.full_name || "Unknown"} · Package: {req.listings?.package || "—"} · {new Date(req.created_at).toLocaleDateString()}
                </div>
              </div>
              {req.status === "pending" ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => handleApproveAddon(req.id, req.listing_id)} style={{
                    padding: "7px 16px", borderRadius: 8, border: "none", cursor: "pointer",
                    background: "rgba(74,222,128,0.15)", color: "#4ade80",
                    fontFamily: "'Jost', sans-serif", fontSize: 11, fontWeight: 600,
                  }}>Approve</button>
                  <button onClick={() => handleDenyAddon(req.id)} style={{
                    padding: "7px 16px", borderRadius: 8, border: "none", cursor: "pointer",
                    background: "rgba(239,68,68,0.1)", color: "#f87171",
                    fontFamily: "'Jost', sans-serif", fontSize: 11, fontWeight: 600,
                  }}>Deny</button>
                </div>
              ) : (
                <span style={{
                  padding: "4px 12px", borderRadius: 8, fontSize: 10, fontWeight: 600,
                  fontFamily: "'Jost', sans-serif", letterSpacing: "0.08em", textTransform: "uppercase",
                  background: req.status === "approved" ? "rgba(74,222,128,0.1)" : "rgba(239,68,68,0.1)",
                  color: req.status === "approved" ? "#4ade80" : "#f87171",
                }}>{req.status}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // Desktop layout: two columns
  if (isDesktop) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 40 }}>
        {/* LEFT: Requests + Listings */}
        <div>
          <MicrositeRequestsSection />

          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 24, color: "#c9a84c", marginBottom: 24 }}>
            Existing Listings
          </div>

          {loading ? (
            <div style={{ textAlign: "center", color: "#8A8680", padding: "40px 20px" }}>
              Loading listings...
            </div>
          ) : listings.length === 0 ? (
            <div style={{ textAlign: "center", color: "#8A8680", padding: "40px 20px" }}>
              No listings yet. Create one using the form on the right.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {listings.map((listing) => (
                <div
                  key={listing.id}
                  style={{
                    ...cardStyle,
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr 1fr",
                    gap: 16,
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div style={{ ...labelStyle, marginBottom: 4, color: "#8A8680" }}>Address</div>
                    <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 14, color: "#F0EDE8", fontWeight: 600 }}>
                      {listing.address}
                    </div>
                    <div style={{ fontSize: 11, color: "#8A8680", marginTop: 2 }}>{listing.city}</div>
                  </div>

                  <div>
                    <div style={{ ...labelStyle, marginBottom: 4, color: "#8A8680" }}>Package</div>
                    <div
                      style={{
                        display: "inline-block",
                        padding: "4px 10px",
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 600,
                        background: "rgba(201,168,76,0.1)",
                        color: "#c9a84c",
                        border: "1px solid rgba(201,168,76,0.3)",
                      }}
                    >
                      {listing.package}
                    </div>
                  </div>

                  <div>
                    <div style={{ ...labelStyle, marginBottom: 4, color: "#8A8680" }}>Status</div>
                    <div
                      style={{
                        display: "inline-block",
                        padding: "4px 10px",
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 600,
                        background: listing.status === "Live" ? "rgba(34,197,94,0.1)" : listing.status === "Archived" ? "rgba(107,114,128,0.1)" : "rgba(59,130,246,0.1)",
                        color: listing.status === "Live" ? "#22c55e" : listing.status === "Archived" ? "#6b7280" : "#3b82f6",
                        border: listing.status === "Live" ? "1px solid rgba(34,197,94,0.3)" : listing.status === "Archived" ? "1px solid rgba(107,114,128,0.3)" : "1px solid rgba(59,130,246,0.3)",
                      }}
                    >
                      {listing.status}
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div>
                      <div style={{ ...labelStyle, marginBottom: 4, color: "#8A8680" }}>Agent</div>
                      <div style={{ fontSize: 12, color: "#F0EDE8" }}>
                        {listing.agents?.full_name || "Unassigned"}
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setSelectedListing(selectedListing === listing.id ? null : listing.id);
                        if (selectedListing !== listing.id) {
                          loadMediaFiles(listing.id);
                        }
                      }}
                      style={{
                        background: selectedListing === listing.id ? "#c9a84c" : "rgba(201,168,76,0.1)",
                        color: selectedListing === listing.id ? "#0a0a0a" : "#c9a84c",
                        border: "1px solid rgba(201,168,76,0.3)",
                        padding: "6px 12px",
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: "pointer",
                        fontFamily: "'Jost', sans-serif",
                        transition: "all 0.2s",
                      }}
                    >
                      {selectedListing === listing.id ? "Hide Media" : "Manage Media"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Media Management Panel */}
          {selectedListing && (
            <div style={{
              ...cardStyle,
              marginTop: 24,
              background: "rgba(201,168,76,0.05)",
              border: "2px solid rgba(201,168,76,0.2)",
            }}>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: "#c9a84c", marginBottom: 20 }}>
                Media Management
              </div>

              {mediaLoading ? (
                <div style={{ color: "#8A8680", textAlign: "center", padding: "20px" }}>
                  Loading media files...
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  {/* Photos Section */}
                  <div>
                    <label style={{ ...labelStyle, display: "block", marginBottom: 12, color: "#c9a84c" }}>
                      📷 Photos
                    </label>
                    <div
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
                        if (files.length > 0) handleMediaUpload(selectedListing, 'photos', files);
                      }}
                      style={{
                        border: "2px dashed rgba(201,168,76,0.3)",
                        borderRadius: 8,
                        padding: 20,
                        textAlign: "center",
                        cursor: "pointer",
                        marginBottom: 12,
                        transition: "border-color 0.2s",
                      }}
                    >
                      <input
                        type="file"
                        multiple
                        accept="image/*"
                        onChange={(e) => handleMediaUpload(selectedListing, 'photos', Array.from(e.target.files))}
                        style={{ display: "none" }}
                        id={`photos-input-${selectedListing}`}
                      />
                      <label
                        htmlFor={`photos-input-${selectedListing}`}
                        style={{ cursor: "pointer", color: "#F0EDE8", fontSize: 12 }}
                      >
                        Click to upload photos or drag and drop
                      </label>
                    </div>
                    {mediaFiles[selectedListing]?.photos?.length > 0 && (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(60px, 1fr))", gap: 8 }}>
                        {mediaFiles[selectedListing].photos.map((file) => (
                          <div key={file.name} style={{ position: "relative", aspectRatio: "1" }}>
                            <img
                              src={supabase.storage.from('listing-media').getPublicUrl(`${selectedListing}/photos/${file.name}`).data.publicUrl}
                              alt={file.name}
                              style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 4 }}
                            />
                            <button
                              onClick={() => handleMediaDelete(selectedListing, 'photos', file.name)}
                              style={{
                                position: "absolute",
                                top: -8,
                                right: -8,
                                width: 24,
                                height: 24,
                                background: "#f87171",
                                color: "#fff",
                                border: "none",
                                borderRadius: "50%",
                                cursor: "pointer",
                                fontSize: 14,
                                fontWeight: "bold",
                              }}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Video Section */}
                  <div>
                    <label style={{ ...labelStyle, display: "block", marginBottom: 12, color: "#c9a84c" }}>
                      🎬 Video File
                    </label>
                    <input
                      type="file"
                      accept="video/*"
                      onChange={(e) => {
                        if (e.target.files.length > 0) {
                          handleMediaUpload(selectedListing, 'video', Array.from(e.target.files));
                        }
                      }}
                      style={formInputStyle}
                    />
                    {mediaFiles[selectedListing]?.video?.length > 0 && (
                      <div style={{ marginTop: 12, fontSize: 12, color: "#F0EDE8" }}>
                        <div>Uploaded: {mediaFiles[selectedListing].video[0].name}</div>
                        <button
                          onClick={() => handleMediaDelete(selectedListing, 'video', mediaFiles[selectedListing].video[0].name)}
                          style={{
                            marginTop: 8,
                            background: "#f87171",
                            color: "#fff",
                            border: "none",
                            padding: "4px 8px",
                            borderRadius: 4,
                            cursor: "pointer",
                            fontSize: 11,
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Floorplan Section */}
                  <div>
                    <label style={{ ...labelStyle, display: "block", marginBottom: 12, color: "#c9a84c" }}>
                      📐 Floorplan
                    </label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        if (e.target.files.length > 0) {
                          handleMediaUpload(selectedListing, 'floorplan', Array.from(e.target.files));
                        }
                      }}
                      style={formInputStyle}
                    />
                    {mediaFiles[selectedListing]?.floorplan?.length > 0 && (
                      <div style={{ marginTop: 12, fontSize: 12, color: "#F0EDE8" }}>
                        <div>Uploaded: {mediaFiles[selectedListing].floorplan[0].name}</div>
                        <button
                          onClick={() => handleMediaDelete(selectedListing, 'floorplan', mediaFiles[selectedListing].floorplan[0].name)}
                          style={{
                            marginTop: 8,
                            background: "#f87171",
                            color: "#fff",
                            border: "none",
                            padding: "4px 8px",
                            borderRadius: 4,
                            cursor: "pointer",
                            fontSize: 11,
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {uploadProgress[selectedListing] === 'uploading' && (
                <div style={{ marginTop: 12, color: "#c9a84c", fontSize: 12 }}>
                  Uploading...
                </div>
              )}
              {uploadProgress[selectedListing] === 'done' && (
                <div style={{ marginTop: 12, color: "#22c55e", fontSize: 12 }}>
                  Upload complete!
                </div>
              )}
            </div>
          )}
        </div>

        {/* RIGHT: Create Form (sticky) */}
        <div style={{ position: "sticky", top: 100, height: "fit-content" }}>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: "#c9a84c", marginBottom: 20 }}>
            Create New Listing
          </div>

          {successMessage && (
            <div style={{
              background: "rgba(34,197,94,0.1)",
              border: "1px solid rgba(34,197,94,0.3)",
              borderRadius: 8,
              padding: 12,
              marginBottom: 16,
              fontSize: 12,
              color: "#22c55e",
              fontFamily: "'Jost', sans-serif",
            }}>
              {successMessage}
            </div>
          )}

          {errorMessage && (
            <div style={{
              background: "rgba(248,113,113,0.1)",
              border: "1px solid rgba(248,113,113,0.3)",
              borderRadius: 8,
              padding: 12,
              marginBottom: 16,
              fontSize: 12,
              color: "#f87171",
              fontFamily: "'Jost', sans-serif",
            }}>
              {errorMessage}
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Address */}
            <div style={formFieldContainer}>
              <label style={labelStyle}>Address *</label>
              <input
                type="text"
                value={formData.address}
                onChange={(e) => handleInputChange("address", e.target.value)}
                placeholder="e.g., 2410 Prosperity Dr"
                style={formInputStyle}
              />
            </div>

            {/* City */}
            <div style={formFieldContainer}>
              <label style={labelStyle}>City *</label>
              <input
                type="text"
                value={formData.city}
                onChange={(e) => handleInputChange("city", e.target.value)}
                placeholder="Dallas, TX"
                style={formInputStyle}
              />
            </div>

            {/* Price */}
            <div style={formFieldContainer}>
              <label style={labelStyle}>Price *</label>
              <input
                type="text"
                value={formData.price}
                onChange={(e) => handleInputChange("price", e.target.value)}
                placeholder="$725,000"
                style={formInputStyle}
              />
            </div>

            {/* Beds & Baths */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={formFieldContainer}>
                <label style={labelStyle}>Beds *</label>
                <input
                  type="number"
                  value={formData.beds}
                  onChange={(e) => handleInputChange("beds", e.target.value)}
                  placeholder="4"
                  style={formInputStyle}
                />
              </div>
              <div style={formFieldContainer}>
                <label style={labelStyle}>Baths *</label>
                <input
                  type="number"
                  step="0.5"
                  value={formData.baths}
                  onChange={(e) => handleInputChange("baths", e.target.value)}
                  placeholder="3.5"
                  style={formInputStyle}
                />
              </div>
            </div>

            {/* Sqft */}
            <div style={formFieldContainer}>
              <label style={labelStyle}>Sqft *</label>
              <input
                type="text"
                value={formData.sqft}
                onChange={(e) => handleInputChange("sqft", e.target.value)}
                placeholder="3,840"
                style={formInputStyle}
              />
            </div>

            {/* Package */}
            <div style={formFieldContainer}>
              <label style={labelStyle}>Package *</label>
              <select
                value={formData.package}
                onChange={(e) => handleInputChange("package", e.target.value)}
                style={{ ...formInputStyle, cursor: "pointer" }}
              >
                <option value="Essential">Essential</option>
                <option value="Signature">Signature</option>
                <option value="Luxury">Luxury</option>
              </select>
            </div>

            {/* Status */}
            <div style={formFieldContainer}>
              <label style={labelStyle}>Status *</label>
              <select
                value={formData.status}
                onChange={(e) => handleInputChange("status", e.target.value)}
                style={{ ...formInputStyle, cursor: "pointer" }}
              >
                <option value="In Production">In Production</option>
                <option value="Delivered">Delivered</option>
                <option value="Live">Live</option>
                <option value="Archived">Archived</option>
              </select>
            </div>

            {/* Agent */}
            <div style={formFieldContainer}>
              <label style={labelStyle}>Agent *</label>
              <select
                value={formData.agent_id}
                onChange={(e) => handleInputChange("agent_id", e.target.value)}
                style={{ ...formInputStyle, cursor: "pointer" }}
              >
                <option value="">Select an agent...</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.full_name}
                  </option>
                ))}
              </select>
            </div>

            {/* Description */}
            <div style={formFieldContainer}>
              <label style={labelStyle}>Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => handleInputChange("description", e.target.value)}
                placeholder="Optional description..."
                style={{
                  ...formInputStyle,
                  minHeight: 80,
                  resize: "vertical",
                  fontFamily: "'Jost', sans-serif",
                }}
              />
            </div>

            {/* Hero Image URL */}
            <div style={formFieldContainer}>
              <label style={labelStyle}>Hero Image URL</label>
              <input
                type="text"
                value={formData.hero_img}
                onChange={(e) => handleInputChange("hero_img", e.target.value)}
                placeholder="https://..."
                style={formInputStyle}
              />
            </div>

            {/* Matterport URL */}
            <div style={formFieldContainer}>
              <label style={labelStyle}>Matterport URL</label>
              <input
                type="text"
                value={formData.matterport_url}
                onChange={(e) => handleInputChange("matterport_url", e.target.value)}
                placeholder="https://my.matterport.com/..."
                style={formInputStyle}
              />
            </div>

            {/* YouTube URL */}
            <div style={formFieldContainer}>
              <label style={labelStyle}>YouTube URL</label>
              <input
                type="text"
                value={formData.youtube_url}
                onChange={(e) => handleInputChange("youtube_url", e.target.value)}
                placeholder="https://youtube.com/watch?v=..."
                style={formInputStyle}
              />
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={submitting}
              style={{
                width: "100%",
                background: submitting ? "rgba(201,168,76,0.5)" : "#c9a84c",
                color: "#0a0a0a",
                border: "none",
                padding: 14,
                borderRadius: 8,
                fontFamily: "'Jost', sans-serif",
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                cursor: submitting ? "not-allowed" : "pointer",
                transition: "background 0.3s",
                marginTop: 8,
              }}
            >
              {submitting ? "Creating..." : "Create Listing"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Mobile layout: stacked
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      <MicrositeRequestsSection />

      {/* Form */}
      <div>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: "#c9a84c", marginBottom: 20 }}>
          Create New Listing
        </div>

        {successMessage && (
          <div style={{
            background: "rgba(34,197,94,0.1)",
            border: "1px solid rgba(34,197,94,0.3)",
            borderRadius: 8,
            padding: 12,
            marginBottom: 16,
            fontSize: 12,
            color: "#22c55e",
            fontFamily: "'Jost', sans-serif",
          }}>
            {successMessage}
          </div>
        )}

        {errorMessage && (
          <div style={{
            background: "rgba(248,113,113,0.1)",
            border: "1px solid rgba(248,113,113,0.3)",
            borderRadius: 8,
            padding: 12,
            marginBottom: 16,
            fontSize: 12,
            color: "#f87171",
            fontFamily: "'Jost', sans-serif",
          }}>
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Address */}
          <div style={formFieldContainer}>
            <label style={labelStyle}>Address *</label>
            <input
              type="text"
              value={formData.address}
              onChange={(e) => handleInputChange("address", e.target.value)}
              placeholder="e.g., 2410 Prosperity Dr"
              style={formInputStyle}
            />
          </div>

          {/* City */}
          <div style={formFieldContainer}>
            <label style={labelStyle}>City *</label>
            <input
              type="text"
              value={formData.city}
              onChange={(e) => handleInputChange("city", e.target.value)}
              placeholder="Dallas, TX"
              style={formInputStyle}
            />
          </div>

          {/* Price */}
          <div style={formFieldContainer}>
            <label style={labelStyle}>Price *</label>
            <input
              type="text"
              value={formData.price}
              onChange={(e) => handleInputChange("price", e.target.value)}
              placeholder="$725,000"
              style={formInputStyle}
            />
          </div>

          {/* Beds & Baths */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={formFieldContainer}>
              <label style={labelStyle}>Beds *</label>
              <input
                type="number"
                value={formData.beds}
                onChange={(e) => handleInputChange("beds", e.target.value)}
                placeholder="4"
                style={formInputStyle}
              />
            </div>
            <div style={formFieldContainer}>
              <label style={labelStyle}>Baths *</label>
              <input
                type="number"
                step="0.5"
                value={formData.baths}
                onChange={(e) => handleInputChange("baths", e.target.value)}
                placeholder="3.5"
                style={formInputStyle}
              />
            </div>
          </div>

          {/* Sqft */}
          <div style={formFieldContainer}>
            <label style={labelStyle}>Sqft *</label>
            <input
              type="text"
              value={formData.sqft}
              onChange={(e) => handleInputChange("sqft", e.target.value)}
              placeholder="3,840"
              style={formInputStyle}
            />
          </div>

          {/* Package */}
          <div style={formFieldContainer}>
            <label style={labelStyle}>Package *</label>
            <select
              value={formData.package}
              onChange={(e) => handleInputChange("package", e.target.value)}
              style={{ ...formInputStyle, cursor: "pointer" }}
            >
              <option value="Essential">Essential</option>
              <option value="Signature">Signature</option>
              <option value="Luxury">Luxury</option>
            </select>
          </div>

          {/* Status */}
          <div style={formFieldContainer}>
            <label style={labelStyle}>Status *</label>
            <select
              value={formData.status}
              onChange={(e) => handleInputChange("status", e.target.value)}
              style={{ ...formInputStyle, cursor: "pointer" }}
            >
              <option value="In Production">In Production</option>
              <option value="Delivered">Delivered</option>
              <option value="Live">Live</option>
              <option value="Archived">Archived</option>
            </select>
          </div>

          {/* Agent */}
          <div style={formFieldContainer}>
            <label style={labelStyle}>Agent *</label>
            <select
              value={formData.agent_id}
              onChange={(e) => handleInputChange("agent_id", e.target.value)}
              style={{ ...formInputStyle, cursor: "pointer" }}
            >
              <option value="">Select an agent...</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.full_name}
                </option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div style={formFieldContainer}>
            <label style={labelStyle}>Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => handleInputChange("description", e.target.value)}
              placeholder="Optional description..."
              style={{
                ...formInputStyle,
                minHeight: 80,
                resize: "vertical",
                fontFamily: "'Jost', sans-serif",
              }}
            />
          </div>

          {/* Hero Image URL */}
          <div style={formFieldContainer}>
            <label style={labelStyle}>Hero Image URL</label>
            <input
              type="text"
              value={formData.hero_img}
              onChange={(e) => handleInputChange("hero_img", e.target.value)}
              placeholder="https://..."
              style={formInputStyle}
            />
          </div>

          {/* Matterport URL */}
          <div style={formFieldContainer}>
            <label style={labelStyle}>Matterport URL</label>
            <input
              type="text"
              value={formData.matterport_url}
              onChange={(e) => handleInputChange("matterport_url", e.target.value)}
              placeholder="https://my.matterport.com/..."
              style={formInputStyle}
            />
          </div>

          {/* YouTube URL */}
          <div style={formFieldContainer}>
            <label style={labelStyle}>YouTube URL</label>
            <input
              type="text"
              value={formData.youtube_url}
              onChange={(e) => handleInputChange("youtube_url", e.target.value)}
              placeholder="https://youtube.com/watch?v=..."
              style={formInputStyle}
            />
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={submitting}
            style={{
              width: "100%",
              background: submitting ? "rgba(201,168,76,0.5)" : "#c9a84c",
              color: "#0a0a0a",
              border: "none",
              padding: 14,
              borderRadius: 8,
              fontFamily: "'Jost', sans-serif",
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              cursor: submitting ? "not-allowed" : "pointer",
              transition: "background 0.3s",
              marginTop: 8,
            }}
          >
            {submitting ? "Creating..." : "Create Listing"}
          </button>
        </form>
      </div>

      {/* Listings */}
      <div>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: "#c9a84c", marginBottom: 20 }}>
          Existing Listings
        </div>

        {loading ? (
          <div style={{ textAlign: "center", color: "#8A8680", padding: "40px 20px" }}>
            Loading listings...
          </div>
        ) : listings.length === 0 ? (
          <div style={{ textAlign: "center", color: "#8A8680", padding: "40px 20px" }}>
            No listings yet. Create one using the form above.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {listings.map((listing) => (
              <div key={listing.id} style={cardStyle}>
                <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 16, color: "#F0EDE8", fontWeight: 600, marginBottom: 12 }}>
                  {listing.address}
                </div>
                <div style={{ fontSize: 12, color: "#8A8680", marginBottom: 12 }}>
                  {listing.city}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 10, color: "#8A8680", marginBottom: 4 }}>Package</div>
                    <div
                      style={{
                        display: "inline-block",
                        padding: "3px 8px",
                        borderRadius: 4,
                        fontSize: 10,
                        fontWeight: 600,
                        background: "rgba(201,168,76,0.1)",
                        color: "#c9a84c",
                        border: "1px solid rgba(201,168,76,0.3)",
                      }}
                    >
                      {listing.package}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#8A8680", marginBottom: 4 }}>Status</div>
                    <div
                      style={{
                        display: "inline-block",
                        padding: "3px 8px",
                        borderRadius: 4,
                        fontSize: 10,
                        fontWeight: 600,
                        background: listing.status === "Live" ? "rgba(34,197,94,0.1)" : listing.status === "Archived" ? "rgba(107,114,128,0.1)" : "rgba(59,130,246,0.1)",
                        color: listing.status === "Live" ? "#22c55e" : listing.status === "Archived" ? "#6b7280" : "#3b82f6",
                        border: listing.status === "Live" ? "1px solid rgba(34,197,94,0.3)" : listing.status === "Archived" ? "1px solid rgba(107,114,128,0.3)" : "1px solid rgba(59,130,246,0.3)",
                      }}
                    >
                      {listing.status}
                    </div>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#8A8680", marginBottom: 4 }}>Agent</div>
                  <div style={{ fontSize: 12, color: "#F0EDE8" }}>
                    {listing.agents?.full_name || "Unassigned"}
                  </div>
                </div>
                <button
                  onClick={() => {
                    setSelectedListing(selectedListing === listing.id ? null : listing.id);
                    if (selectedListing !== listing.id) {
                      loadMediaFiles(listing.id);
                    }
                  }}
                  style={{
                    width: "100%",
                    background: selectedListing === listing.id ? "#c9a84c" : "rgba(201,168,76,0.1)",
                    color: selectedListing === listing.id ? "#0a0a0a" : "#c9a84c",
                    border: "1px solid rgba(201,168,76,0.3)",
                    padding: "8px 12px",
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "'Jost', sans-serif",
                    transition: "all 0.2s",
                    marginTop: 8,
                  }}
                >
                  {selectedListing === listing.id ? "Hide Media" : "Manage Media"}
                </button>

                {/* Mobile Media Management Panel */}
                {selectedListing === listing.id && (
                  <div style={{
                    marginTop: 12,
                    paddingTop: 12,
                    borderTop: "1px solid rgba(201,168,76,0.2)",
                  }}>
                    <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 14, color: "#c9a84c", marginBottom: 12 }}>
                      Media Management
                    </div>

                    {mediaLoading ? (
                      <div style={{ color: "#8A8680", textAlign: "center", padding: "20px 0" }}>
                        Loading media files...
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        {/* Photos */}
                        <div>
                          <label style={{ ...labelStyle, display: "block", marginBottom: 8, color: "#c9a84c" }}>
                            📷 Photos
                          </label>
                          <input
                            type="file"
                            multiple
                            accept="image/*"
                            onChange={(e) => handleMediaUpload(selectedListing, 'photos', Array.from(e.target.files))}
                            style={formInputStyle}
                          />
                          {mediaFiles[selectedListing]?.photos?.length > 0 && (
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(50px, 1fr))", gap: 6, marginTop: 8 }}>
                              {mediaFiles[selectedListing].photos.map((file) => (
                                <div key={file.name} style={{ position: "relative", aspectRatio: "1" }}>
                                  <img
                                    src={supabase.storage.from('listing-media').getPublicUrl(`${selectedListing}/photos/${file.name}`).data.publicUrl}
                                    alt={file.name}
                                    style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 4 }}
                                  />
                                  <button
                                    onClick={() => handleMediaDelete(selectedListing, 'photos', file.name)}
                                    style={{
                                      position: "absolute",
                                      top: -6,
                                      right: -6,
                                      width: 20,
                                      height: 20,
                                      background: "#f87171",
                                      color: "#fff",
                                      border: "none",
                                      borderRadius: "50%",
                                      cursor: "pointer",
                                      fontSize: 12,
                                      fontWeight: "bold",
                                    }}
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Video */}
                        <div>
                          <label style={{ ...labelStyle, display: "block", marginBottom: 8, color: "#c9a84c" }}>
                            🎬 Video
                          </label>
                          <input
                            type="file"
                            accept="video/*"
                            onChange={(e) => {
                              if (e.target.files.length > 0) {
                                handleMediaUpload(selectedListing, 'video', Array.from(e.target.files));
                              }
                            }}
                            style={formInputStyle}
                          />
                          {mediaFiles[selectedListing]?.video?.length > 0 && (
                            <div style={{ marginTop: 8, fontSize: 11, color: "#F0EDE8" }}>
                              <div>{mediaFiles[selectedListing].video[0].name}</div>
                              <button
                                onClick={() => handleMediaDelete(selectedListing, 'video', mediaFiles[selectedListing].video[0].name)}
                                style={{
                                  marginTop: 6,
                                  background: "#f87171",
                                  color: "#fff",
                                  border: "none",
                                  padding: "4px 8px",
                                  borderRadius: 4,
                                  cursor: "pointer",
                                  fontSize: 10,
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Floorplan */}
                        <div>
                          <label style={{ ...labelStyle, display: "block", marginBottom: 8, color: "#c9a84c" }}>
                            📐 Floorplan
                          </label>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => {
                              if (e.target.files.length > 0) {
                                handleMediaUpload(selectedListing, 'floorplan', Array.from(e.target.files));
                              }
                            }}
                            style={formInputStyle}
                          />
                          {mediaFiles[selectedListing]?.floorplan?.length > 0 && (
                            <div style={{ marginTop: 8, fontSize: 11, color: "#F0EDE8" }}>
                              <div>{mediaFiles[selectedListing].floorplan[0].name}</div>
                              <button
                                onClick={() => handleMediaDelete(selectedListing, 'floorplan', mediaFiles[selectedListing].floorplan[0].name)}
                                style={{
                                  marginTop: 6,
                                  background: "#f87171",
                                  color: "#fff",
                                  border: "none",
                                  padding: "4px 8px",
                                  borderRadius: 4,
                                  cursor: "pointer",
                                  fontSize: 10,
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {uploadProgress[selectedListing] === 'uploading' && (
                      <div style={{ marginTop: 8, color: "#c9a84c", fontSize: 11 }}>
                        Uploading...
                      </div>
                    )}
                    {uploadProgress[selectedListing] === 'done' && (
                      <div style={{ marginTop: 8, color: "#22c55e", fontSize: 11 }}>
                        Upload complete!
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default AdminView;
