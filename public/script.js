const API = "";
// Cookies carry the session, so every request must opt in to sending them.
const FETCH_OPTS = { credentials: "same-origin" };

const api = (path, opts = {}) => fetch(API + path, { ...FETCH_OPTS, ...opts });

// ------------------------------------------------------------ coordinates

// Accepts what you'd copy out of Google Maps: decimal ("22.5370, 75.7514",
// comma or space separated) or DMS ("22°32'13.2\"N 75°45'05.2\"E", with
// straight or curly quote/prime characters). Returns {lat, lon} or null.
function parseCoords(raw) {
    if (!raw) return null;
    const s = String(raw).trim().replace(/\s+/g, " ");

    const dmsRe = /(\d+(?:\.\d+)?)\s*[°d]\s*(?:(\d+(?:\.\d+)?)\s*['′’m])?\s*(?:(\d+(?:\.\d+)?)\s*["″”s])?\s*([NSEW])/gi;
    const parts = [];
    let m;
    while ((m = dmsRe.exec(s)) !== null) {
        const deg = parseFloat(m[1]) + (m[2] ? parseFloat(m[2]) / 60 : 0) + (m[3] ? parseFloat(m[3]) / 3600 : 0);
        const hemi = m[4].toUpperCase();
        parts.push({ val: hemi === "S" || hemi === "W" ? -deg : deg, hemi });
    }
    if (parts.length === 2) {
        const lat = parts.find((p) => p.hemi === "N" || p.hemi === "S");
        const lon = parts.find((p) => p.hemi === "E" || p.hemi === "W");
        if (lat && lon && Math.abs(lat.val) <= 90 && Math.abs(lon.val) <= 180) {
            return { lat: lat.val, lon: lon.val };
        }
    }

    const dec = s.match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/);
    if (dec) {
        const lat = parseFloat(dec[1]);
        const lon = parseFloat(dec[2]);
        if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) return { lat, lon };
    }
    return null;
}

// ---------------------------------------------------------------- toasts

function toast(message, kind = "info", ttl = 4000) {
    let stack = document.querySelector(".toast-stack");
    if (!stack) {
        stack = document.createElement("div");
        stack.className = "toast-stack";
        document.body.appendChild(stack);
    }
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(() => el.remove(), ttl);
}

// In-page replacement for window.confirm so destructive actions match the
// rest of the UI instead of raising a grey system dialog.
function confirmDialog({ title, body, confirmLabel = "CONFIRM", danger = false }) {
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "confirm-overlay";
        overlay.innerHTML = `
            <div class="confirm-box">
                <h4></h4>
                <p></p>
                <div class="actions">
                    <button type="button" class="btn" data-act="cancel">CANCEL</button>
                    <button type="button" class="btn ${danger ? "btn-danger" : "btn-primary"}" data-act="ok"></button>
                </div>
            </div>
        `;
        overlay.querySelector("h4").textContent = title;
        overlay.querySelector("p").textContent = body;
        overlay.querySelector('[data-act="ok"]').textContent = confirmLabel;

        const close = (result) => {
            document.removeEventListener("keydown", onKey);
            overlay.remove();
            resolve(result);
        };
        const onKey = (e) => {
            if (e.key === "Escape") close(false);
        };

        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) close(false);
            const act = e.target.dataset && e.target.dataset.act;
            if (act === "cancel") close(false);
            if (act === "ok") close(true);
        });
        document.addEventListener("keydown", onKey);
        document.body.appendChild(overlay);
        overlay.querySelector('[data-act="ok"]').focus();
    });
}

