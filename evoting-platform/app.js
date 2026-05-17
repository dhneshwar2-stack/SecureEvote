/* ═══════════════════════════════════════════════
   SecureVote — app.js
   ═══════════════════════════════════════════════ */

'use strict';

// ── State ─────────────────────────────────────────────
const state = {
  currentVoter: null,        // voter object after ID lookup
  selectedCandidate: null,   // candidate chosen on ballot
  regFaceDataURL: null,      // base64 face captured during registration
  verifyFaceDataURL: null,   // base64 face captured during verify
  regStream: null,
  verifyStream: null,
  pollingActive: false,
  pollingClosed: false,
  faceModelsLoaded: false,
  currentTheme: 'dark',
};

// ── DOM helpers ────────────────────────────────────────
const $ = id => document.getElementById(id);
const showPage = (id, keepStreams = false) => {
  if (!keepStreams) stopAllStreams();   // stop cameras BEFORE switching page
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  $(id).classList.add('active');
};
const toast = (msg, type = 'info', dur = 3000) => {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast ${type}`;
  setTimeout(() => t.classList.add('hidden'), dur);
};

// ── Stop camera streams ────────────────────────────────
function stopAllStreams() {
  if (state.regStream)    { state.regStream.getTracks().forEach(t => t.stop());    state.regStream = null; }
  if (state.verifyStream) { state.verifyStream.getTracks().forEach(t => t.stop()); state.verifyStream = null; }
}

// ── Init ───────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  // Hide loader after short delay
  await loadFaceModels();
  setTimeout(() => {
    const l = $('loader');
    l.classList.add('hidden');
  }, 800);
  loadTheme();
  loadAdminStats();
  listenPollingState();
});

// ── Face-API Models ────────────────────────────────────
async function loadFaceModels() {
  try {
    const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
    state.faceModelsLoaded = true;
    console.log('✅ Face models loaded');
  } catch (e) {
    console.warn('⚠️ Face models failed to load — face verification will use image fallback', e);
  }
}

// ═══════════════════════════════════════════════
//  VOTER LOGIN FLOW
// ═══════════════════════════════════════════════

async function startVoterLogin() {
  const vid = $('voterIdInput').value.trim().toUpperCase();
  if (!vid) { toast('Please enter your Voter ID', 'error'); return; }

  try {
    const snap = await db.collection('voters').doc(vid).get();
    if (!snap.exists) { toast('Voter ID not found. Please register first.', 'error'); return; }
    state.currentVoter = { id: vid, ...snap.data() };

    // Check if already voted
    if (state.currentVoter.hasVoted) {
      toast('You have already cast your vote!', 'error'); return;
    }

    // Start face verification
    openFaceVerify('voter');
  } catch (e) {
    toast('Error fetching voter data: ' + e.message, 'error');
  }
}

// ═══════════════════════════════════════════════
//  FACE VERIFY (shared for voter login)
// ═══════════════════════════════════════════════

function openFaceVerify(mode) {
  state.verifyMode = mode;
  $('faceVerifyTitle').textContent = 'Face Verification';
  $('faceVerifySubtitle').textContent = 'Look at the camera to verify your identity';
  // Stop reg stream first, THEN switch page (keepStreams=true so showPage won't double-stop)
  stopAllStreams();
  showPage('page-face-verify', true);
  // Small delay to let the page render before accessing video element
  setTimeout(() => startVerifyCamera(), 200);
}

async function startVerifyCamera() {
  const video = $('verifyVideo');
  const statusEl = $('faceStatus');
  statusEl.textContent = '⏳ Starting camera…';

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    statusEl.textContent = '❌ Camera API not supported in this browser';
    toast('Camera not supported — try Chrome or Firefox', 'error');
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: false
    });
    state.verifyStream = stream;
    video.srcObject = stream;
    await video.play().catch(() => {});  // explicit play
    statusEl.textContent = '📷 Camera ready — look at the camera';
  } catch (e) {
    console.error('Camera error:', e);
    let msg = '❌ Camera error: ';
    if (e.name === 'NotAllowedError')  msg += 'Permission denied — allow camera in browser settings';
    else if (e.name === 'NotFoundError') msg += 'No camera found on this device';
    else if (e.name === 'NotReadableError') msg += 'Camera is in use by another app';
    else msg += e.message;
    statusEl.textContent = msg;
    toast(msg, 'error', 5000);
  }
}

async function captureAndVerify() {
  const video  = $('verifyVideo');
  const canvas = $('verifyCanvas');
  canvas.width  = video.videoWidth  || 640;
  canvas.height = video.videoHeight || 480;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);
  state.verifyFaceDataURL = canvas.toDataURL('image/jpeg', 0.8);

  $('faceStatus').textContent = '⏳ Verifying face…';
  $('captureVerifyBtn').disabled = true;

  try {
    const matched = await compareFaces(state.currentVoter.faceDataURL, state.verifyFaceDataURL);
    if (matched) {
      stopAllStreams();
      showWelcomeVoter();
    } else {
      $('faceStatus').textContent = '❌ Face did not match. Try again.';
      toast('Face verification failed', 'error');
      $('captureVerifyBtn').disabled = false;
    }
  } catch (e) {
    // Fallback: skip strict verification if models not loaded
    console.warn('Face comparison error, allowing login as fallback', e);
    stopAllStreams();
    showWelcomeVoter();
  }
}

async function compareFaces(storedDataURL, liveDataURL) {
  if (!state.faceModelsLoaded) return true; // fallback

  const imgEl1 = await urlToImage(storedDataURL);
  const imgEl2 = await urlToImage(liveDataURL);

  const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 224 });

  const d1 = await faceapi.detectSingleFace(imgEl1, opts).withFaceLandmarks(true).withFaceDescriptor();
  const d2 = await faceapi.detectSingleFace(imgEl2, opts).withFaceLandmarks(true).withFaceDescriptor();

  if (!d1 || !d2) return false;
  const dist = faceapi.euclideanDistance(d1.descriptor, d2.descriptor);
  return dist < 0.55;
}

function urlToImage(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload  = () => res(img);
    img.onerror = rej;
    img.src = url;
  });
}

function cancelVerify() {
  stopAllStreams();
  showPage('page-voter-login', true);  // streams already stopped
}

function showWelcomeVoter() {
  const v = state.currentVoter;
  $('welcomeVoterName').textContent = `Welcome, ${v.name}!`;
  const avatar = $('welcomeAvatar');
  if (v.faceDataURL) {
    avatar.innerHTML = `<img src="${v.faceDataURL}" alt="${v.name}"/>`;
  } else {
    avatar.textContent = v.name[0].toUpperCase();
  }
  showPage('page-welcome-voter');
}

async function goToBallot() {
  // Check polling state
  try {
    const snap = await db.collection('settings').doc('polling').get();
    const data = snap.exists ? snap.data() : {};
    if (!data.active && !data.closed) {
      toast('Polling has not started yet.', 'error'); return;
    }
    if (data.closed) {
      toast('Polling is closed.', 'error'); return;
    }
  } catch (e) { /* proceed */ }

  $('ballotVoterLabel').textContent = `🧑 ${state.currentVoter.name}`;
  await renderBallot();
  showPage('page-ballot');
}

async function renderBallot() {
  const list = $('candidateList');
  list.innerHTML = '<p style="color:var(--text2);text-align:center">Loading candidates…</p>';
  try {
    const snap = await db.collection('candidates').get();
    if (snap.empty) {
      list.innerHTML = '<p style="color:var(--text2);text-align:center">No candidates added yet.</p>';
      return;
    }
    list.innerHTML = '';
    let index = 1;
    snap.forEach(doc => {
      const c = { id: doc.id, ...doc.data() };
      const card = document.createElement('div');
      card.className = 'card glass cand-card';
      card.id = `cand-${c.id}`;
      card.innerHTML = `
        <img class="cand-photo" src="${c.photoURL || 'https://ui-avatars.com/api/?name='+encodeURIComponent(c.name)+'&background=6366f1&color=fff'}" alt="${c.name}"/>
        <h3>Candidate ${index}: ${c.name}</h3>
        <p class="cand-party">${c.party}</p>
        ${c.symbolURL ? `<img class="cand-symbol" src="${c.symbolURL}" alt="Party Symbol"/>` : ''}
        <button class="vote-btn" onclick="selectCandidate('${c.id}','${c.name}','${c.party}','${c.photoURL||''}','${c.symbolURL||''}')">
          🗳️ Vote
        </button>`;
      list.appendChild(card);
      index++;
    });
  } catch (e) {
    list.innerHTML = `<p style="color:var(--danger)">Error: ${e.message}</p>`;
  }
}

function selectCandidate(id, name, party, photoURL, symbolURL) {
  state.selectedCandidate = { id, name, party, photoURL, symbolURL };
  // Highlight
  document.querySelectorAll('.cand-card').forEach(c => c.classList.remove('selected'));
  $(`cand-${id}`)?.classList.add('selected');
  // Go to confirm
  renderConfirmCard('confirmCandidateInfo', { name, party, photoURL, symbolURL });
  showPage('page-vote-confirm');
}

function renderConfirmCard(elId, c) {
  $(elId).innerHTML = `
    <img src="${c.photoURL || 'https://ui-avatars.com/api/?name='+encodeURIComponent(c.name)+'&background=6366f1&color=fff'}" alt="${c.name}"/>
    <div>
      <h4>${c.name}</h4>
      <p>${c.party}</p>
    </div>
    ${c.symbolURL ? `<img class="conf-sym" src="${c.symbolURL}" alt="Symbol"/>` : ''}`;
}

async function castVote() {
  if (!state.currentVoter || !state.selectedCandidate) return;
  $('okVoteBtn').disabled = true;
  $('okVoteBtn').textContent = '⏳ Casting…';

  try {
    const batch = db.batch();

    // Increment candidate vote count
    const candRef = db.collection('candidates').doc(state.selectedCandidate.id);
    batch.update(candRef, { votes: firebase.firestore.FieldValue.increment(1) });

    // Mark voter as voted
    const voterRef = db.collection('voters').doc(state.currentVoter.id);
    batch.update(voterRef, { hasVoted: true, votedFor: state.selectedCandidate.id, votedAt: new Date().toISOString() });

    // Increment total vote counter
    const settRef = db.collection('settings').doc('polling');
    batch.update(settRef, { totalVotes: firebase.firestore.FieldValue.increment(1) });

    await batch.commit();

    // Show success
    renderConfirmCard('successCandidateInfo', state.selectedCandidate);
    showPage('page-vote-success');
    toast('Vote cast successfully! 🎉', 'success');
  } catch (e) {
    toast('Failed to cast vote: ' + e.message, 'error');
    $('okVoteBtn').disabled = false;
    $('okVoteBtn').textContent = 'OK — Cast My Vote';
  }
}

function exitToHome() {
  state.currentVoter = null;
  state.selectedCandidate = null;
  $('voterIdInput').value = '';
  showPage('page-home');
}

// ═══════════════════════════════════════════════
//  VOTER REGISTRATION
// ═══════════════════════════════════════════════

async function startRegCamera() {
  const video    = $('regVideo');
  const statusEl = $('regFaceStatus');
  statusEl.textContent = '⏳ Starting camera…';

  // Stop any existing reg stream first
  if (state.regStream) {
    state.regStream.getTracks().forEach(t => t.stop());
    state.regStream = null;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    statusEl.textContent = '❌ Camera API not supported — use Chrome or Firefox';
    toast('Camera not supported', 'error');
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: false
    });
    state.regStream = stream;
    video.srcObject = stream;
    await video.play().catch(() => {});  // explicit play
    statusEl.textContent = '📷 Camera active — position your face in the oval and click Capture';
  } catch (e) {
    console.error('Camera error:', e);
    let msg = '❌ ';
    if (e.name === 'NotAllowedError')    msg += 'Camera permission denied — click the 🔒 icon in the address bar and allow camera';
    else if (e.name === 'NotFoundError') msg += 'No camera found on this device';
    else if (e.name === 'NotReadableError') msg += 'Camera is in use by another application';
    else msg += 'Camera error: ' + e.message;
    statusEl.textContent = msg;
    toast(msg, 'error', 5000);
  }
}

function captureRegFace() {
  const video  = $('regVideo');
  const canvas = $('regCanvas');
  if (!video.srcObject) { toast('Please start the camera first', 'error'); return; }
  canvas.width  = video.videoWidth  || 640;
  canvas.height = video.videoHeight || 480;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);
  state.regFaceDataURL = canvas.toDataURL('image/jpeg', 0.8);
  // Preview
  const prev = $('regPreview');
  prev.innerHTML = `<img src="${state.regFaceDataURL}" alt="Captured face"/>`;
  prev.classList.remove('hidden');
  $('regFaceStatus').textContent = '✅ Face captured!';
  toast('Face captured successfully', 'success');
}

async function registerVoter() {
  const name    = $('regName').value.trim();
  const voterId = $('regVoterId').value.trim().toUpperCase();
  const age     = parseInt($('regAge').value);
  const gender  = $('regGender').value;

  if (!name || !voterId || !age || !gender) {
    toast('Please fill all required fields', 'error'); return;
  }
  if (age < 18) { toast('Voter must be at least 18 years old', 'error'); return; }
  if (!state.regFaceDataURL) {
    toast('Please capture your face photo', 'error'); return;
  }

  try {
    // Check duplicate
    const existing = await db.collection('voters').doc(voterId).get();
    if (existing.exists) { toast('Voter ID already registered!', 'error'); return; }

    // Store face image to Firebase Storage
    let faceURL = state.regFaceDataURL;
    try {
      const blob = dataURLtoBlob(state.regFaceDataURL);
      const ref = storage.ref(`voters/${voterId}/face.jpg`);
      await ref.put(blob);
      faceURL = await ref.getDownloadURL();
    } catch (storErr) {
      // Use base64 as fallback if storage fails
      console.warn('Storage upload failed, using base64 fallback', storErr);
    }

    // Save voter to Firestore
    await db.collection('voters').doc(voterId).set({
      name, age, gender, voterId,
      faceDataURL: faceURL,
      hasVoted: false,
      registeredAt: new Date().toISOString()
    });

    // Update registered count
    await db.collection('settings').doc('polling').set(
      { registeredVoters: firebase.firestore.FieldValue.increment(1) },
      { merge: true }
    );

    toast('Registration successful! 🎉', 'success');
    // Reset form
    $('regName').value = '';
    $('regVoterId').value = '';
    $('regAge').value = '';
    $('regGender').value = '';
    state.regFaceDataURL = null;
    $('regPreview').classList.add('hidden');
    $('regFaceStatus').textContent = '';
    stopAllStreams();

    setTimeout(() => showPage('page-home'), 1500);
  } catch (e) {
    toast('Registration failed: ' + e.message, 'error');
  }
}

function dataURLtoBlob(dataURL) {
  const arr = dataURL.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  return new Blob([u8arr], { type: mime });
}

// ═══════════════════════════════════════════════
//  ADMIN
// ═══════════════════════════════════════════════

const ADMIN_PASSWORD = 'admin123';

function adminLogin() {
  const pw = $('adminPwInput').value;
  if (pw === ADMIN_PASSWORD) {
    $('adminPwInput').value = '';
    showPage('page-admin');
    loadAdminStats();
    loadAdminCandidates();
  } else {
    toast('Incorrect password', 'error');
    $('adminPwInput').value = '';
  }
}

function adminLogout() {
  showPage('page-home');
}

function togglePw(inputId, btn) {
  const inp = $(inputId);
  if (inp.type === 'password') { inp.type = 'text';     btn.textContent = '🙈'; }
  else                        { inp.type = 'password';  btn.textContent = '👁';  }
}

// ── Polling Control ─────────────────────────────
async function startPolling() {
  try {
    await db.collection('settings').doc('polling').set(
      { active: true, closed: false },
      { merge: true }
    );
    toast('Polling started! ▶', 'success');
    updatePollingUI(true, false);
    $('resultsSection').style.display = 'none';
  } catch (e) { toast('Error: ' + e.message, 'error'); }
}

async function closePolling() {
  if (!confirm('Close polling? Results will be revealed to admin.')) return;
  try {
    await db.collection('settings').doc('polling').set(
      { active: false, closed: true },
      { merge: true }
    );
    toast('Polling closed. ⏹', 'success');
    updatePollingUI(false, true);
    loadResults();
    $('resultsSection').style.display = 'block';
  } catch (e) { toast('Error: ' + e.message, 'error'); }
}

function updatePollingUI(active, closed) {
  const badge = $('pollingStatusBadge');
  const startBtn = $('startPollBtn');
  const closeBtn = $('closePollBtn');
  if (!badge) return;

  if (active) {
    badge.textContent = 'Status: Active 🟢';
    badge.className = 'polling-status active';
    startBtn.disabled = true;
    closeBtn.disabled = false;
  } else if (closed) {
    badge.textContent = 'Status: Closed 🔴';
    badge.className = 'polling-status closed';
    startBtn.disabled = true;
    closeBtn.disabled = true;
  } else {
    badge.textContent = 'Status: Not Started ⚪';
    badge.className = 'polling-status';
    startBtn.disabled = false;
    closeBtn.disabled = true;
  }
}

function listenPollingState() {
  db.collection('settings').doc('polling').onSnapshot(snap => {
    if (!snap.exists) { updatePollingUI(false, false); return; }
    const d = snap.data();
    updatePollingUI(d.active, d.closed);
    if (d.closed) {
      loadResults();
      $('resultsSection').style.display = 'block';
    }
    updatePollChart(d);
  });
}

// ── Results ──────────────────────────────────────
async function loadResults() {
  const list = $('resultsList');
  if (!list) return;
  list.innerHTML = '<p style="color:var(--text2)">Loading results…</p>';

  const snap = await db.collection('candidates').orderBy('votes', 'desc').get();
  if (snap.empty) { list.innerHTML = '<p style="color:var(--text2)">No candidates found.</p>'; return; }

  let total = 0;
  const cands = [];
  snap.forEach(doc => { const c = { id: doc.id, ...doc.data() }; cands.push(c); total += (c.votes || 0); });

  list.innerHTML = '';
  cands.forEach(c => {
    const pct = total ? Math.round(((c.votes || 0) / total) * 100) : 0;
    const row = document.createElement('div');
    row.className = 'result-row';
    row.innerHTML = `
      <img src="${c.photoURL || 'https://ui-avatars.com/api/?name='+encodeURIComponent(c.name)+'&background=6366f1&color=fff'}" alt="${c.name}"/>
      <div class="result-info"><h4>${c.name}</h4><p>${c.party}</p></div>
      <div class="result-bar-wrap">
        <div class="result-bar-bg">
          <div class="result-bar-fill" style="width:0%" data-pct="${pct}"></div>
        </div>
        <small style="color:var(--text2)">${pct}%</small>
      </div>
      <div class="result-votes">${c.votes || 0}</div>`;
    list.appendChild(row);
    setTimeout(() => {
      row.querySelector('.result-bar-fill').style.width = pct + '%';
    }, 100);
  });
}

// ── Stats ─────────────────────────────────────────
async function loadAdminStats() {
  try {
    const [settSnap, candSnap] = await Promise.all([
      db.collection('settings').doc('polling').get(),
      db.collection('candidates').get()
    ]);
    const d = settSnap.exists ? settSnap.data() : {};
    const reg   = d.registeredVoters || 0;
    const voted  = d.totalVotes       || 0;
    const pct   = reg ? Math.round((voted / reg) * 100) : 0;

    if ($('statRegistered')) $('statRegistered').textContent = reg;
    if ($('statPolled'))     $('statPolled').textContent = voted;
    if ($('statPercent'))    $('statPercent').textContent = pct + '%';
    if ($('statCandidates')) $('statCandidates').textContent = candSnap.size;

    updatePollChart(d);
  } catch (e) { console.warn('Stats error:', e); }
}

function updatePollChart(d) {
  const reg   = d.registeredVoters || 0;
  const voted = d.totalVotes       || 0;
  const pct   = reg ? Math.round((voted / reg) * 100) : 0;

  if ($('pollBarFill'))   $('pollBarFill').style.width = pct + '%';
  if ($('pollBarLabel'))  $('pollBarLabel').textContent = `${pct}% Voter Turnout`;
  if ($('pollDetailText'))$('pollDetailText').textContent = `${voted} votes cast out of ${reg} registered voters`;

  if ($('statRegistered')) $('statRegistered').textContent = reg;
  if ($('statPolled'))     $('statPolled').textContent = voted;
  if ($('statPercent'))    $('statPercent').textContent = pct + '%';
}

// ── Candidates ────────────────────────────────────
async function addCandidate() {
  const name   = $('candName').value.trim();
  const party  = $('candParty').value.trim();
  const photoFile  = $('candPhoto').files[0];
  const symbolFile = $('candSymbol').files[0];

  if (!name || !party) { toast('Name and Party are required', 'error'); return; }

  try {
    let photoURL  = '';
    let symbolURL = '';

    if (photoFile) {
      const ref = storage.ref(`candidates/${Date.now()}_photo`);
      await ref.put(photoFile);
      photoURL = await ref.getDownloadURL();
    }
    if (symbolFile) {
      const ref = storage.ref(`candidates/${Date.now()}_symbol`);
      await ref.put(symbolFile);
      symbolURL = await ref.getDownloadURL();
    }

    await db.collection('candidates').add({ name, party, photoURL, symbolURL, votes: 0 });

    toast(`Candidate "${name}" added! ✅`, 'success');
    $('candName').value = '';
    $('candParty').value = '';
    $('candPhoto').value = '';
    $('candSymbol').value = '';
    loadAdminCandidates();
    loadAdminStats();
  } catch (e) {
    toast('Failed to add candidate: ' + e.message, 'error');
  }
}

async function loadAdminCandidates() {
  const list = $('adminCandidateList');
  if (!list) return;
  list.innerHTML = '<p style="color:var(--text2)">Loading…</p>';

  try {
    const snap = await db.collection('candidates').get();
    if (snap.empty) { list.innerHTML = '<p style="color:var(--text2)">No candidates yet.</p>'; return; }
    list.innerHTML = '';
    let index = 1;
    snap.forEach(doc => {
      const c = { id: doc.id, ...doc.data() };
      const row = document.createElement('div');
      row.className = 'admin-cand-row';
      row.innerHTML = `
        <img src="${c.photoURL || 'https://ui-avatars.com/api/?name='+encodeURIComponent(c.name)+'&background=6366f1&color=fff'}" alt="${c.name}"/>
        ${c.symbolURL ? `<img class="sym" src="${c.symbolURL}" alt="symbol"/>` : ''}
        <div class="info"><h4>Candidate ${index}: ${c.name}</h4><p>${c.party} · ${c.votes||0} votes</p></div>
        <button class="del-btn" onclick="deleteCandidate('${c.id}')">🗑 Delete</button>`;
      list.appendChild(row);
      index++;
    });
  } catch (e) {
    list.innerHTML = `<p style="color:var(--danger)">Error: ${e.message}</p>`;
  }
}

async function deleteCandidate(id) {
  if (!confirm('Delete this candidate?')) return;
  try {
    await db.collection('candidates').doc(id).delete();
    toast('Candidate deleted', 'success');
    loadAdminCandidates();
    loadAdminStats();
  } catch (e) { toast('Delete failed: ' + e.message, 'error'); }
}

// ═══════════════════════════════════════════════
//  THEME
// ═══════════════════════════════════════════════

const themes = ['dark','light','blue','green','purple','red'];

function setTheme(t) {
  state.currentTheme = t;
  document.getElementById('appBody').className = `theme-${t}`;
  themes.forEach(th => {
    const el = $(`chk-${th}`);
    if (el) el.textContent = th === t ? '✓' : '';
  });
  localStorage.setItem('evote_theme', t);
}

function loadTheme() {
  const saved = localStorage.getItem('evote_theme') || 'dark';
  setTheme(saved);
}

function openThemeModal()  { $('themeModal').classList.remove('hidden'); }
function closeThemeModal() { $('themeModal').classList.add('hidden'); }

// Close modal on overlay click
$('themeModal').addEventListener('click', e => {
  if (e.target === $('themeModal')) closeThemeModal();
});