document.addEventListener("DOMContentLoaded", function () {
    // ---------------- Login ----------------
    const loginForm = document.getElementById("loginForm");
    const errorMessage = document.getElementById("errorMessage");
    const usernameInput = document.getElementById("username");
    const serverStatus = document.getElementById("serverStatus");
    let selectedRole = "user";

    if (serverStatus) {
        // Real health check rather than a hardcoded "ONLINE".
        api("/projects")
            .then((r) => {
                // 401 still proves the server answered.
                serverStatus.textContent = r.status < 500 ? "ONLINE" : "DEGRADED";
                serverStatus.className = r.status < 500 ? "ok" : "down";
            })
            .catch(() => {
                serverStatus.textContent = "UNREACHABLE";
                serverStatus.className = "down";
            });
    }

    document.querySelectorAll(".role-toggle button").forEach((btn) => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".role-toggle button").forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            selectedRole = btn.dataset.role;
            if (usernameInput && !usernameInput.value) {
                usernameInput.placeholder = selectedRole === "admin" ? "admin" : "e.g. OP-DELTA-07";
            }
        });
    });

    if (loginForm) {
        loginForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            errorMessage.style.display = "none";

            const username = document.getElementById("username").value;
            const password = document.getElementById("password").value;

            try {
                const response = await api("/login", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ username, password, role: selectedRole })
                });
                const result = await response.json();

                if (response.ok && result.success) {
                    window.location.href = result.role === "admin" ? "admin_dashboard.html" : "user_dashboard.html";
                    return;
                }
                errorMessage.textContent = result.message || "Invalid credentials!";
                errorMessage.style.display = "block";
            } catch (error) {
                errorMessage.textContent = "Server unreachable. Please try again later.";
                errorMessage.style.display = "block";
            }
        });
    }

    // ---------------- Session ----------------
    const signOutBtn = document.getElementById("signOutBtn");
    const userBadge = document.getElementById("userBadge");

    if (signOutBtn) {
        signOutBtn.addEventListener("click", async () => {
            try {
                await api("/logout", { method: "POST" });
            } catch (error) {
                /* sign out locally regardless */
            }
            window.location.href = "index.html";
        });
    }

    if (userBadge) {
        api("/me")
            .then((r) => (r.ok ? r.json() : null))
            .then((me) => {
                if (me && me.success) userBadge.textContent = me.role === "admin" ? "ADMIN" : "OPERATOR";
            })
            .catch(() => {});
    }

    // ---------------- Dashboard: projects & structures ----------------
    const personnelForm = document.getElementById("addPersonnelForm");
    const projectGroups = document.getElementById("projectGroups");
    const clearBtn = document.getElementById("clearListBtn");
    const statProjects = document.getElementById("statProjects");
    const statStructures = document.getElementById("statStructures");
    const statNodes = document.getElementById("statNodes");
    const statLocations = document.getElementById("statLocations");
    const isAdminView = !!personnelForm;

    let allEntries = [];

    const renderGroupedProjects = (entries) => {
        if (!projectGroups) return;
        projectGroups.innerHTML = "";
        projectGroups.className = "project-grid";

        if (entries.length === 0) {
            projectGroups.innerHTML = '<div class="empty-state">No structures uploaded yet.</div>';
            return;
        }

        const groups = new Map();
        entries.forEach((entry) => {
            const key = entry.project || "Ungrouped";
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(entry);
        });

        for (const [projectName, list] of groups) {
            const card = document.createElement("div");
            card.className = "project-card";
            const first = list[0];
            card.innerHTML = `
                <div class="thumb">
                    <img src="/uploads/${encodeURIComponent(projectName)}/${encodeURIComponent(first.folderName)}/preview.jpg"
                         alt="" onerror="this.remove()">
                    <span class="status" data-role="status">${list.length} MAP${list.length === 1 ? "" : "S"}</span>
                </div>
                <div class="body">
                    <div class="name"></div>
                    <div class="meta" data-role="meta">Loading&hellip;</div>
                    <div class="actions">
                        <button class="btn btn-primary explore-btn">EXPLORE</button>
                    </div>
                </div>
            `;
            card.querySelector(".name").textContent = projectName;
            card.querySelector(".explore-btn").dataset.project = projectName;
            projectGroups.appendChild(card);

            // Replaces the old hardcoded "MAPPED" badge with a real summary.
            Promise.all(
                list.map((entry) =>
                    api(`/api/tours/${encodeURIComponent(entry.project)}/${encodeURIComponent(entry.folderName)}/locations`)
                        .then((r) => (r.ok ? r.json() : null))
                        .catch(() => null)
                )
            ).then((all) => {
                const ok = all.filter((d) => d && d.success);
                const nodes = ok.reduce((s, d) => s + (d.nodeCount || 0), 0);
                const places = ok.reduce((s, d) => s + d.locations.length, 0);
                const failed = all.length - ok.length;
                const meta = card.querySelector('[data-role="meta"]');
                meta.textContent = failed
                    ? `${failed} of ${all.length} map${all.length === 1 ? "" : "s"} unreadable`
                    : `${nodes} nodes · ${places} named locations`;
                if (failed) card.querySelector('[data-role="status"]').textContent = "ERROR";
            });
        }
    };

    const refreshStats = async (entries) => {
        if (statProjects) statProjects.textContent = new Set(entries.map((e) => e.project || "Ungrouped")).size;
        if (statStructures) statStructures.textContent = entries.length;
        if (!statNodes && !statLocations) return;

        try {
            const all = await Promise.all(
                entries.map((entry) =>
                    api(`/api/tours/${encodeURIComponent(entry.project)}/${encodeURIComponent(entry.folderName)}/locations`)
                        .then((r) => (r.ok ? r.json() : null))
                        .catch(() => null)
                )
            );
            const ok = all.filter((d) => d && d.success);
            if (statNodes) statNodes.textContent = ok.reduce((s, d) => s + (d.nodeCount || 0), 0);
            if (statLocations) statLocations.textContent = ok.reduce((s, d) => s + d.locations.length, 0);
        } catch (error) {
            if (statNodes) statNodes.textContent = "-";
            if (statLocations) statLocations.textContent = "-";
        }
    };

    const loadPersonnelList = async () => {
        if (!projectGroups) return;
        try {
            const response = await api("/personnel");
            if (response.status === 401) {
                window.location.href = "index.html";
                return;
            }
            const entries = await response.json();
            allEntries = entries;
            renderGroupedProjects(entries);
            refreshStats(entries);
        } catch (error) {
            projectGroups.innerHTML = '<div class="empty-state">Could not reach the server.</div>';
        }
    };

    // ---------------- Project picker (admin) ----------------
    const projectSelect = document.getElementById("projectSelect");
    const newProjectField = document.getElementById("newProjectField");
    const newProjectName = document.getElementById("newProjectName");
    const NEW_PROJECT_VALUE = "__new__";

    const loadProjectOptions = async () => {
        if (!projectSelect) return;
        try {
            const response = await api("/projects");
            const data = await response.json();
            const projects = data.success ? data.projects : [];

            projectSelect.innerHTML = "";
            projects.forEach((p) => {
                const option = document.createElement("option");
                option.value = p;
                option.textContent = p;
                projectSelect.appendChild(option);
            });
            const newOption = document.createElement("option");
            newOption.value = NEW_PROJECT_VALUE;
            newOption.textContent = "+ New Project...";
            projectSelect.appendChild(newOption);

            if (projects.length === 0) {
                projectSelect.value = NEW_PROJECT_VALUE;
                if (newProjectField) newProjectField.style.display = "block";
            }
        } catch (error) {
            projectSelect.innerHTML = `<option value="${NEW_PROJECT_VALUE}">+ New Project...</option>`;
            if (newProjectField) newProjectField.style.display = "block";
        }
    };

    if (projectSelect) {
        projectSelect.addEventListener("change", () => {
            const isNew = projectSelect.value === NEW_PROJECT_VALUE;
            if (newProjectField) newProjectField.style.display = isNew ? "block" : "none";
        });
        loadProjectOptions();
    }

    // ---------------- Upload (admin) ----------------
    const uploadBox = document.getElementById("uploadBox");
    const ggpkgInput = document.getElementById("ggpkgInput");
    const browseBtn = document.getElementById("browseBtn");
    const cancelUploadBtn = document.getElementById("cancelUploadBtn");
    const selectedFileLabel = document.getElementById("selectedFileLabel");
    let selectedFile = null;

    const showEntryForm = (file) => {
        if (!/\.ggpkg$/i.test(file.name)) {
            toast("Only .ggpkg tour packages are accepted.", "error");
            return;
        }
        selectedFile = file;
        if (selectedFileLabel) selectedFileLabel.textContent = file.name;
        if (personnelForm) personnelForm.classList.add("open");
    };

    const resetUpload = () => {
        selectedFile = null;
        if (ggpkgInput) ggpkgInput.value = "";
        if (selectedFileLabel) selectedFileLabel.textContent = "";
        if (personnelForm) {
            personnelForm.classList.remove("open");
            personnelForm.reset();
        }
        if (newProjectField) newProjectField.style.display = "none";
    };

    if (browseBtn && ggpkgInput) {
        browseBtn.addEventListener("click", () => ggpkgInput.click());
        ggpkgInput.addEventListener("change", () => {
            if (ggpkgInput.files.length > 0) showEntryForm(ggpkgInput.files[0]);
        });
    }

    if (uploadBox) {
        uploadBox.addEventListener("dragover", (e) => {
            e.preventDefault();
            uploadBox.classList.add("dragover");
        });
        uploadBox.addEventListener("dragleave", () => uploadBox.classList.remove("dragover"));
        uploadBox.addEventListener("drop", (e) => {
            e.preventDefault();
            uploadBox.classList.remove("dragover");
            if (e.dataTransfer.files.length > 0) showEntryForm(e.dataTransfer.files[0]);
        });
    }

    if (cancelUploadBtn) cancelUploadBtn.addEventListener("click", resetUpload);

    if (personnelForm) {
        personnelForm.addEventListener("submit", async (e) => {
            e.preventDefault();

            if (!selectedFile) {
                toast("Choose a .ggpkg file first.", "error");
                return;
            }

            const project =
                projectSelect.value === NEW_PROJECT_VALUE ? newProjectName.value.trim() : projectSelect.value;
            if (!project) {
                toast("Enter a project name.", "error");
                return;
            }

            const sno = document.getElementById("sno").value;
            const name = document.getElementById("name").value;
            const location = document.getElementById("location").value;

            const submitBtn = personnelForm.querySelector('button[type="submit"]');
            submitBtn.disabled = true;
            submitBtn.textContent = "UPLOADING...";

            try {
                const formData = new FormData();
                formData.append("project", project);
                formData.append("file", selectedFile);

                const uploadResponse = await api("/upload", { method: "POST", body: formData });
                const uploadResult = await uploadResponse.json();

                if (!uploadResult.success) {
                    toast(uploadResult.message || "Upload failed.", "error", 7000);
                    return;
                }

                const addResponse = await api("/add-personnel", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        sno,
                        name,
                        location,
                        project: uploadResult.project,
                        folderName: uploadResult.folderName
                    })
                });
                const addResult = await addResponse.json();

                if (!addResult.success) {
                    toast(addResult.message || "Uploaded, but the record could not be saved.", "error", 7000);
                    return;
                }

                toast(`${uploadResult.folderName} uploaded to ${uploadResult.project}.`, "success");
                resetUpload();
                loadProjectOptions();
                loadPersonnelList();
            } catch (error) {
                toast("Server error during upload.", "error");
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = "SAVE STRUCTURE";
            }
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener("click", async () => {
            const ok = await confirmDialog({
                title: "Delete everything?",
                body: "This removes every structure record AND its uploaded tour files from disk. This cannot be undone.",
                confirmLabel: "DELETE ALL",
                danger: true
            });
            if (!ok) return;

            try {
                const res = await api("/clear-personnel", { method: "POST" });
                const result = await res.json();
                if (!result.success) {
                    toast(result.message || "Could not clear.", "error");
                    return;
                }
                toast("All structures and files removed.", "success");
                loadProjectOptions();
                loadPersonnelList();
            } catch (error) {
                toast("Server error while clearing.", "error");
            }
        });
    }

    // ---------------- Explore modal ----------------
    if (projectGroups) {
        const overlay = document.createElement("div");
        overlay.className = "distance-overlay";
        overlay.id = "distanceOverlay";
        overlay.innerHTML = `
            <div class="distance-card">
                <button class="distance-close" id="distanceClose">&times;</button>
                <h3 id="distanceTitle">Explore</h3>
                <div style="display: flex; gap: 8px; align-items: stretch; margin-bottom: 14px; flex-wrap: wrap;">
                    <select class="distance-select" id="structureSelect" style="margin-bottom: 0; flex: 1; min-width: 140px;">
                        <option value="">Choose a structure...</option>
                    </select>
                    <button type="button" class="btn" id="renameStructureBtn" style="display: none;">RENAME</button>
                    <button type="button" class="btn" id="reuploadStructureBtn" style="display: none;">RE-UPLOAD</button>
                    <button type="button" class="btn btn-danger" id="deleteStructureBtn" style="display: none;">DELETE</button>
                    <input type="file" id="reuploadInput" accept=".ggpkg" style="display: none;">
                </div>
                <form id="renameForm" style="display: none; margin-bottom: 14px; padding: 14px; border: 1px solid var(--border); border-radius: 6px;">
                    <div class="field">
                        <label for="renameLocation">LOCATION / STRUCTURE NAME</label>
                        <input type="text" id="renameLocation">
                    </div>
                    <div class="field">
                        <label for="renameName">NAME <span style="color: var(--text-dim); font-weight: 400;">(optional)</span></label>
                        <input type="text" id="renameName">
                    </div>
                    <div class="field">
                        <label for="renameSno">TES NO <span style="color: var(--text-dim); font-weight: 400;">(optional)</span></label>
                        <input type="number" id="renameSno">
                    </div>
                    <div style="display: flex; gap: 8px; justify-content: flex-end;">
                        <button type="button" class="btn" id="cancelRenameBtn">CANCEL</button>
                        <button type="submit" class="btn btn-primary" id="saveRenameBtn">SAVE</button>
                    </div>
                </form>
                <select class="distance-select" id="distanceSelect" style="display: none;">
                    <option value="">Choose a starting location...</option>
                </select>
                <div id="mapBanner" class="map-banner" style="display: none;"></div>
                <div class="route-panel" id="routePanel" style="display: none;">
                    <div class="route-row">
                        <span class="route-tag from">FROM</span>
                        <select class="distance-select" id="routeFrom"></select>
                        <button type="button" class="btn route-pick" data-target="from">PICK</button>
                    </div>
                    <div class="route-row">
                        <span class="route-tag to">TO</span>
                        <select class="distance-select" id="routeTo"></select>
                        <button type="button" class="btn route-pick" data-target="to">PICK</button>
                    </div>
                    <div class="route-row">
                        <button type="button" class="btn btn-primary" id="routeGoBtn" style="flex:1">FIND ROUTE</button>
                        <button type="button" class="btn" id="routeSwapBtn" title="Swap from/to">&#8646;</button>
                        <button type="button" class="btn" id="routeClearBtn">CLEAR</button>
                    </div>
                    <div class="route-result" id="routeResult">Pick two points to measure the route between them.</div>
                    <ol class="route-steps" id="routeSteps" style="display:none"></ol>
                </div>
                <div class="osm-map" id="osmMap" style="display: none;"></div>
                <div class="place-panel" id="placePanel" style="display: none;">
                    <div class="place-tabs">
                        <button type="button" data-place="node" class="active">SET LOCATION COORDS</button>
                        <button type="button" data-place="pin">ADD CUSTOM PIN</button>
                    </div>

                    <div class="place-form" id="placeNodeForm">
                        <div class="field">
                            <label for="placeNodeSelect">MAPPED LOCATION</label>
                            <select class="distance-select" id="placeNodeSelect" style="margin-bottom:0"></select>
                        </div>
                        <div class="field">
                            <label for="placeNodeCoords">COORDINATES <span class="dim">(paste from Google Maps — decimal or DMS)</span></label>
                            <input type="text" id="placeNodeCoords" placeholder="22.5370, 75.7514  or  22°32'13&quot;N 75°45'05&quot;E">
                        </div>
                        <div class="place-preview" id="placeNodePreview"></div>
                        <button type="button" class="btn btn-primary" id="placeNodeSaveBtn" style="width:100%">SET LOCATION</button>
                    </div>

                    <div class="place-form" id="placePinForm" style="display:none">
                        <div class="field">
                            <label for="pinTitle">PIN NAME</label>
                            <input type="text" id="pinTitle" placeholder="e.g. Sentry Post, Blocked gate">
                        </div>
                        <div class="field">
                            <label for="pinKind">TYPE</label>
                            <select class="distance-select" id="pinKind" style="margin-bottom:0">
                                <option value="note">Note</option>
                                <option value="hazard">Hazard</option>
                                <option value="asset">Asset</option>
                            </select>
                        </div>
                        <div class="field">
                            <label for="pinCoords">COORDINATES <span class="dim">(paste from Google Maps — decimal or DMS)</span></label>
                            <input type="text" id="pinCoords" placeholder="22.5375, 75.7512  or  22°32'15&quot;N 75°45'04&quot;E">
                        </div>
                        <div class="field">
                            <label for="pinDesc">NOTE <span class="dim">(optional)</span></label>
                            <input type="text" id="pinDesc" placeholder="Shift 0600-1800">
                        </div>
                        <div class="place-preview" id="placePinPreview"></div>
                        <button type="button" class="btn btn-primary" id="addPinSaveBtn" style="width:100%">ADD PIN</button>
                    </div>

                    <div class="row" style="margin-top: 12px;">
                        <button type="button" class="btn" id="cacheAreaBtn">SAVE MAP FOR OFFLINE</button>
                        <span id="cacheStats" style="font-family: var(--font-mono); font-size: 0.72em; color: var(--text-dim);"></span>
                    </div>
                </div>
                <div class="distance-result" id="distanceResult">Pick a structure to begin.</div>

                <button class="btn btn-primary" id="openTourBtn" style="display: none; width: 100%; margin-top: 12px;">OPEN TOUR &rarr;</button>
            </div>
        `;
        document.body.appendChild(overlay);

        // Two-column layout for a roomier modal: the picker/scene/open-tour
        // controls on the left, the large map + route + placement tools on the
        // right. Done by moving the already-built elements so the template
        // stays flat and simple. Stacks back to one column on narrow screens.
        (function twoColumnLayout() {
            const card = overlay.querySelector(".distance-card");
            const cols = document.createElement("div");
            cols.className = "dc-cols";
            const left = document.createElement("div");
            left.className = "dc-left";
            const right = document.createElement("div");
            right.className = "dc-right";
            cols.appendChild(left);
            cols.appendChild(right);
            card.appendChild(cols);
            const g = (id) => document.getElementById(id);
            // All the compact controls go left; the map alone goes right and is
            // made sticky (in CSS) so it stays visible while the controls scroll.
            ["distanceSelect", "distanceResult", "openTourBtn", "routePanel", "placePanel"].forEach((id) => {
                const el = g(id);
                if (el) left.appendChild(el);
            });
            ["mapBanner", "osmMap"].forEach((id) => {
                const el = g(id);
                if (el) right.appendChild(el);
            });
        })();

        const structureSelect = document.getElementById("structureSelect");
        const distanceSelect = document.getElementById("distanceSelect");
        const distanceResult = document.getElementById("distanceResult");
        const distanceTitle = document.getElementById("distanceTitle");
        const distanceClose = document.getElementById("distanceClose");
        const openTourBtn = document.getElementById("openTourBtn");
        const renameStructureBtn = document.getElementById("renameStructureBtn");
        const renameForm = document.getElementById("renameForm");
        const renameLocation = document.getElementById("renameLocation");
        const renameName = document.getElementById("renameName");
        const renameSno = document.getElementById("renameSno");
        const cancelRenameBtn = document.getElementById("cancelRenameBtn");
        const reuploadStructureBtn = document.getElementById("reuploadStructureBtn");
        const reuploadInput = document.getElementById("reuploadInput");
        const deleteStructureBtn = document.getElementById("deleteStructureBtn");
        const mapBanner = document.getElementById("mapBanner");
        const osmMapEl = document.getElementById("osmMap");
        const placePanel = document.getElementById("placePanel");
        const placeNodeForm = document.getElementById("placeNodeForm");
        const placePinForm = document.getElementById("placePinForm");
        const placeNodeSelect = document.getElementById("placeNodeSelect");
        const placeNodeCoords = document.getElementById("placeNodeCoords");
        const placeNodePreview = document.getElementById("placeNodePreview");
        const placeNodeSaveBtn = document.getElementById("placeNodeSaveBtn");
        const pinTitle = document.getElementById("pinTitle");
        const pinKind = document.getElementById("pinKind");
        const pinCoords = document.getElementById("pinCoords");
        const pinDesc = document.getElementById("pinDesc");
        const placePinPreview = document.getElementById("placePinPreview");
        const addPinSaveBtn = document.getElementById("addPinSaveBtn");
        const cacheAreaBtn = document.getElementById("cacheAreaBtn");
        const cacheStatsEl = document.getElementById("cacheStats");

        let currentProject = null;
        let currentFolder = null;
        let currentLocations = [];
        let currentOriginNodeId = null;
        // Index into currentLocations, NOT a node id: several named places can
        // share one panorama node (node26 is Motivation Hall, T 55 Tank AND
        // Technodrome), so a node id can't say which label was chosen.
        let selectedIndex = null;

        const closeModal = () => overlay.classList.remove("open");
        distanceClose.addEventListener("click", closeModal);
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) closeModal();
        });
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") closeModal();
        });

        const updateOpenTourLabel = () => {
            const loc = currentLocations[selectedIndex];
            openTourBtn.textContent = loc
                ? `OPEN TOUR AT ${loc.displayName.toUpperCase()} →`
                : "OPEN TOUR (DEFAULT START) →";
        };

        // ---------- OSM site map ----------
        // Placing nodes on a real map is what turns distances from arbitrary
        // units into metres: the tour's own hotspot links stay the source of
        // truth for what connects to what, and the coordinates supply how far
        // apart those links actually are.
        const mapState = { map: null, nodeLayer: null, pinLayer: null, geo: null, mode: null };

        const dotIcon = (cls, size = 14) =>
            L.divIcon({
                className: "",
                html: `<div class="map-dot ${cls}" style="width:${size}px;height:${size}px"></div>`,
                iconSize: [size, size],
                iconAnchor: [size / 2, size / 2]
            });

        const ensureMap = () => {
            if (mapState.map) return mapState.map;
            mapState.map = L.map(osmMapEl, { zoomControl: true, attributionControl: true }).setView([20.5937, 78.9629], 5);
            // Tiles come through our own server, which keeps a copy on disk -
            // so an area viewed (or pre-cached) once still renders offline.
            L.tileLayer("/api/tiles/{z}/{x}/{y}.png", {
                maxZoom: 19,
                attribution: '&copy; OpenStreetMap contributors'
            }).addTo(mapState.map);
            mapState.nodeLayer = L.layerGroup().addTo(mapState.map);
            mapState.pinLayer = L.layerGroup().addTo(mapState.map);

            mapState.map.on("click", async (e) => {
                const { lat, lng } = e.latlng;

                // Route picking takes precedence and is open to everyone.
                if (routePicking) {
                    const near = nearestPlacedNode(lat, lng);
                    if (!near) {
                        routeResult.textContent = "No surveyed points yet to snap to.";
                        setRoutePicking(null);
                        return;
                    }
                    (routePicking === "from" ? routeFrom : routeTo).value = near.nodeId;
                    const picked = routePicking;
                    setRoutePicking(null);
                    routeResult.textContent =
                        `${picked.toUpperCase()} set to ${labelForNode(near.nodeId)} (${Math.round(near.metres)} m from where you clicked).`;
                    if (routeFrom.value && routeTo.value) findRoute();
                    return;
                }
                // Nodes and pins are placed by entering coordinates, not by
                // clicking the map - so a plain map click does nothing here.
            });

            return mapState.map;
        };

        const deletePin = async (pinId) => {
            const ok = await confirmDialog({
                title: "Delete pin?",
                body: "This removes the marker for everyone.",
                confirmLabel: "DELETE",
                danger: true
            });
            if (!ok) return;
            const r = await api(
                `/api/tours/${encodeURIComponent(currentProject)}/${encodeURIComponent(currentFolder)}/pins/${pinId}`,
                { method: "DELETE" }
            );
            const data = await r.json();
            if (!data.success) return toast(data.message || "Could not delete pin.", "error");
            toast("Pin deleted.", "success", 2000);
            loadGeo();
        };

        const renderGeoOnMap = () => {
            if (!mapState.geo || !mapState.map) return;
            mapState.nodeLayer.clearLayers();
            mapState.pinLayer.clearLayers();

            const bounds = [];
            const originId = mapState.geo.originNodeId;

            for (const [nodeId, coords] of Object.entries(mapState.geo.nodes)) {
                const labels = currentLocations.filter((l) => l.nodeId === nodeId).map((l) => l.displayName);
                const isOrigin = nodeId === originId;
                const selectedNode = currentLocations[selectedIndex];
                const isSelected = selectedNode && selectedNode.nodeId === nodeId;

                const marker = L.marker([coords.lat, coords.lon], {
                    icon: dotIcon(isSelected ? "selected" : isOrigin ? "origin" : "node", isOrigin ? 17 : 14),
                    title: labels.join(" / ") || nodeId
                });
                const label = labels.length ? labels.join(" / ") : nodeId;
                marker.bindPopup(
                    `<strong>${label}</strong><br>${isOrigin ? "Default start point<br>" : ""}` +
                    `<span style="opacity:.7">${nodeId}</span>`
                );
                marker.on("click", () => {
                    const idx = currentLocations.findIndex((l) => l.nodeId === nodeId);
                    if (idx >= 0) showDistanceTo(idx);
                });
                marker.addTo(mapState.nodeLayer);
                bounds.push([coords.lat, coords.lon]);
            }

            for (const pin of mapState.geo.pins) {
                const marker = L.marker([pin.lat, pin.lon], {
                    icon: dotIcon(`pin-${pin.kind || "note"}`, 13),
                    title: pin.title
                });
                const del = isAdminView
                    ? `<br><button data-pin="${pin.id}" style="margin-top:6px;background:none;border:1px solid #ff5c5c;color:#ff5c5c;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:11px">DELETE</button>`
                    : "";
                marker.bindPopup(
                    `<strong>${pin.title}</strong>${pin.description ? `<br>${pin.description}` : ""}${del}`
                );
                marker.on("popupopen", (e) => {
                    const btn = e.popup.getElement().querySelector("[data-pin]");
                    if (btn) btn.addEventListener("click", () => deletePin(pin.id));
                });
                marker.addTo(mapState.pinLayer);
                bounds.push([pin.lat, pin.lon]);
            }

            if (bounds.length) mapState.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 18 });
        };

        const loadGeo = async () => {
            try {
                const r = await api(
                    `/api/tours/${encodeURIComponent(currentProject)}/${encodeURIComponent(currentFolder)}/geo`
                );
                const data = await r.json();
                if (!data.success) return;

                mapState.geo = { ...data, originNodeId: currentOriginNodeId };

                const { placed, total } = data.coverage;
                if (placed === 0) {
                    mapBanner.className = "map-banner warn";
                    mapBanner.textContent = isAdminView
                        ? `No points placed yet. Pick a node below and click its real position on the map — distances then read in metres.`
                        : `This site has not been placed on the map yet, so distances are still approximate.`;
                } else if (placed < total) {
                    mapBanner.className = "map-banner warn";
                    mapBanner.textContent = `${placed} of ${total} points placed. Distances in metres are available between placed points only.`;
                } else {
                    mapBanner.className = "map-banner";
                    mapBanner.textContent = `All ${total} points placed — distances are true ground measurements.`;
                }

                if (isAdminView) {
                    placeNodeSelect.innerHTML = "";
                    data.allNodes
                        .slice()
                        .sort((a, b) => (b.labels.length ? 1 : 0) - (a.labels.length ? 1 : 0))
                        .forEach((n) => {
                            const o = document.createElement("option");
                            o.value = n.nodeId;
                            const label = n.labels.length ? n.labels.join(" / ") : n.nodeId;
                            o.textContent = `${n.placed ? "✓ " : ""}${label}`;
                            placeNodeSelect.appendChild(o);
                        });
                }

                renderGeoOnMap();
                populateRouteSelects();
            } catch {
                mapBanner.className = "map-banner warn";
                mapBanner.textContent = "Could not load map data.";
            }
        };

        // The OSM site map is the only map view now (the Pano2VR floorplan
        // was a rotated, not-to-scale schematic that could not align with real
        // coordinates, so it was removed).
        const showMap = () => {
            osmMapEl.style.display = "block";
            mapBanner.style.display = "block";
            routePanel.style.display = "block";
            placePanel.style.display = isAdminView ? "block" : "none";

            ensureMap();
            if (isAdminView) refreshCacheStats();
            // Leaflet needs a re-measure once its container becomes visible.
            setTimeout(() => {
                mapState.map.invalidateSize();
                renderGeoOnMap();
            }, 60);
        };

        // Live coordinate preview - confirms the paste parsed before saving.
        const wireCoordPreview = (input, preview) => {
            input.addEventListener("input", () => {
                const c = parseCoords(input.value);
                if (!input.value.trim()) {
                    preview.className = "place-preview";
                    preview.textContent = "";
                } else if (c) {
                    preview.className = "place-preview ok";
                    preview.textContent = `✓ ${c.lat.toFixed(6)}, ${c.lon.toFixed(6)}`;
                } else {
                    preview.className = "place-preview bad";
                    preview.textContent = "Couldn't read those coordinates — paste decimal or DMS.";
                }
            });
        };

        if (isAdminView) {
            // Tabs: set a mapped location's coordinates, or add a custom pin.
            placePanel.querySelectorAll(".place-tabs button").forEach((btn) => {
                btn.addEventListener("click", () => {
                    placePanel.querySelectorAll(".place-tabs button").forEach((b) => b.classList.remove("active"));
                    btn.classList.add("active");
                    const isNode = btn.dataset.place === "node";
                    placeNodeForm.style.display = isNode ? "block" : "none";
                    placePinForm.style.display = isNode ? "none" : "block";
                });
            });

            wireCoordPreview(placeNodeCoords, placeNodePreview);
            wireCoordPreview(pinCoords, placePinPreview);

            placeNodeSaveBtn.addEventListener("click", async () => {
                const nodeId = placeNodeSelect.value;
                if (!nodeId) return toast("Choose which location to place.", "error");
                const c = parseCoords(placeNodeCoords.value);
                if (!c) return toast("Enter valid coordinates (decimal or DMS).", "error");

                placeNodeSaveBtn.disabled = true;
                try {
                    const r = await api(
                        `/api/tours/${encodeURIComponent(currentProject)}/${encodeURIComponent(currentFolder)}/geo/node`,
                        {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ nodeId, lat: c.lat, lon: c.lon })
                        }
                    );
                    const data = await r.json();
                    if (!data.success) return toast(data.message || "Could not set location.", "error");
                    const label = placeNodeSelect.options[placeNodeSelect.selectedIndex].textContent.replace(/^✓ /, "");
                    toast(`${label} set. ${data.coverage.placed}/${data.coverage.total} placed.`, "success");
                    placeNodeCoords.value = "";
                    placeNodePreview.textContent = "";
                    await loadGeo();
                } catch {
                    toast("Server error while setting location.", "error");
                } finally {
                    placeNodeSaveBtn.disabled = false;
                }
            });

            addPinSaveBtn.addEventListener("click", async () => {
                const title = pinTitle.value.trim();
                if (!title) return toast("Give the pin a name.", "error");
                const c = parseCoords(pinCoords.value);
                if (!c) return toast("Enter valid coordinates (decimal or DMS).", "error");

                addPinSaveBtn.disabled = true;
                try {
                    const r = await api(
                        `/api/tours/${encodeURIComponent(currentProject)}/${encodeURIComponent(currentFolder)}/pins`,
                        {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ lat: c.lat, lon: c.lon, title, description: pinDesc.value, kind: pinKind.value })
                        }
                    );
                    const data = await r.json();
                    if (!data.success) return toast(data.message || "Could not add pin.", "error");
                    toast(`Pin "${title}" added.`, "success");
                    pinTitle.value = "";
                    pinCoords.value = "";
                    pinDesc.value = "";
                    placePinPreview.textContent = "";
                    await loadGeo();
                } catch {
                    toast("Server error while adding pin.", "error");
                }
                finally {
                    addPinSaveBtn.disabled = false;
                }
            });

            cacheAreaBtn.addEventListener("click", async () => {
                if (!mapState.map) return;
                const b = mapState.map.getBounds();
                const bounds = { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() };
                const zoom = Math.round(mapState.map.getZoom());
                const minZoom = Math.max(0, zoom - 1);
                const maxZoom = Math.min(19, zoom + 3);

                let estimate;
                try {
                    const r = await api("/api/tiles/prefetch-estimate", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ bounds, minZoom, maxZoom })
                    });
                    estimate = await r.json();
                } catch {
                    return toast("Could not estimate the download.", "error");
                }

                if (!estimate.withinLimit) {
                    return toast(
                        `That view needs ${estimate.tiles} tiles (limit ${estimate.limit}). Zoom in and try again.`,
                        "error",
                        8000
                    );
                }

                const mins = Math.max(1, Math.round(estimate.estimatedSeconds / 60));
                const ok = await confirmDialog({
                    title: "Save this area for offline use?",
                    body:
                        `Downloads ${estimate.tiles} map tiles for the current view (zoom ${minZoom}-${maxZoom}), ` +
                        `taking roughly ${mins} minute${mins === 1 ? "" : "s"}. ` +
                        `Downloads are paced deliberately to respect OpenStreetMap's usage policy, so please leave this open.`,
                    confirmLabel: "DOWNLOAD"
                });
                if (!ok) return;

                cacheAreaBtn.disabled = true;
                cacheAreaBtn.textContent = "DOWNLOADING...";
                toast(`Downloading ${estimate.tiles} tiles - this takes about ${mins} min.`, "info", 6000);

                try {
                    const r = await api("/api/tiles/prefetch", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ bounds, minZoom, maxZoom })
                    });
                    const data = await r.json();
                    if (!data.success) {
                        toast(data.message || "Download failed.", "error", 8000);
                        return;
                    }
                    toast(
                        `Map tiles saved: ${data.downloaded} new, ${data.alreadyCached} already stored` +
                        `${data.failed ? `, ${data.failed} failed` : ""}. Now caching routes...`,
                        "info",
                        6000
                    );

                    // Also store every route between placed nodes, so
                    // directions work offline - not just the map background.
                    cacheAreaBtn.textContent = "CACHING ROUTES...";
                    try {
                        const rr = await api(
                            `/api/tours/${encodeURIComponent(currentProject)}/${encodeURIComponent(currentFolder)}/cache-routes`,
                            { method: "POST" }
                        );
                        const routeData = await rr.json();
                        if (routeData.success) {
                            toast(
                                `Offline ready: ${data.downloaded + data.alreadyCached} tiles + ` +
                                `${routeData.cached} route${routeData.cached === 1 ? "" : "s"} cached.`,
                                "success",
                                8000
                            );
                        }
                    } catch {
                        toast("Tiles saved, but route caching failed.", "info", 6000);
                    }
                    refreshCacheStats();
                } catch {
                    toast("Server error while downloading tiles.", "error");
                } finally {
                    cacheAreaBtn.disabled = false;
                    cacheAreaBtn.textContent = "SAVE MAP FOR OFFLINE";
                }
            });
        }

        // ---------- Route planner ----------
        // Measures between any two surveyed points, not just from the tour's
        // own start node. Available to operators as well as admins - reading
        // a route is not an edit.
        const routePanel = document.getElementById("routePanel");
        const routeFrom = document.getElementById("routeFrom");
        const routeTo = document.getElementById("routeTo");
        const routeResult = document.getElementById("routeResult");
        const routeGoBtn = document.getElementById("routeGoBtn");
        const routeSwapBtn = document.getElementById("routeSwapBtn");
        const routeClearBtn = document.getElementById("routeClearBtn");
        const routeSteps = document.getElementById("routeSteps");
        let routeLayer = null;
        let routePicking = null; // 'from' | 'to' while waiting for a map click

        const labelForNode = (nodeId) => {
            const labels = currentLocations.filter((l) => l.nodeId === nodeId).map((l) => l.displayName);
            return labels.length ? labels.join(" / ") : nodeId;
        };

        // Only surveyed nodes can be routed between - an unplaced node has no
        // position, so offering it would just produce an error.
        const populateRouteSelects = () => {
            const placed = Object.keys((mapState.geo && mapState.geo.nodes) || {});
            const keepFrom = routeFrom.value;
            const keepTo = routeTo.value;

            [routeFrom, routeTo].forEach((sel) => {
                sel.innerHTML = '<option value="">Choose a point...</option>';
                placed
                    .map((id) => ({ id, label: labelForNode(id) }))
                    .sort((a, b) => a.label.localeCompare(b.label))
                    .forEach(({ id, label }) => {
                        const o = document.createElement("option");
                        o.value = id;
                        o.textContent = label;
                        sel.appendChild(o);
                    });
            });

            if (placed.includes(keepFrom)) routeFrom.value = keepFrom;
            if (placed.includes(keepTo)) routeTo.value = keepTo;
            if (!routeFrom.value && currentOriginNodeId && placed.includes(currentOriginNodeId)) {
                routeFrom.value = currentOriginNodeId;
            }

            const enoughPoints = placed.length >= 2;
            routeGoBtn.disabled = !enoughPoints;
            if (!enoughPoints) {
                routeResult.textContent =
                    `Only ${placed.length} point${placed.length === 1 ? "" : "s"} surveyed so far — at least two are needed to measure a route.`;
            }
        };

        const clearRoute = () => {
            if (routeLayer) {
                mapState.map.removeLayer(routeLayer);
                routeLayer = null;
            }
        };

        const setRoutePicking = (which) => {
            routePicking = which;
            document.querySelectorAll(".route-pick").forEach((b) =>
                b.classList.toggle("arming", which === b.dataset.target)
            );
            if (osmMapEl) osmMapEl.style.cursor = which ? "crosshair" : "";
        };

        // Snaps a raw map click to the nearest surveyed node, since only those
        // sit on the walkable graph.
        const nearestPlacedNode = (lat, lng) => {
            const nodes = (mapState.geo && mapState.geo.nodes) || {};
            let best = null;
            let bestD = Infinity;
            for (const [id, c] of Object.entries(nodes)) {
                const d = Math.hypot((c.lat - lat) * 111132, (c.lon - lng) * 111320 * Math.cos((lat * Math.PI) / 180));
                if (d < bestD) { bestD = d; best = id; }
            }
            return best ? { nodeId: best, metres: bestD } : null;
        };

        // `shape` is the actual line to draw: either Valhalla's path along real
        // roads, or the straight node-to-node hops for the graph estimate.
        const drawRoute = (shape, fromId, toId) => {
            clearRoute();
            const coords = shape.filter(Boolean);
            if (coords.length < 2) return;

            routeLayer = L.layerGroup().addTo(mapState.map);
            L.polyline(coords, { color: "#2ee6a1", weight: 4, opacity: 0.85 }).addTo(routeLayer);
            L.polyline(
                [coords[0], coords[coords.length - 1]],
                { color: "#ffb454", weight: 2, opacity: 0.5, dashArray: "6,6" }
            ).addTo(routeLayer);

            const fromLabel = fromId ? labelForNode(fromId) : "Start";
            const toLabel = toId ? labelForNode(toId) : "End";
            L.marker(coords[0], { icon: dotIcon("route-from", 18), zIndexOffset: 900 })
                .bindPopup(`<strong>From:</strong> ${fromLabel}`).addTo(routeLayer);
            L.marker(coords[coords.length - 1], { icon: dotIcon("route-to", 18), zIndexOffset: 900 })
                .bindPopup(`<strong>To:</strong> ${toLabel}`).addTo(routeLayer);

            mapState.map.fitBounds(coords, { padding: [40, 40], maxZoom: 18 });
        };

        const renderSteps = (steps) => {
            routeSteps.innerHTML = "";
            if (!steps || !steps.length) {
                routeSteps.style.display = "none";
                return;
            }
            steps.forEach((s) => {
                const li = document.createElement("li");
                const instr = document.createElement("span");
                instr.textContent = s.instruction;
                li.appendChild(instr);
                if (s.metres > 0) {
                    const dist = document.createElement("span");
                    dist.className = "step-dist";
                    dist.textContent = `${s.metres} m`;
                    li.appendChild(dist);
                }
                routeSteps.appendChild(li);
            });
            routeSteps.style.display = "block";
        };

        const base = () =>
            `/api/tours/${encodeURIComponent(currentProject)}/${encodeURIComponent(currentFolder)}`;

        // Turn-by-turn along real OSM paths (Valhalla). This is the only
        // routing mode - the old straight-line graph fallback was removed.
        // Offline coverage comes from cached routes, not a second engine.
        const findDirections = async (from, to) => {
            routeResult.textContent = "Getting directions...";
            const r = await api(`${base()}/directions?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
            const d = await r.json();
            if (!d.success) throw new Error(d.message || "No directions available.");

            const mins = Math.round(d.seconds / 60);
            routeResult.innerHTML =
                `<span class="big">${d.metres} m</span> on foot &nbsp;·&nbsp; ~${mins || 1} min<br>` +
                `${labelForNode(from)} &rarr; ${labelForNode(to)}` +
                `<div class="route-source">Directions via Valhalla (OpenStreetMap)${d.cached ? " · offline copy" : ""}</div>`;
            renderSteps(d.steps);
            drawRoute(d.shape.map((c) => [c[0], c[1]]), from, to);
        };

        const findRoute = async () => {
            const from = routeFrom.value;
            const to = routeTo.value;
            if (!from || !to) {
                routeResult.textContent = "Choose both a start and an end point.";
                return;
            }
            if (from === to) {
                clearRoute();
                renderSteps(null);
                routeResult.innerHTML = `<span class="big">0 m</span> — same point.`;
                return;
            }

            routeGoBtn.disabled = true;
            try {
                await findDirections(from, to);
            } catch (err) {
                clearRoute();
                renderSteps(null);
                routeResult.innerHTML =
                    `Directions unavailable: ${err.message}` +
                    `<div class="route-source">Use "Save map for offline" while online to store routes for later.</div>`;
            } finally {
                routeGoBtn.disabled = false;
            }
        };

        routeGoBtn.addEventListener("click", findRoute);

        routeSwapBtn.addEventListener("click", () => {
            const a = routeFrom.value;
            routeFrom.value = routeTo.value;
            routeTo.value = a;
            if (routeFrom.value && routeTo.value) findRoute();
        });

        routeClearBtn.addEventListener("click", () => {
            clearRoute();
            renderSteps(null);
            routeFrom.value = "";
            routeTo.value = "";
            setRoutePicking(null);
            routeResult.textContent = "Pick two points to measure the route between them.";
        });

        document.querySelectorAll(".route-pick").forEach((btn) => {
            btn.addEventListener("click", () => {
                const target = btn.dataset.target;
                setRoutePicking(routePicking === target ? null : target);
                routeResult.textContent = routePicking
                    ? `Click the map to set the ${routePicking.toUpperCase()} point — it snaps to the nearest surveyed location.`
                    : "Pick two points to measure the route between them.";
            });
        });

        const refreshCacheStats = async () => {
            if (!cacheStatsEl) return;
            try {
                const r = await api("/api/tiles/stats");
                const s = await r.json();
                cacheStatsEl.textContent = s.tiles
                    ? `${s.tiles} tiles offline (${(s.bytes / 1048576).toFixed(1)} MB)`
                    : "no offline tiles yet";
            } catch {
                cacheStatsEl.textContent = "";
            }
        };

        // The start-point picker only chooses which node the 3D tour opens at.
        // All distance/route measurement lives in the route planner below, so
        // there is a single, consistent source of distances (no mix of
        // estimated units and real metres).
        const showDistanceTo = (index) => {
            const loc = currentLocations[index];
            if (!loc) return;
            selectedIndex = index;
            distanceSelect.value = String(index);
            updateOpenTourLabel();
            renderGeoOnMap();
            distanceResult.textContent = `Tour will open at ${loc.displayName}. Use the route planner below for distances.`;
        };

        // Tactical scene analysis now lives only in the 3D pano viewer's live
        // panel (public/tactigrid-scene.js), so there is no scene panel here.

        const loadStructureLocations = async (project, folder) => {
            currentProject = project;
            currentFolder = folder;
            selectedIndex = null;
            distanceResult.textContent = "Loading locations...";
            distanceSelect.innerHTML = '<option value="">Choose a starting location...</option>';
            distanceSelect.style.display = "block";
            openTourBtn.style.display = "block";
            updateOpenTourLabel();

            try {
                const response = await api(
                    `/api/tours/${encodeURIComponent(project)}/${encodeURIComponent(folder)}/locations`
                );
                const data = await response.json();

                if (!data.success) {
                    distanceResult.textContent = data.message || "Could not load locations for this tour.";
                    return;
                }

                currentLocations = data.locations;
                currentOriginNodeId = data.origin ? data.origin.nodeId : null;

                data.locations.forEach((loc, index) => {
                    const option = document.createElement("option");
                    option.value = String(index);
                    option.textContent = loc.displayName;
                    distanceSelect.appendChild(option);
                });

                showMap();
                loadGeo();
                distanceResult.textContent = "Select a location to see the distance, or open the tour there directly.";
            } catch (error) {
                distanceResult.textContent = "Server error while loading locations.";
            }
        };

        const selectStructure = (folder) => {
            renameForm.style.display = "none";
            const show = isAdminView && folder ? "block" : "none";
            renameStructureBtn.style.display = show;
            reuploadStructureBtn.style.display = show;
            deleteStructureBtn.style.display = show;
            if (folder) loadStructureLocations(currentProject, folder);
        };

        const openExploreModal = (project) => {
            currentProject = project;
            currentFolder = null;
            selectedIndex = null;
            distanceTitle.textContent = `Explore - ${project}`;
            structureSelect.innerHTML = '<option value="">Choose a structure...</option>';
            distanceSelect.innerHTML = '<option value="">Choose a starting location...</option>';
            distanceSelect.style.display = "none";
            openTourBtn.style.display = "none";
            renameStructureBtn.style.display = "none";
            reuploadStructureBtn.style.display = "none";
            deleteStructureBtn.style.display = "none";
            renameForm.style.display = "none";
            mapBanner.style.display = "none";
            osmMapEl.style.display = "none";
            placePanel.style.display = "none";
            routePanel.style.display = "none";
            setRoutePicking(null);
            if (mapState.map) clearRoute();
            routeFrom.innerHTML = "";
            routeTo.innerHTML = "";

            const structures = allEntries.filter((entry) => (entry.project || "Ungrouped") === project);

            if (structures.length === 1) {
                // One map in this project - skip the picker, go straight to
                // choosing a start point.
                structureSelect.style.display = "none";
                selectStructure(structures[0].folderName);
            } else {
                structureSelect.style.display = "block";
                distanceResult.textContent = "Pick a structure to begin.";
                structures.forEach((entry) => {
                    const option = document.createElement("option");
                    option.value = entry.folderName;
                    option.textContent = entry.name ? `${entry.location} (${entry.name})` : entry.location;
                    structureSelect.appendChild(option);
                });
            }

            overlay.classList.add("open");
        };

        structureSelect.addEventListener("change", () => selectStructure(structureSelect.value));

        if (isAdminView) {
            renameStructureBtn.addEventListener("click", () => {
                const entry = allEntries.find((e) => e.project === currentProject && e.folderName === currentFolder);
                if (!entry) return;
                renameLocation.value = entry.location || "";
                renameName.value = entry.name || "";
                renameSno.value = entry.sno || "";
                renameForm.style.display = "block";
                renameLocation.focus();
            });

            cancelRenameBtn.addEventListener("click", () => {
                renameForm.style.display = "none";
            });

            // A real <form>, so Enter submits instead of doing nothing.
            renameForm.addEventListener("submit", async (e) => {
                e.preventDefault();
                const location = renameLocation.value.trim();
                if (!location) {
                    toast("Location can't be empty.", "error");
                    return;
                }
                const name = renameName.value.trim();
                const sno = renameSno.value.trim();

                try {
                    const response = await api("/update-personnel", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ project: currentProject, folderName: currentFolder, sno, name, location })
                    });
                    const result = await response.json();
                    if (!result.success) {
                        toast(result.message || "Rename failed.", "error", 6000);
                        return;
                    }

                    const entry = allEntries.find((e2) => e2.project === currentProject && e2.folderName === currentFolder);
                    if (entry) Object.assign(entry, { location, name, sno });

                    const option = Array.from(structureSelect.options).find((o) => o.value === currentFolder);
                    if (option) option.textContent = name ? `${location} (${name})` : location;

                    renameForm.style.display = "none";
                    toast("Renamed.", "success");
                    renderGroupedProjects(allEntries);
                } catch (error) {
                    toast("Server error while renaming.", "error");
                }
            });

            reuploadStructureBtn.addEventListener("click", () => {
                if (currentFolder) reuploadInput.click();
            });

            reuploadInput.addEventListener("change", async () => {
                const file = reuploadInput.files[0];
                reuploadInput.value = "";
                if (!file || !currentProject || !currentFolder) return;

                const ok = await confirmDialog({
                    title: `Replace scan for "${currentFolder}"?`,
                    body: `"${file.name}" will replace the current tour files. The old scan is permanently deleted.`,
                    confirmLabel: "REPLACE",
                    danger: true
                });
                if (!ok) return;

                reuploadStructureBtn.disabled = true;
                reuploadStructureBtn.textContent = "UPLOADING...";
                distanceResult.textContent = "Re-uploading scan...";

                try {
                    const formData = new FormData();
                    formData.append("project", currentProject);
                    formData.append("folderName", currentFolder);
                    formData.append("file", file);

                    const response = await api("/reupload", { method: "POST", body: formData });
                    const result = await response.json();

                    if (!result.success) {
                        toast(result.message || "Re-upload failed.", "error", 7000);
                        distanceResult.textContent = "Re-upload failed - the previous scan is unchanged.";
                        return;
                    }

                    toast("Scan replaced.", "success");
                    await loadStructureLocations(currentProject, currentFolder);
                    loadPersonnelList();
                } catch (error) {
                    toast("Server error during re-upload.", "error");
                } finally {
                    reuploadStructureBtn.disabled = false;
                    reuploadStructureBtn.textContent = "RE-UPLOAD";
                }
            });

            deleteStructureBtn.addEventListener("click", async () => {
                if (!currentProject || !currentFolder) return;
                const ok = await confirmDialog({
                    title: `Delete "${currentFolder}"?`,
                    body: "This removes the record and permanently deletes its tour files from disk. This cannot be undone.",
                    confirmLabel: "DELETE",
                    danger: true
                });
                if (!ok) return;

                try {
                    const response = await api("/delete-structure", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ project: currentProject, folderName: currentFolder })
                    });
                    const result = await response.json();
                    if (!result.success) {
                        toast(result.message || "Delete failed.", "error");
                        return;
                    }
                    toast(`${currentFolder} deleted.`, "success");
                    closeModal();
                    loadProjectOptions();
                    loadPersonnelList();
                } catch (error) {
                    toast("Server error while deleting.", "error");
                }
            });
        }

        distanceSelect.addEventListener("change", () => {
            if (distanceSelect.value === "") {
                selectedIndex = null;
                updateOpenTourLabel();
                renderGeoOnMap();
                distanceResult.textContent = "Select a location to see the distance, or open the tour there directly.";
                return;
            }
            showDistanceTo(Number(distanceSelect.value));
        });

        openTourBtn.addEventListener("click", () => {
            if (!currentProject || !currentFolder) return;
            const loc = currentLocations[selectedIndex];
            const hash = loc ? `#${loc.nodeId}` : "";
            window.open(
                `/uploads/${encodeURIComponent(currentProject)}/${encodeURIComponent(currentFolder)}/index.html${hash}`,
                "_blank"
            );
        });

        projectGroups.addEventListener("click", (e) => {
            const btn = e.target.closest(".explore-btn");
            if (!btn) return;
            openExploreModal(btn.dataset.project);
        });
    }

    loadPersonnelList();
});
